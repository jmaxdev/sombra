use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use std::env;
use std::path::PathBuf;
use std::process::Command;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum WarpStatus {
    NotInstalled,
    Connected,
    Disconnected,
    Connecting,
    Other(String),
}

impl std::fmt::Display for WarpStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            WarpStatus::NotInstalled => write!(f, "Not Installed"),
            WarpStatus::Connected => write!(f, "Connected"),
            WarpStatus::Disconnected => write!(f, "Disconnected"),
            WarpStatus::Connecting => write!(f, "Connecting..."),
            WarpStatus::Other(s) => write!(f, "{}", s),
        }
    }
}

/// Finds the path to the `warp-cli.exe` executable on Windows.
pub fn find_warp_cli() -> Option<PathBuf> {
    let standard_path = PathBuf::from(r"C:\Program Files\Cloudflare\Cloudflare WARP\warp-cli.exe");
    if standard_path.exists() {
        return Some(standard_path);
    }

    // Try finding it in the system PATH env
    if let Ok(path_env) = env::var("PATH") {
        for path in env::split_paths(&path_env) {
            let candidate = path.join("warp-cli.exe");
            if candidate.exists() {
                return Some(candidate);
            }
        }
    }

    None
}

/// Checks the current connection status of Cloudflare WARP.
pub fn get_warp_status() -> WarpStatus {
    let cli = match find_warp_cli() {
        Some(path) => path,
        None => return WarpStatus::NotInstalled,
    };

    // Run warp-cli status
    let output = match Command::new(cli).arg("status").output() {
        Ok(out) => out,
        Err(_) => return WarpStatus::NotInstalled,
    };

    if !output.status.success() {
        return WarpStatus::NotInstalled;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let combined = format!("{}{}", stdout, stderr);

    if combined.contains("Status update: Connected") || combined.contains("Connected") {
        WarpStatus::Connected
    } else if combined.contains("Status update: Disconnected") || combined.contains("Disconnected") {
        WarpStatus::Disconnected
    } else if combined.contains("Status update: Connecting") || combined.contains("Connecting") {
        WarpStatus::Connecting
    } else {
        let trimmed = combined.trim();
        if trimmed.is_empty() {
            WarpStatus::Disconnected
        } else {
            WarpStatus::Other(trimmed.chars().take(40).collect())
        }
    }
}

/// Commands Cloudflare WARP to connect the tunnel.
pub fn connect_warp() -> Result<()> {
    let cli = find_warp_cli().ok_or_else(|| anyhow!("Cloudflare WARP is not installed"))?;
    
    // Set tunnel protocol to WireGuard to increase gaming routing performance
    let _ = Command::new(&cli).args(&["tunnel", "protocol", "set", "WireGuard"]).status();

    let status = Command::new(cli).arg("connect").status()?;
    if status.success() {
        Ok(())
    } else {
        Err(anyhow!("Failed to connect Cloudflare WARP"))
    }
}

/// Commands Cloudflare WARP to disconnect the tunnel.
pub fn disconnect_warp() -> Result<()> {
    let cli = find_warp_cli().ok_or_else(|| anyhow!("Cloudflare WARP is not installed"))?;
    let status = Command::new(cli).arg("disconnect").status()?;
    if status.success() {
        Ok(())
    } else {
        Err(anyhow!("Failed to disconnect Cloudflare WARP"))
    }
}
