mod app;
mod firewall;
mod logger;
mod ping;
mod servers;

use app::{App, OperationMode};
use servers::ServerState;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::Mutex;

use tauri::menu::{MenuBuilder, MenuItem};
use tauri::tray::{TrayIconBuilder, TrayIconEvent};

use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
use windows::Win32::NetworkManagement::IpHelper::{
    GetExtendedTcpTable, MIB_TCPROW_OWNER_PID, MIB_TCPTABLE_OWNER_PID, TCP_TABLE_OWNER_PID_ALL,
};
use windows::Win32::Foundation::CloseHandle;
use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};
use windows::Win32::Security::{
    GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY,
};

pub struct AppState {
    pub app: Arc<Mutex<App>>,
    pub is_admin: bool,
}

/// Sync-readable autostart mode for use in the synchronous on_window_event handler.
pub struct AutostartMode(pub std::sync::Mutex<String>);

#[derive(serde::Serialize, Clone)]
pub struct AppStatePayload {
    pub mode: OperationMode,
    pub tunneling_path: Option<String>,
    pub status_message: String,
    pub is_admin: bool,
    pub autostart_enabled: bool,
    pub autostart_mode: String,
    pub tcp_region: Option<String>,
}

fn check_is_admin() -> bool {
    unsafe {
        let process = GetCurrentProcess();
        let mut token = windows::Win32::Foundation::HANDLE::default();
        if OpenProcessToken(process, TOKEN_QUERY, &mut token).is_err() {
            logger::info("Administrator privileges check: false (OpenProcessToken failed)");
            return false;
        }
        let mut elevation = TOKEN_ELEVATION::default();
        let mut return_length = 0u32;
        let size = std::mem::size_of::<TOKEN_ELEVATION>() as u32;
        let is_admin = GetTokenInformation(
            token,
            TokenElevation,
            Some(&mut elevation as *mut _ as *mut _),
            size,
            &mut return_length,
        ).is_ok() && elevation.TokenIsElevated != 0;
        let _ = CloseHandle(token);
        logger::info(&format!("Administrator privileges check: {}", is_admin));
        is_admin
    }
}

fn spawn_immediate_ping(state: Arc<Mutex<App>>, app_handle: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let ping_targets: Vec<(usize, String)> = {
            let app = state.lock().await;
            app.servers.iter().enumerate().map(|(i, s)| (i, s.ping_ip.to_string())).collect()
        };

        let mut results = Vec::new();
        for batch in ping_targets.chunks(4) {
            let mut tasks = Vec::new();
            for (idx, ip_str) in batch {
                let idx = *idx;
                let ip_str = ip_str.clone();
                tasks.push(tokio::task::spawn_blocking(move || {
                    if let Ok(ip) = ip_str.parse::<std::net::Ipv4Addr>() {
                        (
                            idx,
                            ping::ping_ipv4(ip, std::time::Duration::from_millis(1000)),
                        )
                    } else {
                        (idx, None)
                    }
                }));
            }
            for t in tasks {
                if let Ok(res) = t.await {
                    results.push(res);
                }
            }
        }

        {
            let mut app = state.lock().await;
            for &(idx, ping_val) in &results {
                if idx < app.servers.len() {
                    app.servers[idx].current_ping = ping_val;
                }
            }
            let _ = app_handle.emit("servers-update", app.servers.clone());
        }
    });
}

#[tauri::command]
async fn get_servers(state: State<'_, AppState>) -> Result<Vec<ServerState>, String> {
    let app = state.app.lock().await;
    Ok(app.servers.clone())
}

#[tauri::command]
fn is_game_running() -> bool {
    find_overwatch_pid().is_some()
}

#[tauri::command]
async fn get_app_state(state: State<'_, AppState>) -> Result<AppStatePayload, String> {
    let app = state.app.lock().await;
    Ok(AppStatePayload {
        mode: app.mode,
        tunneling_path: app.tunneling_path.clone(),
        status_message: app.status_message.clone(),
        is_admin: state.is_admin,
        autostart_enabled: app.autostart_enabled,
        autostart_mode: app.autostart_mode.clone(),
        tcp_region: app.tcp_region.clone(),
    })
}

#[tauri::command]
async fn save_tcp_settings(
    tcp_region: Option<String>,
    state: State<'_, AppState>,
    app_handle: AppHandle,
) -> Result<(), String> {
    logger::info(&format!(
        "Command 'save_tcp_settings' received to set TCP region: {:?}",
        tcp_region
    ));
    if !state.is_admin {
        logger::error("Command 'save_tcp_settings' failed: administrator privileges required.");
        return Err("Administrator privileges required to change settings.".to_string());
    }
    {
        let mut app = state.app.lock().await;
        app.tcp_region = tcp_region;
        app.save_settings().map_err(|e| {
            logger::error(&format!("Error applying TCP settings: {}", e));
            e.to_string()
        })?;
        let _ = app_handle.emit("servers-update", app.servers.clone());
        let _ = app_handle.emit("status-message", app.status_message.clone());
        logger::info(&format!("TCP settings updated. Status: {}", app.status_message));
    }
    spawn_immediate_ping(state.app.clone(), app_handle);
    Ok(())
}

#[tauri::command]
async fn save_autostart_settings(
    enabled: bool,
    mode: String,
    state: State<'_, AppState>,
    app_handle: AppHandle,
) -> Result<(), String> {
    if !state.is_admin {
        return Err("Administrator privileges required to change settings.".to_string());
    }
    let mut app = state.app.lock().await;
    app.autostart_enabled = enabled;
    app.autostart_mode = mode.clone();
    app.save_settings().map_err(|e| e.to_string())?;

    // Keep the sync AutostartMode state in sync so on_window_event sees the new value.
    if let Some(mode_state) = app_handle.try_state::<AutostartMode>() {
        if let Ok(mut m) = mode_state.0.lock() {
            *m = mode;
        }
    }

    Ok(())
}

#[tauri::command]
async fn toggle_server(
    index: usize,
    state: State<'_, AppState>,
    app_handle: AppHandle,
) -> Result<(), String> {
    logger::info(&format!(
        "Command 'toggle_server' received for index {}.",
        index
    ));
    if !state.is_admin {
        logger::error("Command 'toggle_server' failed: administrator privileges required.");
        return Err("Administrator privileges required to toggle servers.".to_string());
    }
    {
        let mut app = state.app.lock().await;
        app.toggle_server(index).map_err(|e| {
            logger::error(&format!("Error toggling server: {}", e));
            e.to_string()
        })?;
        let _ = app_handle.emit("servers-update", app.servers.clone());
        let _ = app_handle.emit("status-message", app.status_message.clone());
        logger::info(&format!("Server toggled. Status: {}", app.status_message));
    }
    spawn_immediate_ping(state.app.clone(), app_handle);
    Ok(())
}

#[tauri::command]
async fn set_mode(
    mode: OperationMode,
    state: State<'_, AppState>,
    app_handle: AppHandle,
) -> Result<(), String> {
    logger::info(&format!(
        "Command 'set_mode' received to set mode: {:?}",
        mode
    ));
    if !state.is_admin {
        logger::error("Command 'set_mode' failed: administrator privileges required.");
        return Err("Administrator privileges required to change operational modes.".to_string());
    }
    {
        let mut app = state.app.lock().await;
        app.set_mode(mode).map_err(|e| {
            logger::error(&format!("Error setting mode: {}", e));
            e.to_string()
        })?;
        let _ = app_handle.emit("servers-update", app.servers.clone());
        let _ = app_handle.emit("status-message", app.status_message.clone());
        logger::info(&format!("Operational mode updated. Status: {}", app.status_message));
    }
    spawn_immediate_ping(state.app.clone(), app_handle);
    Ok(())
}

#[tauri::command]
async fn unblock_all(state: State<'_, AppState>, app_handle: AppHandle) -> Result<(), String> {
    logger::info("Command 'unblock_all' received.");
    if !state.is_admin {
        logger::error("Command 'unblock_all' failed: administrator privileges required.");
        return Err("Administrator privileges required to unblock firewall.".to_string());
    }
    {
        let mut app = state.app.lock().await;
        app.unblock_all().map_err(|e| {
            logger::error(&format!("Error resetting firewall settings: {}", e));
            e.to_string()
        })?;
        let _ = app_handle.emit("servers-update", app.servers.clone());
        let _ = app_handle.emit("status-message", app.status_message.clone());
        logger::info("All servers unblocked in Windows Firewall.");
    }
    spawn_immediate_ping(state.app.clone(), app_handle);
    Ok(())
}

#[tauri::command]
async fn block_all(state: State<'_, AppState>, app_handle: AppHandle) -> Result<(), String> {
    logger::info("Command 'block_all' received.");
    if !state.is_admin {
        logger::error("Command 'block_all' failed: administrator privileges required.");
        return Err("Administrator privileges required to block firewall.".to_string());
    }
    {
        let mut app = state.app.lock().await;
        app.block_all().map_err(|e| {
            logger::error(&format!("Error blocking all servers: {}", e));
            e.to_string()
        })?;
        let _ = app_handle.emit("servers-update", app.servers.clone());
        let _ = app_handle.emit("status-message", app.status_message.clone());
        logger::info("All servers blocked in Windows Firewall.");
    }
    spawn_immediate_ping(state.app.clone(), app_handle);
    Ok(())
}

#[tauri::command]
async fn find_best_server(state: State<'_, AppState>, app_handle: AppHandle) -> Result<(), String> {
    logger::info("Command 'find_best_server' received.");
    if !state.is_admin {
        return Err("Administrator privileges required.".to_string());
    }

    let state_clone = state.app.clone();
    let handle_clone = app_handle.clone();

    tauri::async_runtime::spawn(async move {
        logger::info("Best server sweep started. Pinging all servers...");
        let _ = handle_clone.emit(
            "status-message",
            "Scanning all servers for lowest latency...".to_string(),
        );

        
        let ping_targets: Vec<(usize, String, &'static str, &'static str)> = {
            let app = state_clone.lock().await;
            app.servers
                .iter()
                .enumerate()
                .map(|(i, s)| (i, s.ping_ip.to_string(), s.name, s.region))
                .collect()
        };

        
        let mut results: Vec<(usize, Option<u32>)> = Vec::new();
        for batch in ping_targets.chunks(4) {
            let mut tasks = Vec::new();
            for (idx, ip_str, _, _) in batch {
                let idx = *idx;
                let ip_str = ip_str.clone();
                tasks.push(tokio::task::spawn_blocking(move || {
                    if let Ok(ip) = ip_str.parse::<std::net::Ipv4Addr>() {
                        
                        for _ in 0..2 {
                            if let Some(p) =
                                ping::ping_ipv4(ip, std::time::Duration::from_millis(1500))
                            {
                                return (idx, Some(p));
                            }
                        }
                        (idx, None)
                    } else {
                        (idx, None)
                    }
                }));
            }
            for t in tasks {
                if let Ok(res) = t.await {
                    results.push(res);
                }
            }
        }

        
        let final_message = {
            let mut app = state_clone.lock().await;
            app.auto_routed = false; 

            
            for &(idx, ping_val) in &results {
                if idx < app.servers.len() {
                    app.servers[idx].current_ping = ping_val;
                }
            }

            
            let mut best_idx: Option<usize> = None;
            let mut best_ping = u32::MAX;
            for &(idx, ping_val) in &results {
                if let Some(p) = ping_val {
                    if p < best_ping {
                        best_ping = p;
                        best_idx = Some(idx);
                    }
                }
            }

            match best_idx {
                Some(idx) => {
                    let best_region = app.servers[idx].region;
                    
                    for i in 0..app.servers.len() {
                        app.servers[i].is_blocked = app.servers[i].region != best_region;
                    }
                    app.mode = OperationMode::Manual;
                    let _ = app.save_settings();
                    let msg = format!(
                        "Optimization Complete: Best region is {} (Best Node: {} at {}ms). Other regions blocked.",
                        best_region, app.servers[idx].name, best_ping
                    );
                    app.status_message = msg.clone();
                    logger::info(&msg);
                    msg
                }
                None => {
                    let msg =
                        "Optimization Failed: All servers timed out. No changes made.".to_string();
                    app.status_message = msg.clone();
                    logger::error(&msg);
                    msg
                }
            }
        };

        let _ = handle_clone.emit("status-message", final_message);
        
        let servers = {
            let app = state_clone.lock().await;
            app.servers.clone()
        };
        let _ = handle_clone.emit("servers-update", servers);
    });

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    logger::info("Sombra application starting up...");
    
    let _ = firewall::initialize_com();

    
    let is_admin = check_is_admin();

    
    let mut app = App::new();
    if is_admin {
        let _ = app.load_settings();
        logger::info("Settings loaded from firewall rule descriptions.");
    } else {
        app.status_message =
            "WARNING: Not running as Administrator. Firewall changes will fail!".to_string();
        logger::error("Application is not running elevated. Firewall commands will be blocked.");
    }

    
    if app.tunneling_path.is_none() {
        if let Some(path) = app::detect_overwatch_path() {
            app.tunneling_path = Some(path.clone());
            logger::info(&format!("Auto-bound firewall rules to: {}", path));
            let _ = app.save_settings(); 
        } else {
            logger::info("Overwatch.exe not found. Firewall rules will apply globally.");
        }
    }

    let shared_state = AppState {
        app: Arc::new(Mutex::new(app)),
        is_admin,
    };

    let autostart_mode_state = AutostartMode(std::sync::Mutex::new(
        tauri::async_runtime::block_on(async { shared_state.app.lock().await.autostart_mode.clone() })
    ));

    let tauri_app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let _ = app.get_webview_window("main").map(|w| {
                let _ = w.show();
                let _ = w.set_focus();
                let _ = w.emit("restore-position", ());
            });
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_autostart::Builder::new().args(["--autostart"]).build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(shared_state)
        .manage(autostart_mode_state)
        .invoke_handler(tauri::generate_handler![
            get_servers,
            get_app_state,
            toggle_server,
            set_mode,
            unblock_all,
            block_all,
            find_best_server,
            save_autostart_settings,
            is_game_running,
            save_tcp_settings
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let is_icon_mode = window
                    .app_handle()
                    .try_state::<AutostartMode>()
                    .and_then(|s| s.0.lock().ok().map(|m| m.as_str() == "icon"))
                    .unwrap_or(false);

                if is_icon_mode {
                    // Tray-only mode: hide to tray instead of closing.
                    api.prevent_close();
                    let _ = window.hide();
                }
                // Normal / minimized mode: allow the close → process exits.
            }
        })
        .setup(|app| {
            let handle_clone = app.handle().clone();
            let state_clone = app.state::<AppState>().app.clone();

            let show_i = MenuItem::with_id(app, "show", "Show Sombra", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit Sombra", true, None::<&str>)?;
            let menu = MenuBuilder::new(app)
                .item(&show_i)
                .item(&quit_i)
                .build()?;

            let tray = TrayIconBuilder::with_id("sombra-tray")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .tooltip("Sombra - Overwatch Region Selector")
                .icon(app.default_window_icon().unwrap().clone())
                .on_menu_event(|app, event| {
                    match event.id.as_ref() {
                        "show" => {
                            if let Some(w) = app.get_webview_window("main") {
                                let _ = w.show();
                                let _ = w.set_focus();
                                let _ = w.emit("restore-position", ());
                            }
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    match event {
                        TrayIconEvent::Click { button: tauri::tray::MouseButton::Left, button_state: tauri::tray::MouseButtonState::Up, .. } => {
                            let app = tray.app_handle();
                            if let Some(w) = app.get_webview_window("main") {
                                let _ = w.show();
                                let _ = w.set_focus();
                                let _ = w.emit("restore-position", ());
                            }
                        }
                        TrayIconEvent::DoubleClick { .. } => {
                            let app = tray.app_handle();
                            if let Some(w) = app.get_webview_window("main") {
                                let _ = w.show();
                                let _ = w.set_focus();
                                let _ = w.emit("restore-position", ());
                            }
                        }
                        _ => {}
                    }
                })
                .build(app)?;
            // Keep tray alive for the lifetime of the app
            app.manage(tray);

            // Enable DevTools and right-click context menu only in dev mode
            #[cfg(debug_assertions)]
            if let Some(w) = app.get_webview_window("main") {
                w.open_devtools();
            }

            let state_for_autostart = state_clone.clone();
            let handle_for_autostart = handle_clone.clone();
            tauri::async_runtime::spawn(async move {
                let args: Vec<String> = std::env::args().collect();
                let is_autostart = args.contains(&"--autostart".to_string());

                let (enabled, mode) = {
                    let app_lock = state_for_autostart.lock().await;
                    (app_lock.autostart_enabled, app_lock.autostart_mode.clone())
                };

                if let Some(w) = handle_for_autostart.get_webview_window("main") {
                    if is_autostart && enabled {
                        // Always stay hidden in tray when launched via autostart.
                        // User can open the window from the tray icon.
                        logger::info(&format!("Launched via autostart (mode: {}). Window hidden, tray only.", mode));
                    } else {
                        // Normal manual launch — show the window.
                        let _ = w.show();
                    }
                }
            });

            
            let state_for_gcp = state_clone.clone();
            let handle_for_gcp = handle_clone.clone();
            tauri::async_runtime::spawn(async move {
                logger::info("Starting dynamic Google Cloud IP ranges loader...");
                let mut servers = {
                    let app_lock = state_for_gcp.lock().await;
                    app_lock.servers.clone()
                };
                if let Ok(_) = servers::load_dynamic_gcp_cidrs(&mut servers).await {
                    let mut app_lock = state_for_gcp.lock().await;
                    for (i, server) in servers.iter().enumerate() {
                        if i < app_lock.servers.len() {
                            app_lock.servers[i].cidrs = server.cidrs.clone();
                        }
                    }
                    if let Err(e) = app_lock.save_settings() {
                        logger::error(&format!(
                            "Failed to save settings after dynamic GCP ranges load: {:?}",
                            e
                        ));
                    } else {
                        logger::info("Dynamic GCP IP ranges applied and saved successfully.");
                        
                        let updated_servers = app_lock.servers.clone();
                        let _ = handle_for_gcp.emit("servers-update", updated_servers);
                    }
                }
            });

            
            let state_for_ping = state_clone.clone();
            let handle_for_ping = handle_clone.clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    
                    let ping_targets: Vec<(usize, String)> = {
                        let app_lock = state_for_ping.lock().await;
                        app_lock
                            .servers
                            .iter()
                            .enumerate()
                            .map(|(i, s)| (i, s.ping_ip.to_string()))
                            .collect()
                    };

                    
                    let mut results: Vec<(usize, Option<u32>)> = Vec::new();
                    for batch in ping_targets.chunks(4) {
                        let mut tasks = Vec::new();
                        for (idx, ip_str) in batch {
                            let idx = *idx;
                            let ip_str = ip_str.clone();
                            let value = ip_str.clone();
                            tasks.push(tokio::task::spawn_blocking(move || {
                                if let Ok(ip) = value.parse::<std::net::Ipv4Addr>() {
                                    (
                                        idx,
                                        ping::ping_ipv4(ip, std::time::Duration::from_millis(1000)),
                                    )
                                } else {
                                    (idx, None)
                                }
                            }));
                        }
                        for t in tasks {
                            if let Ok(res) = t.await {
                                results.push(res);
                            }
                        }
                    }

                    
                    {
                        let mut app_lock = state_for_ping.lock().await;
                        for &(idx, ping_val) in &results {
                            if idx < app_lock.servers.len() {
                                app_lock.servers[idx].current_ping = ping_val;
                            }
                        }
                        if app_lock.mode != OperationMode::Manual && !app_lock.auto_routed {
                            let _ = app_lock.run_auto_routing();
                        }
                    }

                    
                    let servers = {
                        let app_lock = state_for_ping.lock().await;
                        app_lock.servers.clone()
                    };
                    let _ = handle_for_ping.emit("servers-update", servers);

                    tokio::time::sleep(std::time::Duration::from_secs(8)).await;
                }
            });

            
            let state_for_tracker = state_clone.clone();
            let handle_for_tracker = handle_clone.clone();
            tauri::async_runtime::spawn(async move {
                let mut was_running = false;
                let mut last_connected_servers = std::collections::HashSet::new();

                loop {
                    let overwatch_pid = find_overwatch_pid();

                    if overwatch_pid.is_some() && !was_running {
                        was_running = true;
                        if let Some(pid) = overwatch_pid {
                            let _ = handle_for_tracker.emit(
                                "status-message",
                                format!("GAME TRACKER // Overwatch 2 process detected (PID: {})", pid),
                            );
                        }
                    } else if overwatch_pid.is_none() && was_running {
                        was_running = false;
                        last_connected_servers.clear();
                        let _ = handle_for_tracker.emit(
                            "status-message",
                            "GAME TRACKER // Overwatch 2 process closed.".to_string(),
                        );
                    }

                    if let Some(pid) = overwatch_pid {
                        let active_ips = get_process_tcp_connections(pid);
                        
                        let servers = {
                            let app = state_for_tracker.lock().await;
                            app.servers.clone()
                        };

                        let mut current_connected = std::collections::HashSet::new();
                        let mut ip_mappings = std::collections::HashMap::new();

                        for ip in active_ips {
                            for server in &servers {
                                if ip_in_server_cidrs(ip, &server.cidrs) {
                                    current_connected.insert(server.name.to_string());
                                    ip_mappings.insert(server.name.to_string(), ip);
                                }
                            }
                        }

                        for server_name in &current_connected {
                            if !last_connected_servers.contains(server_name) {
                                if let Some(ip) = ip_mappings.get(server_name) {
                                    let _ = handle_for_tracker.emit(
                                        "status-message",
                                        format!(
                                            "GAME TRACKER // Connected to server: {} (IP: {})",
                                            server_name, ip
                                        ),
                                    );
                                }
                            }
                        }

                        for server_name in &last_connected_servers {
                            if !current_connected.contains(server_name) {
                                let _ = handle_for_tracker.emit(
                                    "status-message",
                                    format!("GAME TRACKER // Disconnected from server: {}", server_name),
                                );
                            }
                        }

                        last_connected_servers = current_connected;
                    }

                    tokio::time::sleep(std::time::Duration::from_secs(3)).await;
                }
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    tauri_app.run(|_app_handle, event| {
        if let tauri::RunEvent::Exit = event {
            logger::info("Sombra application exiting. Cleaning up firewall rules...");
            if let Err(e) = firewall::delete_sombra_rules() {
                logger::error(&format!("Failed to clean up firewall rules on exit: {:?}", e));
            } else {
                logger::info("Firewall rules successfully cleaned up on exit.");
            }
        }
    });
}

fn find_overwatch_pid() -> Option<u32> {
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0).ok()?;
        let mut entry = PROCESSENTRY32W::default();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;

        if Process32FirstW(snapshot, &mut entry).is_ok() {
            loop {
                let exe_name = String::from_utf16_lossy(&entry.szExeFile);
                let trimmed = exe_name.trim_end_matches('\0');
                if trimmed.eq_ignore_ascii_case("Overwatch.exe") {
                    let pid = entry.th32ProcessID;
                    let _ = CloseHandle(snapshot);
                    return Some(pid);
                }
                if Process32NextW(snapshot, &mut entry).is_err() {
                    break;
                }
            }
        }
        let _ = CloseHandle(snapshot);
    }
    None
}

fn get_process_tcp_connections(pid: u32) -> Vec<std::net::Ipv4Addr> {
    let mut ips = Vec::new();
    unsafe {
        let mut size = 0;
        let _ = GetExtendedTcpTable(
            None,
            &mut size,
            false,
            2, 
            TCP_TABLE_OWNER_PID_ALL,
            0,
        );

        if size == 0 {
            return ips;
        }

        let mut buffer = vec![0u8; size as usize];
        let result = GetExtendedTcpTable(
            Some(buffer.as_mut_ptr() as *mut _),
            &mut size,
            false,
            2, 
            TCP_TABLE_OWNER_PID_ALL,
            0,
        );

        if result == 0 {
            let table = &*(buffer.as_ptr() as *const MIB_TCPTABLE_OWNER_PID);
            let num_entries = table.dwNumEntries as usize;
            if num_entries > 0 {
                let rows_ptr = &table.table[0] as *const MIB_TCPROW_OWNER_PID;
                let rows = std::slice::from_raw_parts(rows_ptr, num_entries);
                for row in rows {
                    if row.dwOwningPid == pid && row.dwState == 5 { 
                        let ip = std::net::Ipv4Addr::from(u32::from_be(row.dwRemoteAddr));
                        if !ip.is_loopback() && !ip.is_unspecified() {
                            ips.push(ip);
                        }
                    }
                }
            }
        }
    }
    ips
}

fn ip_in_cidr(ip: std::net::Ipv4Addr, cidr: &str) -> bool {
    let parts: Vec<&str> = cidr.split('/').collect();
    if parts.len() != 2 {
        return false;
    }
    let cidr_ip_str = parts[0];
    let mask_str = parts[1];

    let cidr_ip: std::net::Ipv4Addr = match cidr_ip_str.parse() {
        Ok(ip) => ip,
        Err(_) => return false,
    };
    let mask: u32 = match mask_str.parse() {
        Ok(m) => m,
        Err(_) => return false,
    };

    if mask > 32 {
        return false;
    }

    let ip_u32 = u32::from(ip);
    let cidr_ip_u32 = u32::from(cidr_ip);

    let netmask = if mask == 0 {
        0
    } else {
        u32::MAX << (32 - mask)
    };

    (ip_u32 & netmask) == (cidr_ip_u32 & netmask)
}

fn ip_in_server_cidrs(ip: std::net::Ipv4Addr, cidrs_str: &str) -> bool {
    for cidr in cidrs_str.split(',') {
        if ip_in_cidr(ip, cidr.trim()) {
            return true;
        }
    }
    false
}
