import { useEffect, useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Store } from "@tauri-apps/plugin-store";
import { getCurrentWindow, availableMonitors, type Monitor } from "@tauri-apps/api/window";
import { PhysicalPosition } from "@tauri-apps/api/dpi";
import { enable, disable } from "@tauri-apps/plugin-autostart";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch, exit } from "@tauri-apps/plugin-process";
import { getVersion } from '@tauri-apps/api/app';
import {
  Activity, ShieldCheck, Lock, Trash2, Cpu, RefreshCw, Route, Terminal, Server, Copy, Minus, X, Settings
} from "lucide-react";

import "./App.css";
import logo from "./assets/icon.png";


interface ServerState {
  name: string;
  description: string;
  ping_ip: string;
  cidrs: string;
  region: string;
  is_blocked: boolean;
  current_ping: number | null;
}

type OperationMode =
  | "Manual"
  | "AutoGlobal"
  | "AutoSA"
  | "AutoUSA"
  | "AutoEurope"
  | "AutoAsia";

interface AppStatePayload {
  mode: OperationMode;
  tunneling_path: string | null;
  status_message: string;
  is_admin: boolean;
  autostart_enabled: boolean;
  autostart_mode: string;
}

// Disable right-click context menu in production builds
if (!import.meta.env.DEV) {
  document.addEventListener("contextmenu", (e) => e.preventDefault(), true);
}

export default function App() {
  const [servers, setServers] = useState<ServerState[]>([]);
  const [appState, setAppState] = useState<AppStatePayload | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [optimizing, setOptimizing] = useState(false);
  const [activeRegion, setActiveRegion] = useState<string>("All");
  const [loading, setLoading] = useState(true);
  const [visible, setVisible] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [autostartEnabled, setAutostartEnabled] = useState(false);
  const [autostartMode, setAutostartMode] = useState("normal");
  const [updateStatus, setUpdateStatus] = useState("");
  const [updateProgress, setUpdateProgress] = useState(-1);
  const terminalEndRef = useRef<HTMLDivElement>(null);
  const storeRef = useRef<any>(null);

  const [version, setVersion] = useState("");

  useEffect(() => {
    let active = true;
    let unlisteners: (() => void)[] = [];
    let updateIntervalId: ReturnType<typeof setInterval> | null = null;

    const runUpdateCheck = async () => {
      if (!import.meta.env.DEV) {
        try {
          addLog("Updater // Checking for updates...");
          const update = await check();
          if (update && active) {
            await getCurrentWindow().show();
            await getCurrentWindow().setFocus();
            addLog(`Updater // New version available: ${update.version}. Downloading...`);
            setUpdateStatus("Downloading update...");
            setUpdateProgress(0);
            let downloaded = 0;
            let total = 0;
            await update.downloadAndInstall((event) => {
              if (event.event === 'Started') {
                total = event.data.contentLength || 0;
              } else if (event.event === 'Progress') {
                downloaded += event.data.chunkLength;
                const pct = total > 0 ? Math.round((downloaded / total) * 100) : 0;
                setUpdateProgress(pct);
                setUpdateStatus(`Downloading update: ${pct}%`);
              } else if (event.event === 'Finished') {
                setUpdateStatus("Update finished. Restarting...");
              }
            });
            addLog("Updater // Installation successful. Relaunching...");
            await relaunch();
          } else {
            addLog("Updater // No updates available. Running latest version.");
          }
        } catch (updateErr) {
          const msg = updateErr instanceof Error ? updateErr.message : String(updateErr);
          addLog(`Updater // Error: ${msg}`);
          console.error("Update check failed:", updateErr);
        }
      }
    };

    const init = async () => {
      try {
        await runUpdateCheck();

        const appVersion = await getVersion();
        setVersion(appVersion);

        const store = await Store.load("settings.json");
        if (!active) return;
        storeRef.current = store;

        addLog("Sombra console initialized. Ready.");

        const serversData = await invoke<ServerState[]>("get_servers");
        if (!active) return;
        setServers(serversData);

        const stateData = await invoke<AppStatePayload>("get_app_state");
        if (!active) return;
        setAppState(stateData);
        setAutostartEnabled(stateData.autostart_enabled);
        setAutostartMode(stateData.autostart_mode);
        addLog(`Loaded state. Mode: ${stateData.mode}. Admin: ${stateData.is_admin}`);

        // --- Window position persistence ---
        const restoreWindowPosition = async () => {
          try {
            const saved = await store.get<{ x: number; y: number }>("window_position");
            if (saved && typeof saved.x === "number" && typeof saved.y === "number") {
              // Verify the saved position is within an available monitor
              const monitors = await availableMonitors();
              const inBounds = monitors.some((m: Monitor) => {
                const mx = m.position.x;
                const my = m.position.y;
                const mw = m.size.width;
                const mh = m.size.height;
                return saved.x >= mx && saved.x < mx + mw && saved.y >= my && saved.y < my + mh;
              });
              if (inBounds) {
                await getCurrentWindow().setPosition(new PhysicalPosition(saved.x, saved.y));
              }
            }
          } catch (e) {
            console.warn("Failed to restore window position:", e);
          }
        };

        await restoreWindowPosition();

        let moveDebounceTimer: ReturnType<typeof setTimeout> | null = null;
        const unlistenMove = await getCurrentWindow().listen("tauri://move", async () => {
          if (moveDebounceTimer) clearTimeout(moveDebounceTimer);
          moveDebounceTimer = setTimeout(async () => {
            try {
              const pos = await getCurrentWindow().outerPosition();
              const st = storeRef.current;
              if (st) {
                await st.set("window_position", { x: pos.x, y: pos.y });
                await st.save();
              }
            } catch (e) {
              console.warn("Failed to save window position:", e);
            }
          }, 500);
        });
        unlisteners.push(unlistenMove);

        const unlistenRestorePos = await getCurrentWindow().listen("restore-position", async () => {
          await restoreWindowPosition();
        });
        unlisteners.push(unlistenRestorePos);
        // ------------------------------------

        const unlistenServers = await listen<ServerState[]>("servers-update", (event) => {
          setServers(event.payload);
        });
        if (!active) {
          unlistenServers();
          return;
        }
        unlisteners.push(unlistenServers);

        const unlistenStatus = await listen<string>("status-message", (event) => {
          addLog(event.payload);
          if (event.payload.includes("Optimization Complete") || event.payload.includes("Optimization Failed")) {
            setOptimizing(false);
          }
        });
        if (!active) {
          unlistenStatus();
          return;
        }
        unlisteners.push(unlistenStatus);

        await new Promise((resolve) => setTimeout(resolve, 1000));
        if (!active) return;
        setLoading(false);
        setTimeout(() => {
          if (active) setVisible(false);
        }, 300);

        // Check for updates every hour after the initial startup check
        if (!import.meta.env.DEV) {
          const ONE_HOUR = 60 * 60 * 1000;
          updateIntervalId = setInterval(() => {
            if (active) runUpdateCheck();
          }, ONE_HOUR);
        }

      } catch (err) {
        console.error("Initialization error:", err);
      }
    };

    init();

    return () => {
      active = false;
      if (updateIntervalId !== null) clearInterval(updateIntervalId);
      for (const unsub of unlisteners) {
        unsub();
      }
    };
  }, []);


  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => e.preventDefault();
    document.addEventListener("contextmenu", handleContextMenu);
    return () => document.removeEventListener("contextmenu", handleContextMenu);
  }, []);


  const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    const formatted = `[${timestamp}] ${message}`;
    setLogs((prev) => [...prev, formatted].slice(-100));
  };

  const clearLogs = () => {
    setLogs([]);
    addLog("Terminal console logs cleared.");
  };

  const handleCopyLogs = async () => {
    try {
      await navigator.clipboard.writeText(logs.join("\n"));
      addLog("Console logs successfully copied to clipboard.");
    } catch (err) {
      addLog(`Error copying logs: ${err}`);
    }
  };

  const handleToggleAutostart = async (checked: boolean) => {
    try {
      if (checked) {
        await enable();
      } else {
        await disable();
      }
      setAutostartEnabled(checked);
      await invoke("save_autostart_settings", { enabled: checked, mode: autostartMode });
      addLog(`Settings // Autostart ${checked ? "enabled" : "disabled"}`);
    } catch (err) {
      addLog(`Settings Error // Failed to toggle autostart: ${err}`);
    }
  };

  const handleChangeAutostartMode = async (mode: string) => {
    try {
      setAutostartMode(mode);
      await invoke("save_autostart_settings", { enabled: autostartEnabled, mode });
      addLog(`Settings // Autostart mode set to: ${mode}`);
    } catch (err) {
      addLog(`Settings Error // Failed to update autostart mode: ${err}`);
    }
  };


  const handleToggleServer = async (index: number) => {
    try {
      await invoke("toggle_server", { index });
    } catch (err: any) {
      addLog(`Error: ${err}`);
    }
  };

  const handleSetMode = async (mode: OperationMode) => {
    try {
      await invoke("set_mode", { mode });
      setAppState((prev) => {
        if (!prev) return null;
        return { ...prev, mode };
      });
    } catch (err: any) {
      addLog(`Error: ${err}`);
    }
  };

  const handleUnblockAll = async () => {
    try {
      await invoke("unblock_all");
      setAppState((prev) => {
        if (!prev) return null;
        return { ...prev, mode: "Manual" };
      });
    } catch (err: any) {
      addLog(`Error: ${err}`);
    }
  };

  const handleBlockAll = async () => {
    try {
      await invoke("block_all");
      setAppState((prev) => {
        if (!prev) return null;
        return { ...prev, mode: "Manual" };
      });
    } catch (err: any) {
      addLog(`Error: ${err}`);
    }
  };



  const handleFindBestServer = async () => {
    if (optimizing) return;
    setOptimizing(true);
    addLog("Starting best server sweep...");
    try {
      await invoke("find_best_server");
    } catch (err: any) {
      addLog(`Error: ${err}`);
      setOptimizing(false);
    }
  };

  const getPingClass = (ping: number | null) => {
    if (ping === null) return "text-slate-500 font-mono";
    if (ping < 100) return "text-emerald-400 font-bold font-mono";
    if (ping <= 200) return "text-amber-400 font-semibold font-mono";
    return "text-rose-500 font-bold font-mono";
  };

  const regions = ["All", "USA", "South America", "Europe", "Asia"];

  const filteredServers = servers.filter((s) => {
    if (activeRegion === "All") return true;
    return s.region === activeRegion;
  });



  const handleMinimize = () => {
    getCurrentWindow().minimize();
  };

  const handleClose = async () => {
    if (autostartMode === "icon") {
      // Tray-only mode: hide window, keep process alive in background.
      await getCurrentWindow().hide();
    } else {
      // Normal / minimized mode: X button kills the process entirely.
      await exit(0);
    }
  };


  return (
    <div className="flex flex-col w-full h-full bg-slate-950 text-slate-100 select-none relative overflow-hidden">
      {visible && (
        <div className={`fixed inset-0 z-50 flex flex-col items-center justify-center bg-slate-950 transition-opacity duration-300 ${loading ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
          <div className="relative flex items-center justify-center w-20 h-20 rounded bg-violet-600/10 border border-violet-500/20 shadow-[0_0_40px_rgba(139,92,246,0.06)] mb-6 animate-pulse">
            <img src={logo} alt="Sombra Logo" className="w-12 h-12" />
          </div>
          <div className="flex flex-col items-center gap-1 font-mono text-center">
            <span className="text-[10px] font-bold tracking-[0.2em] text-violet-400 uppercase animate-pulse">
              {updateProgress >= 0 ? "SYSTEM UPDATE IN PROGRESS" : "LOADING PROTOCOL"}
            </span>
            <span className="text-[8px] text-slate-500 tracking-wider">
              {updateProgress >= 0 ? updateStatus : "ESTABLISHING ROUTING TUNNEL..."}
            </span>
            {updateProgress >= 0 && (
              <div className="w-48 h-1 bg-slate-900 rounded-full mt-4 overflow-hidden border border-slate-800">
                <div
                  className="h-full bg-violet-500 transition-all duration-300 shadow-[0_0_8px_rgba(139,92,246,0.5)]"
                  style={{ width: `${updateProgress}%` }}
                />
              </div>
            )}
          </div>
        </div>
      )}


      <div
        className="flex justify-between items-center h-8 bg-slate-900/60 border-b border-slate-800/60 px-3 shrink-0"
        data-tauri-drag-region
      >
        <div className="flex items-center gap-2" data-tauri-drag-region>
          <img src={logo} alt="Sombra Logo" className="w-3.5 h-3.5 pointer-events-none" />
          <span className="text-[10px] font-mono font-bold tracking-wider text-slate-400 uppercase pointer-events-none" data-tauri-drag-region>
            SOMBRA  v{version}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowSettings(true)}
            className="flex items-center justify-center w-6 h-6 rounded text-slate-400 hover:text-violet-400 hover:bg-slate-800/80 transition-colors duration-150 cursor-pointer"
            title="Settings"
          >
            <Settings size={12} />
          </button>
          <button
            onClick={handleMinimize}
            className="flex items-center justify-center w-6 h-6 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800/80 transition-colors duration-150 cursor-pointer"
            title="Minimize"
          >
            <Minus size={12} />
          </button>
          <button
            onClick={handleClose}
            className="flex items-center justify-center w-6 h-6 rounded text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors duration-150 cursor-pointer"
            title="Close"
          >
            <X size={12} />
          </button>
        </div>
      </div>


      <div className="flex flex-col flex-1 p-4 gap-4 min-h-0">

        <header className="flex justify-between items-center h-14 px-4 bg-slate-900 border border-slate-800 rounded-lg shadow-md shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-8 h-8 rounded bg-violet-600/10 border border-violet-500/30">
              <img src={logo} alt="Sombra Logo" className="w-5 h-5" />
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-extrabold tracking-widest text-slate-100 font-sans uppercase">
                SOMBRA
              </span>
              <span className="text-[8px] font-mono font-semibold tracking-wider text-violet-400">

              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">

            <div className={`flex items-center gap-1.5 px-3 py-1 rounded border font-mono text-[9px] font-semibold transition-all duration-300 ${appState?.is_admin
              ? "text-emerald-400 border-emerald-500/20 bg-emerald-500/5 shadow-[0_0_10px_rgba(16,185,129,0.03)]"
              : "text-rose-400 border-rose-500/20 bg-rose-500/5"
              }`}>
              {appState?.is_admin ? (
                <>
                  <ShieldCheck size={11} className="text-emerald-400" />
                  <span>PRIVILEGED</span>
                </>
              ) : (
                <>
                  <Lock size={11} className="text-rose-400" />
                  <span>NO ADMIN</span>
                </>
              )}
            </div>


            <div className="flex items-center gap-1.5 px-3 py-1 rounded border border-violet-500/20 bg-violet-500/5 text-violet-400 font-mono text-[9px] font-semibold shadow-[0_0_10px_rgba(139,92,246,0.03)]">
              <Route size={11} className="text-violet-400" />
              <span>MODE: {appState ? appState.mode.toUpperCase().replace("AUTO", "AUTO // ") : "LOADING..."}</span>
            </div>
          </div>
        </header>


        <main className="grid grid-cols-1 lg:grid-cols-12 gap-4 flex-1 min-h-0">


          <section className="lg:col-span-7 flex flex-col h-full bg-slate-900 border border-slate-800 rounded-lg p-4 min-h-0 shadow-md">
            <div className="flex justify-between items-center border-b border-slate-800 pb-3 mb-3">
              <div className="flex items-center gap-2">
                <Server size={14} className="text-violet-400" />
                <h2 className="text-xs font-bold tracking-widest text-slate-100 font-sans uppercase">
                  Target Servers
                </h2>
              </div>


              <div className="flex gap-1.5">
                {regions.map((r) => (
                  <button
                    key={r}
                    className={`px-3 py-1 text-[9px] font-semibold rounded border transition-all duration-200 cursor-pointer ${activeRegion === r
                      ? "bg-violet-500/10 border-violet-500/40 text-violet-400 shadow-sm shadow-violet-500/10"
                      : "bg-transparent border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200"
                      }`}
                    onClick={() => setActiveRegion(r)}
                  >
                    {r.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>


            <div className="overflow-y-auto flex-1 min-h-0 pr-1">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-slate-800/50 text-left">
                    <th className="font-mono text-[9px] text-slate-500 font-semibold px-3 py-2">REGION</th>
                    <th className="font-mono text-[9px] text-slate-500 font-semibold px-3 py-2">NODE</th>
                    <th className="font-mono text-[9px] text-slate-500 font-semibold px-3 py-2">IDENT</th>
                    <th className="font-mono text-[9px] text-slate-500 font-semibold px-3 py-2">LATENCY</th>
                    <th className="font-mono text-[9px] text-slate-500 font-semibold px-3 py-2 text-right">STATUS</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredServers.map((server) => {
                    const globalIndex = servers.findIndex((s) => s.description === server.description);
                    const isAutoMode = appState?.mode !== "Manual";
                    const canToggle = !isAutoMode && appState?.is_admin;

                    return (
                      <tr
                        key={server.description}
                        className={`group border-b border-slate-800/30 transition-all duration-150 ${canToggle
                          ? "cursor-pointer hover:bg-violet-500/5"
                          : isAutoMode
                            ? "opacity-50 cursor-not-allowed select-none bg-slate-950/20"
                            : "opacity-95 cursor-not-allowed select-none"
                          }`}
                        onClick={() => canToggle && handleToggleServer(globalIndex)}
                      >
                        <td className="px-3 py-2">
                          <span className="font-mono text-[9px] font-semibold text-slate-400 bg-slate-950/60 px-2 py-0.5 rounded border border-slate-800">
                            {server.region.toUpperCase()}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <span className={`text-xs font-semibold ${server.is_blocked ? "text-slate-500 line-through" : "text-slate-200"}`}>
                            {server.name}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <span className="font-mono text-[10px] text-slate-400">
                            {server.description}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <span className={`text-xs ${getPingClass(server.current_ping)}`}>
                            {server.current_ping !== null ? `${server.current_ping} ms` : "TIMED OUT"}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {isAutoMode && (
                              <Lock size={10} className="text-slate-400/60 shrink-0" />
                            )}
                            <span className={`inline-block font-mono text-[9px] font-bold px-2 py-0.5 rounded border transition-all duration-200 ${server.is_blocked
                              ? "text-rose-400 border-rose-500/20 bg-rose-500/5 group-hover:border-rose-500/40"
                              : "text-emerald-400 border-emerald-500/20 bg-emerald-500/5 group-hover:border-emerald-500/40"
                              }`}>
                              {server.is_blocked ? "BLOCKED" : "UNRESTRICTED"}
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>


          <section className="lg:col-span-5 flex flex-col h-full bg-slate-900 border border-slate-800 rounded-lg p-4 min-h-0 shadow-md">
            <div className="flex items-center gap-2 border-b border-slate-800 pb-3 mb-4 shrink-0">
              <Cpu size={14} className="text-violet-400" />
              <h2 className="text-xs font-bold tracking-widest text-slate-100 font-sans uppercase">
                System Controls
              </h2>
            </div>

            <div className="flex flex-col flex-1 overflow-y-auto pr-1">

              <div className="mb-4">
                <div className="flex justify-between items-center mb-2">
                  <span className="block font-mono text-[9px] font-semibold text-slate-500 tracking-wider">
                    ROUTING MODE
                  </span>
                  {servers.some((s) => s.is_blocked) ? (
                    <button
                      className="text-[9px] font-bold border border-emerald-500/30 text-emerald-400 bg-emerald-500/5 px-2.5 py-0.5 rounded hover:bg-emerald-500/10 hover:text-emerald-300 transition-colors duration-150 cursor-pointer"
                      onClick={handleUnblockAll}
                    >
                      UNBLOCK ALL
                    </button>
                  ) : (
                    <button
                      className="text-[9px] font-bold border border-rose-500/30 text-rose-400 bg-rose-500/5 px-2.5 py-0.5 rounded hover:bg-rose-500/10 hover:text-rose-300 transition-colors duration-150 cursor-pointer"
                      onClick={handleBlockAll}
                    >
                      BLOCK ALL
                    </button>
                  )}
                </div>


                <div className="flex bg-slate-950 p-1 rounded-lg border border-slate-800 relative w-full mb-3.5">
                  <button
                    onClick={() => handleSetMode("Manual")}
                    className={`flex-1 py-1.5 text-[9.5px] font-bold font-sans rounded transition-all duration-200 cursor-pointer text-center relative z-10 ${appState?.mode === "Manual"
                      ? "text-violet-400 bg-slate-900 border border-slate-800/80 shadow-sm"
                      : "text-slate-500 hover:text-slate-300"
                      }`}
                  >
                    MANUAL CONFIG
                  </button>
                  <button
                    onClick={() => handleSetMode("AutoGlobal")}
                    className={`flex-1 py-1.5 text-[9.5px] font-bold font-sans rounded transition-all duration-200 cursor-pointer text-center relative z-10 ${appState?.mode !== "Manual"
                      ? "text-violet-400 bg-slate-900 border border-slate-800/80 shadow-sm"
                      : "text-slate-500 hover:text-slate-300"
                      }`}
                  >
                    SMART AUTO-ROUTING
                  </button>
                </div>


                {appState?.mode !== "Manual" && (
                  <div className="flex flex-col gap-1.5 mb-2.5 animate-fadeIn">
                    <span className="block font-mono text-[9px] font-semibold text-slate-500 tracking-wider">
                      AUTO ROUTING TARGET REGION
                    </span>
                    <div className="grid grid-cols-5 gap-1.5 bg-slate-950/40 p-1 border border-slate-800/80 rounded-md">
                      {([
                        { mode: "AutoGlobal", label: "GLOBAL" },
                        { mode: "AutoSA", label: "S.A." },
                        { mode: "AutoUSA", label: "USA" },
                        { mode: "AutoEurope", label: "EU" },
                        { mode: "AutoAsia", label: "ASIA" }
                      ] as const).map((item) => {
                        const isCurrentRegion = appState?.mode === item.mode;
                        return (
                          <button
                            key={item.mode}
                            onClick={() => handleSetMode(item.mode)}
                            className={`py-1.5 text-[9px] font-bold font-mono rounded border transition-all duration-150 cursor-pointer text-center ${isCurrentRegion
                              ? "bg-violet-500/10 border-violet-500 text-violet-400 shadow-[0_0_8px_rgba(139,92,246,0.15)]"
                              : "bg-slate-950 border-slate-900/50 text-slate-500 hover:border-slate-800 hover:text-slate-300"
                              }`}
                          >
                            {item.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>


              {appState?.tunneling_path && (
                <div className="text-[8.5px] font-mono text-slate-500 truncate px-2.5 bg-slate-950/40 py-1.5 rounded border border-slate-800/50 mb-4">
                  <span className="text-violet-400 font-semibold">BOUND TO: </span>
                  {appState.tunneling_path}
                </div>
              )}
            </div>


            <div className="mt-auto bg-slate-950/50 border border-slate-800/80 rounded-lg p-3 flex flex-col gap-2.5">
              <div className="flex flex-col gap-0.5 text-[10px] text-slate-400">
                <span className="font-bold text-slate-200 text-xs flex items-center gap-1.5">
                  <Activity size={12} className="text-violet-400" />
                  FIND BEST SERVER
                </span>
                <span>Pings all servers and selects the one with the lowest latency.</span>
              </div>

              <button
                className={`w-full py-2 px-4 font-sans text-[10px] font-bold tracking-wider rounded-md border transition-all duration-200 cursor-pointer text-center ${optimizing
                  ? "bg-slate-950/40 border-violet-500/20 text-violet-400/50"
                  : "bg-violet-500/5 border-violet-500/20 text-violet-400 hover:bg-violet-500/10 hover:border-violet-500/40 hover:text-violet-300 shadow-[0_0_12px_rgba(139,92,246,0.03)] active:scale-[0.98]"
                  }`}
                disabled={optimizing}
                onClick={handleFindBestServer}
              >
                {optimizing ? (
                  <div className="flex items-center justify-center gap-1.5">
                    <RefreshCw size={12} className="animate-spin text-violet-400" />
                    <span>SCANNING SERVERS...</span>
                  </div>
                ) : (
                  <span>FIND BEST SERVER</span>
                )}
              </button>
            </div>
          </section>
        </main>


        <footer className="h-40 flex flex-col bg-slate-900 border border-slate-800 rounded-lg p-3 shadow-md shrink-0">
          <div className="flex justify-between items-center border-b border-slate-800 pb-2 mb-2">
            <div className="flex items-center gap-2">
              <Terminal size={12} className="text-violet-400" />
              <span className="font-mono text-[9px] font-semibold text-slate-400 tracking-wider uppercase">
                LOGS
              </span>
            </div>
            <div className="flex items-center gap-3">
              <button
                className="flex items-center gap-1 text-[9px] font-mono text-slate-500 hover:text-violet-400 transition-colors duration-150 cursor-pointer"
                onClick={handleCopyLogs}
              >
                <Copy size={11} />
                <span>COPY LOGS</span>
              </button>
              <button
                className="flex items-center gap-1 text-[9px] font-mono text-slate-500 hover:text-rose-400 transition-colors duration-150 cursor-pointer"
                onClick={clearLogs}
              >
                <Trash2 size={11} />
                <span>CLEAR CONSOLE</span>
              </button>
            </div>
          </div>
          <div className="overflow-y-auto flex-1 font-mono text-[10px] text-slate-300 leading-relaxed pr-1 selection:bg-violet-500/30">
            {logs.map((log, i) => {
              const isError = /error|failed|warning|fail/i.test(log);
              return (
                <div key={i} className={`flex gap-2 py-0.5 border-b border-slate-900/10 ${isError ? "text-rose-400 font-semibold" : "text-slate-300"}`}>
                  <span className={`${isError ? "text-rose-500" : "text-violet-400"} font-semibold shrink-0`}>&gt;</span>
                  <span className="whitespace-pre-wrap">{log}</span>
                </div>
              );
            })}
            <div ref={terminalEndRef} />
          </div>
        </footer>
      </div>

      {showSettings && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm">
          <div className="w-[450px] bg-slate-900 border border-slate-800 rounded-lg p-5 shadow-2xl relative">
            <button
              onClick={() => setShowSettings(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
            >
              <X size={16} />
            </button>

            <div className="flex items-center gap-2 border-b border-slate-800 pb-3 mb-4">
              <Settings size={14} className="text-violet-400" />
              <h2 className="text-xs font-bold tracking-widest text-slate-100 font-mono uppercase">
                SYSTEM PROTOCOLS
              </h2>
            </div>

            <div className="flex flex-col gap-4 text-xs font-mono">
              <div className="flex items-center justify-between bg-slate-950/40 p-3 rounded border border-slate-800/80">
                <div className="flex flex-col gap-0.5">
                  <span className="font-bold text-slate-200">AUTO-START</span>
                  <span className="text-[9px] text-slate-500">Launch Sombra when the operating system starts.</span>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autostartEnabled}
                    onChange={(e) => handleToggleAutostart(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-800 rounded-full peer peer-focus:ring-0 peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-slate-400 peer-checked:after:bg-violet-400 after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-violet-950/40 border border-slate-800 peer-checked:border-violet-500/40"></div>
                </label>
              </div>

              {autostartEnabled && (
                <div className="flex flex-col gap-2 bg-slate-950/40 p-3 rounded border border-slate-800/80">
                  <span className="font-bold text-violet-400 text-[10px]">
                    STARTUP MODE
                  </span>
                  <div className="flex flex-col gap-2 mt-1">
                    {[
                      { mode: "normal", label: "Normal", desc: "Opens the application interface as usual." },
                      { mode: "minimized", label: "Minimized", desc: "Starts the application minimized to the taskbar." },
                      { mode: "icon", label: "Hidden in Tray", desc: "Starts in the background. Double-click the tray icon to open." }
                    ].map((item) => (
                      <label
                        key={item.mode}
                        className={`flex items-start gap-3 p-2.5 rounded border transition-all duration-150 cursor-pointer ${
                          autostartMode === item.mode
                            ? "bg-violet-500/5 border-violet-500/40 text-violet-300 shadow-[0_0_8px_rgba(139,92,246,0.05)]"
                            : "bg-slate-950/80 border-slate-900 text-slate-400 hover:border-slate-800 hover:text-slate-300"
                        }`}
                      >
                        <input
                          type="radio"
                          name="autostartMode"
                          value={item.mode}
                          checked={autostartMode === item.mode}
                          onChange={() => handleChangeAutostartMode(item.mode)}
                          className="mt-0.5 accent-violet-500 cursor-pointer"
                        />
                        <div className="flex flex-col gap-0.5">
                          <span className="font-bold text-[10px]">{item.label}</span>
                          <span className="text-[9px] text-slate-500 leading-normal">{item.desc}</span>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="mt-5 border-t border-slate-800 pt-3 flex justify-end">
              <button
                onClick={() => setShowSettings(false)}
                className="px-4 py-1.5 font-mono text-[9px] font-bold tracking-wider rounded border border-violet-500/20 bg-violet-500/5 text-violet-400 hover:bg-violet-500/10 hover:border-violet-500/40 transition-all cursor-pointer"
              >
                CLOSE SETTINGS
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
