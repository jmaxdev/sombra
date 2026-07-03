use crate::firewall;
use crate::servers::{ServerState, SERVERS};
use anyhow::Result;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Copy, Clone, Debug, PartialEq, Eq)]
pub enum OperationMode {
    Manual,
    AutoGlobal,
    AutoSA,
    AutoUSA,
    AutoEurope,
    AutoAsia,
}

impl std::fmt::Display for OperationMode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            OperationMode::Manual => write!(f, "Manual"),
            OperationMode::AutoGlobal => write!(f, "Auto (Global/Closest)"),
            OperationMode::AutoSA => write!(f, "Auto (South America)"),
            OperationMode::AutoUSA => write!(f, "Auto (USA)"),
            OperationMode::AutoEurope => write!(f, "Auto (Europe)"),
            OperationMode::AutoAsia => write!(f, "Auto (Asia)"),
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AppConfig {
    pub mode: OperationMode,
    pub blocked_servers: Vec<String>,
    pub autostart_enabled: bool,
    pub autostart_mode: String,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            mode: OperationMode::Manual,
            blocked_servers: Vec::new(),
            autostart_enabled: false,
            autostart_mode: "normal".to_string(),
        }
    }
}

pub struct App {
    pub servers: Vec<ServerState>,
    pub mode: OperationMode,
    pub tunneling_path: Option<String>,
    pub status_message: String,
    pub selected_index: usize,
    pub auto_routed: bool,
    pub autostart_enabled: bool,
    pub autostart_mode: String,
}

/// Helper to auto-detect running Overwatch 2 executable path using PowerShell
pub fn detect_overwatch_path() -> Option<String> {
    crate::logger::info("Searching for running Overwatch.exe process...");
    let output = std::process::Command::new("powershell")
        .args(&[
            "-NoProfile",
            "-Command",
            "Get-Process -Name Overwatch -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Path",
        ])
        .output()
        .ok()?;

    if output.status.success() {
        let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !path.is_empty() && path.contains("Overwatch.exe") {
            crate::logger::info(&format!("Detected Overwatch.exe running at path: {}", path));
            return Some(path);
        }
    }
    crate::logger::info("Overwatch.exe process is not currently running.");

    // Check common default install paths
    let common_paths = &[
        r"C:\Program Files (x86)\Overwatch\_retail_\Overwatch.exe",
        r"C:\Program Files\Overwatch\_retail_\Overwatch.exe",
        r"D:\Games\Overwatch\_retail_\Overwatch.exe",
        r"E:\Games\Overwatch\_retail_\Overwatch.exe",
    ];

    for path in common_paths {
        if std::path::Path::new(path).exists() {
            return Some(path.to_string());
        }
    }

    None
}

impl App {
    pub fn new() -> Self {
        let servers = SERVERS
            .iter()
            .map(|s| ServerState {
                name: s.name,
                description: s.description,
                ping_ip: s.ping_ip,
                cidrs: s.cidrs.to_string(),
                region: s.region,
                is_blocked: false,
                current_ping: None,
            })
            .collect();

        Self {
            servers,
            mode: OperationMode::Manual,
            tunneling_path: None,
            status_message: "Initializing...".to_string(),
            selected_index: 0,
            auto_routed: false,
            autostart_enabled: false,
            autostart_mode: "normal".to_string(),
        }
    }

    /// Load application state from Windows Firewall rule's description
    pub fn load_settings(&mut self) -> Result<()> {
        let (desc, _, app_path) = firewall::get_rules_description_and_blocked()?;

        self.tunneling_path = app_path;

        let config: AppConfig = if let Some(desc_str) = desc {
            serde_json::from_str(&desc_str).unwrap_or_default()
        } else {
            AppConfig::default()
        };

        self.mode = config.mode;
        self.autostart_enabled = config.autostart_enabled;
        self.autostart_mode = config.autostart_mode.clone();

        for server in &mut self.servers {
            server.is_blocked = config
                .blocked_servers
                .contains(&server.description.to_string());
        }

        let blocked_count = config.blocked_servers.len();
        self.status_message = "Settings loaded from firewall description.".to_string();
        crate::logger::info(&format!(
            "Loaded settings: Mode = {:?}, Tunneling = {:?}, Blocked servers count = {}",
            self.mode, self.tunneling_path, blocked_count
        ));
        Ok(())
    }

    pub fn save_settings(&mut self) -> Result<()> {
        if self.tunneling_path.is_none() {
            if let Some(path) = detect_overwatch_path() {
                self.tunneling_path = Some(path.clone());
                crate::logger::info(&format!(
                    "Auto-detected and bound to Overwatch.exe on save: {}",
                    path
                ));
            }
        }

        let blocked_servers: Vec<String> = self
            .servers
            .iter()
            .filter(|s| s.is_blocked)
            .map(|s| s.description.to_string())
            .collect();

        let config = AppConfig {
            mode: self.mode,
            blocked_servers: blocked_servers.clone(),
            autostart_enabled: self.autostart_enabled,
            autostart_mode: self.autostart_mode.clone(),
        };

        let json_str = serde_json::to_string(&config)?;

        let blocked_cidrs: Vec<&str> = self
            .servers
            .iter()
            .filter(|s| s.is_blocked)
            .map(|s| s.cidrs.as_str())
            .collect();

        let blocked_ips = blocked_cidrs.join(",");

        crate::logger::info(&format!(
            "Saving settings: Mode = {:?}, Tunneling = {:?}, Blocked servers = {:?}",
            self.mode, self.tunneling_path, blocked_servers
        ));

        firewall::apply_rules(&json_str, &blocked_ips, self.tunneling_path.as_deref())?;
        self.status_message = "Firewall rules applied successfully!".to_string();
        Ok(())
    }

    pub fn unblock_all(&mut self) -> Result<()> {
        crate::logger::info("Unblocking all target servers.");
        for server in &mut self.servers {
            server.is_blocked = false;
        }
        self.mode = OperationMode::Manual;
        self.auto_routed = false;
        self.save_settings()?;
        self.status_message = "All servers unblocked. Safe to queue.".to_string();
        Ok(())
    }

    pub fn block_all(&mut self) -> Result<()> {
        crate::logger::info("Blocking all target servers.");
        for server in &mut self.servers {
            server.is_blocked = true;
        }
        self.mode = OperationMode::Manual;
        self.auto_routed = false;
        self.save_settings()?;
        self.status_message = "All servers blocked. Matchmaking disabled.".to_string();
        Ok(())
    }

    pub fn toggle_server(&mut self, index: usize) -> Result<()> {
        if self.mode != OperationMode::Manual {
            self.status_message = "Switch to Manual mode to toggle individual servers.".to_string();
            return Ok(());
        }

        if index < self.servers.len() {
            self.servers[index].is_blocked = !self.servers[index].is_blocked;
            let action = if self.servers[index].is_blocked {
                "Blocked"
            } else {
                "Allowed"
            };
            let name = self.servers[index].name;
            crate::logger::info(&format!("Manual toggle: {} -> {}", name, action));
            self.auto_routed = false;
            self.save_settings()?;
            self.status_message = format!("{} {}", action, name);
        }
        Ok(())
    }

    pub fn set_mode(&mut self, mode: OperationMode) -> Result<()> {
        crate::logger::info(&format!("Updating operational mode to: {:?}", mode));
        self.mode = mode;
        self.auto_routed = false;
        if mode != OperationMode::Manual {
            self.status_message = format!("Mode {} enabled. Optimizing route...", mode);
            self.run_auto_routing()?;
        } else {
            self.save_settings()?;
        }
        Ok(())
    }

    pub fn run_auto_routing(&mut self) -> Result<()> {
        if self.mode == OperationMode::Manual {
            return Ok(());
        }

        let candidates: Vec<usize> = match self.mode {
            OperationMode::Manual => return Ok(()),
            OperationMode::AutoGlobal => (0..self.servers.len()).collect(),
            OperationMode::AutoSA => self
                .servers
                .iter()
                .enumerate()
                .filter(|(_, s)| s.region == "South America")
                .map(|(i, _)| i)
                .collect(),
            OperationMode::AutoUSA => self
                .servers
                .iter()
                .enumerate()
                .filter(|(_, s)| s.region == "USA")
                .map(|(i, _)| i)
                .collect(),
            OperationMode::AutoEurope => self
                .servers
                .iter()
                .enumerate()
                .filter(|(_, s)| s.region == "Europe")
                .map(|(i, _)| i)
                .collect(),
            OperationMode::AutoAsia => self
                .servers
                .iter()
                .enumerate()
                .filter(|(_, s)| s.region == "Asia")
                .map(|(i, _)| i)
                .collect(),
        };

        if candidates.is_empty() {
            return Ok(());
        }

        let mut best_index: Option<usize> = None;
        let mut lowest_ping = u32::MAX;

        for &i in &candidates {
            if let Some(ping) = self.servers[i].current_ping {
                if ping < lowest_ping {
                    lowest_ping = ping;
                    best_index = Some(i);
                }
            }
        }

        let selected_index = match best_index {
            Some(idx) => idx,
            None => match self.mode {
                OperationMode::AutoSA => self
                    .servers
                    .iter()
                    .position(|s| s.description == "SCL1")
                    .unwrap_or(0),
                OperationMode::AutoUSA => self
                    .servers
                    .iter()
                    .position(|s| s.description == "ORD1")
                    .unwrap_or(0),
                OperationMode::AutoEurope => self
                    .servers
                    .iter()
                    .position(|s| s.description == "AMS1")
                    .unwrap_or(0),
                OperationMode::AutoAsia => self
                    .servers
                    .iter()
                    .position(|s| s.description == "GTK1")
                    .unwrap_or(0),
                _ => self
                    .servers
                    .iter()
                    .position(|s| s.description == "SCL1")
                    .unwrap_or(0),
            },
        };

        let selected_region = self.servers[selected_index].region;
        let mut changed = false;
        for i in 0..self.servers.len() {
            let target_blocked = if self.mode == OperationMode::AutoGlobal {
                false
            } else {
                self.servers[i].region != selected_region
            };
            if self.servers[i].is_blocked != target_blocked {
                self.servers[i].is_blocked = target_blocked;
                changed = true;
            }
        }

        if best_index.is_some() {
            self.auto_routed = true;
        }

        let route_msg = if self.mode == OperationMode::AutoGlobal {
            "Auto routed: Global (All regions unrestricted)".to_string()
        } else {
            format!(
                "Auto routed to {} ({}ms)",
                self.servers[selected_index].name,
                self.servers[selected_index]
                    .current_ping
                    .map(|p| p.to_string())
                    .unwrap_or_else(|| "N/A".to_string())
            )
        };

        if changed {
            crate::logger::info(&format!(
                "Auto-routing selected new target: {}. Triggering firewall update.",
                route_msg
            ));
            self.save_settings()?;
        }

        self.status_message = route_msg;
        Ok(())
    }
}
