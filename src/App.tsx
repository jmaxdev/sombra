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
  Activity, Lock, Trash2, Cpu, RefreshCw, Route, Terminal, Server, Copy, Minus, X, Settings,
  TrendingUp, AlertTriangle, Clock
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
  | "AutoAsia"
  | "AutoAustralia";

interface AppStatePayload {
  mode: OperationMode;
  tunneling_path: string | null;
  status_message: string;
  is_admin: boolean;
  autostart_enabled: boolean;
  autostart_mode: string;
}

if (!import.meta.env.DEV) {
  document.addEventListener("contextmenu", (e) => e.preventDefault(), true);
}

const TELEMETRY_DAYS = 7;
const TELEMETRY_DURATION_MS = TELEMETRY_DAYS * 24 * 60 * 60 * 1000;

const formatRemainingTime = (remainingMs: number): string => {
  const days = Math.floor(remainingMs / (24 * 3600 * 1000));
  const hours = Math.floor((remainingMs % (24 * 3600 * 1000)) / (3600 * 1000));
  const minutes = Math.floor((remainingMs % (3600 * 1000)) / (60 * 1000));
  
  const parts: string[] = [];
  if (days > 0) {
    parts.push(`${days}d`);
  }
  parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  return parts.join(" ");
};

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
  const [selectedServerForModal, setSelectedServerForModal] = useState<ServerState | null>(null);
  const [latencyHistory, setLatencyHistory] = useState<Record<string, number[]>>({});
  const [isGameRunning, setIsGameRunning] = useState(false);
  const [showGameRunningWarning, setShowGameRunningWarning] = useState(false);
  const [telemetryData, setTelemetryData] = useState<Record<string, Record<number, number[]>>>({});

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

        let firstRun = await store.get<number>("first_run_time");
        if (!firstRun) {
          firstRun = Date.now();
          await store.set("first_run_time", firstRun);
          await store.save();
          addLog(`Telemetry recording started. Best play window will generate in ${TELEMETRY_DAYS} days.`);
        } else {
          const elapsed = Date.now() - firstRun;
          if (elapsed < TELEMETRY_DURATION_MS) {
            const remMs = TELEMETRY_DURATION_MS - elapsed;
            addLog(`Telemetry recording active. ${formatRemainingTime(remMs)} remaining to generate best play window.`);
          } else {
            addLog("Telemetry data loaded. Recommended playing window active.");
          }
        }

        const savedTelemetry = await store.get<Record<string, Record<number, number[]>>>("telemetry") || {};
        setTelemetryData(savedTelemetry);

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

        const restoreWindowPosition = async () => {
          try {
            const saved = await store.get<{ x: number; y: number }>("window_position");
            if (saved && typeof saved.x === "number" && typeof saved.y === "number") {
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

        const unlistenServers = await listen<ServerState[]>("servers-update", (event) => {
          const updatedServers = event.payload;
          setServers(updatedServers);
          setSelectedServerForModal((prev) => {
            if (!prev) return null;
            const updated = updatedServers.find((s) => s.description === prev.description);
            return updated || prev;
          });
          setLatencyHistory((prev) => {
            const nextHistory = { ...prev };
            updatedServers.forEach((s) => {
              if (s.current_ping !== null) {
                const history = nextHistory[s.description] || [];
                nextHistory[s.description] = [...history, s.current_ping].slice(-15);
              }
            });
            return nextHistory;
          });
          setTelemetryData((prev) => {
            const nextTelemetry = { ...prev };
            let modified = false;
            const currentHour = new Date().getHours();
            updatedServers.forEach((s) => {
              if (s.current_ping !== null) {
                if (!nextTelemetry[s.description]) {
                  nextTelemetry[s.description] = {};
                }
                const hourlyPings = nextTelemetry[s.description][currentHour] || [];
                nextTelemetry[s.description][currentHour] = [...hourlyPings, s.current_ping].slice(-30);
                modified = true;
              }
            });
            if (modified && storeRef.current) {
              storeRef.current.set("telemetry", nextTelemetry).then(() => {
                storeRef.current.save();
              });
            }
            return nextTelemetry;
          });
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

  useEffect(() => {
    let active = true;
    const checkGame = async () => {
      try {
        const running = await invoke<boolean>("is_game_running");
        if (active) setIsGameRunning(running);
      } catch (err) {
        console.warn("Failed to check if game is running:", err);
      }
    };
    checkGame();
    const interval = setInterval(checkGame, 5000);
    return () => {
      active = false;
      clearInterval(interval);
    };
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
    if (isGameRunning) {
      setShowGameRunningWarning(true);
      return;
    }
    try {
      await invoke("toggle_server", { index });
    } catch (err: any) {
      addLog(`Error: ${err}`);
    }
  };

  const handleSetMode = async (mode: OperationMode) => {
    if (isGameRunning) {
      setShowGameRunningWarning(true);
      return;
    }
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
    if (isGameRunning) {
      setShowGameRunningWarning(true);
      return;
    }
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
    if (isGameRunning) {
      setShowGameRunningWarning(true);
      return;
    }
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
    if (isGameRunning) {
      setShowGameRunningWarning(true);
      return;
    }
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
      await getCurrentWindow().hide();
    } else {
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
            <span className="text-xs font-bold tracking-[0.2em] text-violet-400 uppercase animate-pulse">
              {updateProgress >= 0 ? "SYSTEM UPDATE IN PROGRESS" : "LOADING PROTOCOL"}
            </span>
            <span className="text-[10px] text-slate-500 tracking-wider">
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
          <span className="text-xs font-mono font-bold tracking-wider text-slate-400 uppercase pointer-events-none" data-tauri-drag-region>
            SOMBRA  v{version}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowSettings(true)}
            className="flex items-center justify-center w-6 h-6 rounded text-slate-400 hover:text-violet-400 hover:bg-slate-800/80 transition-colors duration-150 cursor-pointer"
            title="Settings"
          >
            <Settings size={14} />
          </button>
          <button
            onClick={handleMinimize}
            className="flex items-center justify-center w-6 h-6 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800/80 transition-colors duration-150 cursor-pointer"
            title="Minimize"
          >
            <Minus size={14} />
          </button>
          <button
            onClick={handleClose}
            className="flex items-center justify-center w-6 h-6 rounded text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors duration-150 cursor-pointer"
            title="Close"
          >
            <X size={14} />
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
              <span className="text-base font-extrabold tracking-widest text-slate-100 font-sans uppercase">
                SOMBRA
              </span>
              <span className="text-[8px] font-mono font-semibold tracking-wider text-violet-400">

              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">


            <div className="flex items-center gap-1.5 px-3 py-1 rounded border border-violet-500/20 bg-violet-500/5 text-violet-400 font-mono text-xs font-semibold shadow-[0_0_10px_rgba(139,92,246,0.03)]">
              <Route size={13} className="text-violet-400" />
              <span>MODE: {appState ? appState.mode.toUpperCase().replace("AUTO", "AUTO // ") : "LOADING..."}</span>
            </div>
          </div>
        </header>


        <main className="grid grid-cols-1 lg:grid-cols-12 gap-4 flex-1 min-h-0">


          <section className="lg:col-span-7 flex flex-col h-full bg-slate-900 border border-slate-800 rounded-lg p-4 min-h-0 shadow-md">
            <div className="flex justify-between items-center border-b border-slate-800 pb-3 mb-3">
              <div className="flex items-center gap-2">
                <Server size={16} className="text-violet-400" />
                <h2 className="text-sm font-bold tracking-widest text-slate-100 font-sans uppercase">
                  Target Servers
                </h2>
              </div>


              <div className="flex gap-1.5">
                {regions.map((r) => (
                  <button
                    key={r}
                    className={`px-3 py-1 text-xs font-semibold rounded border transition-all duration-200 cursor-pointer ${activeRegion === r
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
                    <th className="font-mono text-xs text-slate-500 font-semibold px-3 py-2">REGION</th>
                    <th className="font-mono text-xs text-slate-500 font-semibold px-3 py-2">NODE</th>
                    <th className="font-mono text-xs text-slate-500 font-semibold px-3 py-2">IDENT</th>
                    <th className="font-mono text-xs text-slate-500 font-semibold px-3 py-2">LATENCY (MIN)</th>
                    <th className="font-mono text-xs text-slate-500 font-semibold px-3 py-2 text-right">STATUS</th>
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
                        className="group border-b border-slate-800/30 transition-all duration-150 cursor-pointer hover:bg-violet-500/5"
                        onClick={() => setSelectedServerForModal(server)}
                      >
                        <td className="px-3 py-2">
                          <span className="font-mono text-[10px] font-semibold text-slate-400 bg-slate-950/60 px-2 py-0.5 rounded border border-slate-800">
                            {server.region.toUpperCase()}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <span className={`text-sm font-semibold ${server.is_blocked ? "text-slate-500 line-through" : "text-slate-200"}`}>
                            {server.name}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <span className="font-mono text-xs text-slate-400">
                            {server.description}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <span className={`text-sm ${getPingClass(server.current_ping)}`}>
                            {server.current_ping !== null ? `${server.current_ping} ms` : "TIMED OUT"}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {isAutoMode && (
                              <Lock size={12} className="text-slate-400/60 shrink-0" />
                            )}
                            <span
                              className={`inline-block font-mono text-[10px] font-bold px-2 py-0.5 rounded border transition-all duration-200 ${
                                server.is_blocked
                                  ? "text-rose-400 border-rose-500/20 bg-rose-500/5 group-hover:border-rose-500/40"
                                  : "text-emerald-400 border-emerald-500/20 bg-emerald-500/5 group-hover:border-emerald-500/40"
                              } ${canToggle ? "cursor-pointer hover:bg-emerald-500/10" : ""}`}
                              onClick={(e) => {
                                if (canToggle) {
                                  e.stopPropagation();
                                  handleToggleServer(globalIndex);
                                }
                              }}
                            >
                              {server.is_blocked ? "BLOCKED" : "ALLOWED"}
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
              <Cpu size={16} className="text-violet-400" />
              <h2 className="text-sm font-bold tracking-widest text-slate-100 font-sans uppercase">
                System Controls
              </h2>
            </div>

            <div className="flex flex-col flex-1 overflow-y-auto pr-1">

              <div className="mb-4">
                <div className="flex justify-between items-center mb-2">
                  <span className="block font-mono text-xs font-semibold text-slate-500 tracking-wider">
                    ROUTING MODE
                  </span>
                  {servers.some((s) => s.is_blocked) ? (
                    <button
                      className="text-xs font-bold border border-emerald-500/30 text-emerald-400 bg-emerald-500/5 px-2.5 py-1 rounded hover:bg-emerald-500/10 hover:text-emerald-300 transition-colors duration-150 cursor-pointer"
                      onClick={handleUnblockAll}
                    >
                      UNBLOCK ALL
                    </button>
                  ) : (
                    <button
                      className="text-xs font-bold border border-rose-500/30 text-rose-400 bg-rose-500/5 px-2.5 py-1 rounded hover:bg-rose-500/10 hover:text-rose-300 transition-colors duration-150 cursor-pointer"
                      onClick={handleBlockAll}
                    >
                      BLOCK ALL
                    </button>
                  )}
                </div>


                <div className="flex bg-slate-950 p-1 rounded-lg border border-slate-800 relative w-full mb-3.5">
                  <button
                    onClick={() => handleSetMode("Manual")}
                    className={`flex-1 py-1.5 text-xs font-bold font-sans rounded transition-all duration-200 cursor-pointer text-center relative z-10 ${appState?.mode === "Manual"
                      ? "text-violet-400 bg-slate-900 border border-slate-800/80 shadow-sm"
                      : "text-slate-500 hover:text-slate-300"
                      }`}
                  >
                    MANUAL CONFIG
                  </button>
                  <button
                    onClick={() => handleSetMode("AutoGlobal")}
                    className={`flex-1 py-1.5 text-xs font-bold font-sans rounded transition-all duration-200 cursor-pointer text-center relative z-10 ${appState?.mode !== "Manual"
                      ? "text-violet-400 bg-slate-900 border border-slate-800/80 shadow-sm"
                      : "text-slate-500 hover:text-slate-300"
                      }`}
                  >
                    SMART AUTO-ROUTING
                  </button>
                </div>


                {appState?.mode !== "Manual" && (
                  <div className="flex flex-col gap-1.5 mb-2.5 animate-fadeIn">
                    <span className="block font-mono text-xs font-semibold text-slate-500 tracking-wider">
                      AUTO ROUTING TARGET REGION
                    </span>
                    <div className="grid grid-cols-6 gap-1.5 bg-slate-950/40 p-1 border border-slate-800/80 rounded-md">
                      {([
                        { mode: "AutoGlobal", label: "GLOBAL" },
                        { mode: "AutoSA", label: "S.A." },
                        { mode: "AutoUSA", label: "USA" },
                        { mode: "AutoEurope", label: "EU" },
                        { mode: "AutoAsia", label: "ASIA" },
                        { mode: "AutoAustralia", label: "AUS" }
                      ] as const).map((item) => {
                        const isCurrentRegion = appState?.mode === item.mode;
                        return (
                          <button
                            key={item.mode}
                            onClick={() => handleSetMode(item.mode)}
                            className={`py-1.5 text-[10px] font-bold font-mono rounded border transition-all duration-150 cursor-pointer text-center ${isCurrentRegion
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
                <div className="text-xs font-mono text-slate-500 truncate px-2.5 bg-slate-950/40 py-2 rounded border border-slate-800/50 mb-4">
                  <span className="text-violet-400 font-semibold">BOUND TO: </span>
                  {appState.tunneling_path}
                </div>
              )}
            </div>


            <div className="mt-auto bg-slate-950/50 border border-slate-800/80 rounded-lg p-3 flex flex-col gap-2.5">
              <div className="flex flex-col gap-0.5 text-xs text-slate-400">
                <span className="font-bold text-slate-200 text-sm flex items-center gap-1.5">
                  <Activity size={14} className="text-violet-400" />
                  FIND BEST SERVER
                </span>
                <span>Pings all servers and selects the one with the lowest latency.</span>
              </div>

              <button
                className={`w-full py-2.5 px-4 font-sans text-xs font-bold tracking-wider rounded-md border transition-all duration-200 cursor-pointer text-center ${optimizing
                  ? "bg-slate-950/40 border-violet-500/20 text-violet-400/50"
                  : "bg-violet-500/5 border-violet-500/20 text-violet-400 hover:bg-violet-500/10 hover:border-violet-500/40 hover:text-violet-300 shadow-[0_0_12px_rgba(139,92,246,0.03)] active:scale-[0.98]"
                  }`}
                disabled={optimizing}
                onClick={handleFindBestServer}
              >
                {optimizing ? (
                  <div className="flex items-center justify-center gap-1.5">
                    <RefreshCw size={14} className="animate-spin text-violet-400" />
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
              <Terminal size={14} className="text-violet-400" />
              <span className="font-mono text-xs font-semibold text-slate-400 tracking-wider uppercase">
                LOGS
              </span>
            </div>
            <div className="flex items-center gap-3">
              <button
                className="flex items-center gap-1 text-xs font-mono text-slate-500 hover:text-violet-400 transition-colors duration-150 cursor-pointer"
                onClick={handleCopyLogs}
              >
                <Copy size={13} />
                <span>COPY LOGS</span>
              </button>
              <button
                className="flex items-center gap-1 text-xs font-mono text-slate-500 hover:text-rose-400 transition-colors duration-150 cursor-pointer"
                onClick={clearLogs}
              >
                <Trash2 size={13} />
                <span>CLEAR CONSOLE</span>
              </button>
            </div>
          </div>
          <div className="overflow-y-auto flex-1 font-mono text-xs text-slate-300 leading-relaxed pr-1 selection:bg-violet-500/30">
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
              <Settings size={16} className="text-violet-400" />
              <h2 className="text-sm font-bold tracking-widest text-slate-100 font-mono uppercase">
                SYSTEM PROTOCOLS
              </h2>
            </div>

            <div className="flex flex-col gap-4 text-xs font-mono">
              <div className="flex items-center justify-between bg-slate-950/40 p-3 rounded border border-slate-800/80">
                <div className="flex flex-col gap-0.5 font-sans">
                  <span className="font-bold text-slate-200 text-xs">AUTO-START</span>
                  <span className="text-[10px] text-slate-400">Launch Sombra when the operating system starts.</span>
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
                  <span className="font-bold text-violet-400 text-xs font-sans">
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
                        <div className="flex flex-col gap-0.5 font-sans">
                          <span className="font-bold text-xs">{item.label}</span>
                          <span className="text-[10px] text-slate-400 leading-normal">{item.desc}</span>
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
                className="px-4 py-2 font-mono text-xs font-bold tracking-wider rounded border border-violet-500/20 bg-violet-500/5 text-violet-400 hover:bg-violet-500/10 hover:border-violet-500/40 transition-all cursor-pointer"
              >
                CLOSE SETTINGS
              </button>
            </div>
          </div>
        </div>
      )}

      {showGameRunningWarning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 animate-fadeIn">
          <div className="w-[420px] bg-slate-900 border border-slate-800 rounded-xl shadow-2xl relative overflow-hidden flex flex-col p-5">
            <div className="flex items-center gap-3 text-amber-500 mb-3">
              <AlertTriangle size={20} className="shrink-0" />
              <h3 className="text-sm font-bold text-slate-100">
                Action Blocked
              </h3>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed font-sans">
              It is not possible to perform these actions while the game is running. Please close Overwatch 2 before modifying network configurations or blocking/unblocking servers.
            </p>
            <div className="mt-5 flex justify-end">
              <button
                onClick={() => setShowGameRunningWarning(false)}
                className="px-4 py-2 font-mono text-xs font-bold tracking-wider rounded border border-violet-500/20 bg-violet-500/5 text-violet-400 hover:bg-violet-500/10 hover:border-violet-500/40 transition-all cursor-pointer"
              >
                UNDERSTOOD
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedServerForModal && (() => {
        const server = selectedServerForModal;
        const isAutoMode = appState?.mode !== "Manual";
        const canToggle = !isAutoMode && appState?.is_admin;
        const globalIndex = servers.findIndex((s) => s.description === server.description);

        const rtHistory = latencyHistory[server.description] || (server.current_ping !== null ? [server.current_ping] : []);
        const minPing = rtHistory.length > 0 ? Math.min(...rtHistory) : null;
        const maxPing = rtHistory.length > 0 ? Math.max(...rtHistory) : null;
        const avgPing = rtHistory.length > 0 ? Math.round(rtHistory.reduce((a, b) => a + b, 0) / rtHistory.length) : null;
        const jitter = (minPing !== null && maxPing !== null) ? Math.max(0, maxPing - minPing) : 0;
        const estRtt = avgPing !== null ? (avgPing + 30) : null;

        const rtMax = rtHistory.length > 0 ? Math.max(...rtHistory, 1) : 100;
        const rtMin = rtHistory.length > 0 ? Math.min(...rtHistory) : 0;
        const rtRange = Math.max(rtMax - rtMin, 15);
        const graphMin = Math.max(0, rtMin - rtRange * 0.1);
        const graphMax = rtMax + rtRange * 0.1;

        const hourlyAverages = Array.from({ length: 24 }, (_, hour) => {
          const pings = telemetryData[server.description]?.[hour] || [];
          if (pings.length === 0) return null;
          return Math.round(pings.reduce((a, b) => a + b, 0) / pings.length);
        });

        const currentHour = new Date().getHours();
        const recordedHoursCount = hourlyAverages.filter(val => val !== null).length;
        const hasEnoughTelemetry = recordedHoursCount >= 3;

        let recommendedHoursStr = "Collecting telemetry...";
        let averageHistorical = 0;
        if (hasEnoughTelemetry) {
          const validAverages = hourlyAverages.filter((v): v is number => v !== null);
          averageHistorical = validAverages.reduce((a, b) => a + b, 0) / validAverages.length;
          
          const goodHours: number[] = [];
          hourlyAverages.forEach((v, h) => {
            if (v !== null && v < averageHistorical) {
              goodHours.push(h);
            }
          });

          const formatRecommendedHours = (hours: number[]) => {
            if (hours.length === 0) return "N/A";
            const ranges: string[] = [];
            let start = hours[0];
            let prev = hours[0];
            for (let i = 1; i <= hours.length; i++) {
              const curr = hours[i];
              if (curr !== prev + 1 || i === hours.length) {
                if (start === prev) {
                  ranges.push(`${start.toString().padStart(2, '0')}:00`);
                } else {
                  ranges.push(`${start.toString().padStart(2, '0')}:00 - ${prev.toString().padStart(2, '0')}:00`);
                }
                start = curr;
              }
              prev = curr;
            }
            return ranges.join(", ");
          };
          recommendedHoursStr = formatRecommendedHours(goodHours);
        }

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 animate-fadeIn">
            <div className="w-[600px] bg-slate-900 border border-slate-800 rounded-xl shadow-2xl relative overflow-hidden flex flex-col max-h-[90vh]">
              
              <div className="flex items-start justify-between border-b border-slate-800 p-4 bg-slate-950/20">
                <div className="flex flex-col">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] font-semibold text-violet-400 bg-violet-500/10 px-2 py-0.5 rounded border border-violet-500/20">
                      {server.region.toUpperCase()}
                    </span>
                    <span className="font-mono text-xs text-slate-400 font-semibold">
                      {server.description}
                    </span>
                  </div>
                  <h2 className="text-base font-bold text-slate-100 mt-1">
                    {server.name}
                  </h2>
                </div>
                <button
                  onClick={() => setSelectedServerForModal(null)}
                  className="text-slate-400 hover:text-slate-200 transition-colors cursor-pointer p-1"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="p-4 overflow-y-auto flex-1 flex flex-col gap-4 text-xs font-sans text-slate-300">
                
                <div className="bg-gradient-to-br from-violet-950/30 to-slate-900/50 border border-violet-500/20 p-4 rounded-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex flex-col gap-1 flex-1">
                    <span className="text-xs font-bold text-violet-400 font-mono tracking-wider uppercase">
                      Estimated In-Game Latency (RTT)
                    </span>
                    <p className="text-[11px] text-slate-400 leading-relaxed max-w-[340px] mt-1">
                      This represents the round-trip time shown in Overwatch 2, which includes network ping plus ~30ms of game engine, rendering, and server tick overhead.
                    </p>
                  </div>
                  <div className="flex items-baseline gap-1 bg-slate-950/50 border border-slate-800/80 px-4 py-3 rounded-lg shrink-0 justify-center">
                    <span className={`text-4xl font-extrabold tracking-tight ${getPingClass(estRtt)}`}>
                      {estRtt !== null ? estRtt : "—"}
                    </span>
                    <span className="text-xs text-slate-400 font-mono">ms</span>
                  </div>
                </div>

                <div className="grid grid-cols-4 gap-2.5">
                  
                  <div className="bg-slate-950/40 border border-slate-800/80 p-3 rounded-lg flex flex-col justify-between">
                    <span className="text-[10px] font-semibold text-slate-500 font-mono tracking-wider uppercase">
                      Ping (Min)
                    </span>
                    <div className="flex items-baseline gap-0.5 mt-2">
                      <span className={`text-lg font-bold ${getPingClass(minPing)}`}>
                        {minPing !== null ? minPing : "—"}
                      </span>
                      <span className="text-[10px] text-slate-500 font-mono">ms</span>
                    </div>
                  </div>

                  <div className="bg-slate-950/40 border border-slate-800/80 p-3 rounded-lg flex flex-col justify-between">
                    <span className="text-[10px] font-semibold text-slate-500 font-mono tracking-wider uppercase">
                      Ping (Avg)
                    </span>
                    <div className="flex items-baseline gap-0.5 mt-2">
                      <span className={`text-lg font-bold ${getPingClass(avgPing)}`}>
                        {avgPing !== null ? avgPing : "—"}
                      </span>
                      <span className="text-[10px] text-slate-500 font-mono">ms</span>
                    </div>
                  </div>

                  <div className="bg-slate-950/40 border border-slate-800/80 p-3 rounded-lg flex flex-col justify-between">
                    <span className="text-[10px] font-semibold text-slate-500 font-mono tracking-wider uppercase">
                      Ping (Max)
                    </span>
                    <div className="flex items-baseline gap-0.5 mt-2">
                      <span className={`text-lg font-bold ${getPingClass(maxPing)}`}>
                        {maxPing !== null ? maxPing : "—"}
                      </span>
                      <span className="text-[10px] text-slate-500 font-mono">ms</span>
                    </div>
                  </div>

                  <div className="bg-slate-950/40 border border-slate-800/80 p-3 rounded-lg flex flex-col justify-between">
                    <span className="text-[10px] font-semibold text-slate-500 font-mono tracking-wider uppercase">
                      Jitter (Var)
                    </span>
                    <div className="flex items-baseline gap-0.5 mt-2">
                      <span className={`text-lg font-bold ${jitter > 15 ? "text-amber-400" : "text-slate-300"}`}>
                        {jitter}
                      </span>
                      <span className="text-[10px] text-slate-500 font-mono">ms</span>
                    </div>
                  </div>

                </div>

                <div className="bg-slate-950/40 border border-slate-800/80 p-3.5 rounded-lg flex items-center justify-between">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] font-semibold text-slate-500 font-mono tracking-wider uppercase">
                      Firewall State
                    </span>
                    <span className={`inline-block font-mono text-[10px] font-bold px-2 py-0.5 rounded border mt-1.5 w-fit ${
                      server.is_blocked
                        ? "text-rose-400 border-rose-500/20 bg-rose-500/5"
                        : "text-emerald-400 border-emerald-500/20 bg-emerald-500/5"
                    }`}>
                      {server.is_blocked ? "BLOCKED" : "ALLOWED"}
                    </span>
                  </div>
                  
                  {canToggle && (
                    <button
                      onClick={() => handleToggleServer(globalIndex)}
                      className={`px-3 py-1.5 text-xs font-mono font-bold rounded border cursor-pointer transition-all duration-150 ${
                        server.is_blocked
                          ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-400 hover:bg-emerald-500/10 hover:border-emerald-500/40"
                          : "border-rose-500/20 bg-rose-500/5 text-rose-400 hover:bg-rose-500/10 hover:border-rose-500/40"
                      }`}
                    >
                      {server.is_blocked ? "ALLOW" : "BLOCK"}
                    </button>
                  )}
                </div>

                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-400 font-mono tracking-wider uppercase flex items-center gap-1.5">
                      <TrendingUp size={14} className="text-violet-400" />
                      Real-Time Network Ping Trend
                    </span>
                    <span className="text-[10px] text-slate-500 font-mono">
                      Updates every 8s
                    </span>
                  </div>
                  
                  <div className="bg-slate-950/40 border border-slate-800/80 p-3 rounded-lg h-32 flex items-center justify-center relative">
                    {rtHistory.length < 2 ? (
                      <div className="text-xs font-mono text-slate-400 flex items-center gap-2">
                        <RefreshCw size={12} className="animate-spin text-violet-400" />
                        Acquiring real-time network latency readings...
                      </div>
                    ) : (() => {
                      const width = 530;
                      const height = 90;
                      const points = rtHistory.map((val, idx) => {
                        const x = (idx / (rtHistory.length - 1)) * width;
                        const y = height - ((val - graphMin) / (graphMax - graphMin || 1)) * height;
                        return { x, y, val };
                      });
                      
                      const linePath = points.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
                      const areaPath = `${linePath} L ${width} ${height} L 0 ${height} Z`;

                      return (
                        <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
                          <defs>
                            <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.2" />
                              <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0.0" />
                            </linearGradient>
                          </defs>
                          <path d={areaPath} fill="url(#areaGrad)" />
                          <path d={linePath} fill="none" stroke="#a78bfa" strokeWidth="1.5" />
                          {points.map((p, idx) => (
                            <g key={idx} className="group/node">
                              <circle
                                cx={p.x}
                                cy={p.y}
                                r="2.5"
                                className="fill-violet-400 stroke-slate-900 stroke-1 hover:r-4 transition-all"
                              />
                              <title>{p.val} ms</title>
                            </g>
                          ))}
                        </svg>
                      );
                    })()}
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-400 font-mono tracking-wider uppercase flex items-center gap-1.5">
                      <Clock size={14} className="text-violet-400" />
                      Historical 24-Hour Profile
                    </span>
                    <span className="text-[10px] text-slate-500 font-mono">
                      {recordedHoursCount}/24 hours recorded
                    </span>
                  </div>
                  
                  {recordedHoursCount === 0 ? (
                    <div className="flex flex-col items-center justify-center h-24 bg-slate-950/40 border border-slate-800/80 p-3 rounded-lg text-center font-mono">
                      <RefreshCw size={14} className="animate-spin text-violet-400 mb-2" />
                      <span className="text-[10px] text-slate-400 font-bold tracking-wider">ANALYZING NETWORK PROFILE</span>
                      <span className="text-[9px] text-slate-500 mt-1">Recording hourly latency baseline. Keep Sombra open to collect data.</span>
                    </div>
                  ) : (
                    <div className="flex items-end justify-between h-24 bg-slate-950/40 border border-slate-800/80 p-3 rounded-lg gap-[2px]">
                      {hourlyAverages.map((val, h) => {
                        const isCurrent = h === currentHour;
                        const validAverages = hourlyAverages.filter((v): v is number => v !== null);
                        const maxVal = validAverages.length > 0 ? Math.max(...validAverages, 1) : 100;
                        const heightPct = val !== null ? (val / maxVal) * 90 : 0;
                        
                        return (
                          <div
                            key={h}
                            className="flex-1 flex flex-col items-center group relative cursor-pointer"
                            style={{ height: '100%' }}
                          >
                            {val !== null ? (
                              <>
                                <div className="absolute bottom-full mb-1 left-1/2 transform -translate-x-1/2 hidden group-hover:block z-10 bg-slate-950 border border-slate-800 text-[10px] font-mono text-slate-300 rounded px-1.5 py-0.5 whitespace-nowrap shadow-md">
                                  {h.toString().padStart(2, '0')}:00 - {val} ms
                                </div>
                                <div
                                  className={`w-full rounded-t-[1px] transition-all duration-300 ${
                                    isCurrent
                                      ? 'bg-gradient-to-t from-violet-600 to-violet-400 shadow-[0_0_8px_rgba(139,92,246,0.5)]'
                                      : 'bg-slate-700 hover:bg-slate-500'
                                  }`}
                                  style={{ height: `${heightPct}%` }}
                                />
                              </>
                            ) : (
                              <div
                                className="w-full border-t border-dashed border-slate-800/20 bg-slate-950/10"
                                style={{ height: '90%' }}
                                title={`No data for ${h.toString().padStart(2, '0')}:00`}
                              />
                            )}
                            {h % 4 === 0 && (
                              <span className="text-[9px] text-slate-500 font-mono mt-1 select-none">
                                {h}h
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  
                  {!hasEnoughTelemetry ? (
                    <div className="flex items-start gap-2 bg-slate-950/20 border border-slate-800/60 p-3 rounded-lg mt-1 text-xs font-mono">
                      <Clock size={13} className="text-amber-400 shrink-0 mt-0.5" />
                      <div className="flex flex-col gap-0.5">
                        <span className="text-slate-400">Recommended playing window:</span>
                        <span className="text-amber-400 font-bold">COLLECTING DATA...</span>
                        <span className="text-slate-500">Gathering more hourly latency readings to generate optimal recommendations.</span>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start gap-2 bg-slate-950/20 border border-slate-800/60 p-3 rounded-lg mt-1 text-xs font-mono">
                      <Clock size={13} className="text-violet-400 shrink-0 mt-0.5" />
                      <div className="flex flex-col gap-0.5">
                        <span className="text-slate-400">Recommended playing window:</span>
                        <span className="text-emerald-400 font-bold">{recommendedHoursStr}</span>
                        <span className="text-slate-500">Latency is historically lowest during these times (below daily average of {Math.round(averageHistorical)} ms).</span>
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex flex-col gap-1.5">
                  <span className="text-xs font-bold text-slate-400 font-mono tracking-wider uppercase">
                    Connection Diagnostics
                  </span>
                  <div className="bg-slate-950/40 border border-slate-800/80 rounded-lg overflow-hidden font-mono text-[10px]">
                    <div className="grid grid-cols-3 border-b border-slate-800/40 p-2 text-slate-500 font-bold">
                      <div>PROPERTY</div>
                      <div>VALUE</div>
                      <div>DIAGNOSTIC</div>
                    </div>
                    <div className="grid grid-cols-3 border-b border-slate-800/20 p-2">
                      <div className="text-slate-400">Test IP Address</div>
                      <div className="text-slate-300">{server.ping_ip}</div>
                      <div className="text-emerald-400">ICMP Active</div>
                    </div>
                    <div className="grid grid-cols-3 border-b border-slate-800/20 p-2">
                      <div className="text-slate-400">Target Region</div>
                      <div className="text-slate-300">{server.region}</div>
                      <div className="text-slate-500">Static Subnets</div>
                    </div>
                    <div className="grid grid-cols-3 border-b border-slate-800/20 p-2">
                      <div className="text-slate-400">Server Node</div>
                      <div className="text-slate-300">{server.description}</div>
                      <div className="text-slate-500">Overwatch Code</div>
                    </div>
                    <div className="grid grid-cols-3 p-2">
                      <div className="text-slate-400">Process State</div>
                      <div className="text-slate-300">{isGameRunning ? "Running" : "Idle"}</div>
                      <div className={isGameRunning ? "text-violet-400" : "text-slate-500"}>
                        {isGameRunning ? "Process Bound" : "Waiting for game"}
                      </div>
                    </div>
                  </div>
                </div>

              </div>

              <div className="mt-auto border-t border-slate-800 p-4 flex justify-end bg-slate-950/20">
                <button
                  onClick={() => setSelectedServerForModal(null)}
                  className="px-4 py-2 font-mono text-xs font-bold tracking-wider rounded border border-violet-500/20 bg-violet-500/5 text-violet-400 hover:bg-violet-500/10 hover:border-violet-500/40 transition-all cursor-pointer"
                >
                  CLOSE DETAILS
                </button>
              </div>
              
            </div>
          </div>
        );
      })()}
    </div>
  );
}
