import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  BookOpen,
  CheckCircle2,
  Cpu,
  FileText,
  Folder,
  Layers,
  Play,
  RefreshCw,
  Terminal,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import io from "socket.io-client";
import axios from "axios";

const baseUrl = import.meta.env.VITE_API_URL || "http://localhost:3001";
const socketUrl = import.meta.env.VITE_SOCKET_URL || baseUrl;
const apiToken = import.meta.env.VITE_CONDUCTOR_TOKEN || "";
const api = axios.create({
  baseURL: baseUrl,
  headers: apiToken ? { "x-conductor-token": apiToken } : {},
});
const socket = io(socketUrl, {
  auth: apiToken ? { token: apiToken } : {},
});
const ROLES = ["planner", "worker", "critic", "synthesizer"];

export default function App() {
  const [models, setModels] = useState([]);
  const [manifest, setManifest] = useState(null);
  const [task, setTask] = useState("");
  const [logs, setLogs] = useState([]);
  const [isRunning, setIsRunning] = useState(false);
  const [activeTab, setActiveTab] = useState("orchestrate");
  const [allowedPaths, setAllowedPaths] = useState([]);
  const [newPath, setNewPath] = useState("");
  const [files, setFiles] = useState([]);
  const [fileTotal, setFileTotal] = useState(0);
  const [filePattern, setFilePattern] = useState("**/*");
  const [context, setContext] = useState("");
  const [selectedFile, setSelectedFile] = useState(null);
  const [fileContent, setFileContent] = useState("");
  const [ollamaStatus, setOllamaStatus] = useState("unknown");
  const [autoScroll, setAutoScroll] = useState(true);
  const [runOutput, setRunOutput] = useState("");
  const [runOutputPath, setRunOutputPath] = useState(null);
  const logEndRef = useRef(null);
  const logContainerRef = useRef(null);

  useEffect(() => {
    refreshAll();

    socket.on("log", (log) => {
      const timestamp = log.at || new Date().toISOString();
      setLogs((prev) => [...prev.slice(-120), { ...log, at: timestamp }]);
    });

    socket.on("run:status", (status) => {
      if (status.state === "started") setIsRunning(true);
      if (status.state === "finished" || status.state === "error" || status.state === "stopped") {
        setIsRunning(false);
      }
    });

    socket.on("run:output", (payload) => {
      setRunOutput(payload.content || "");
      setRunOutputPath(payload.path || null);
    });

    return () => {
      socket.off("log");
      socket.off("run:status");
      socket.off("run:output");
    };
  }, []);

  useEffect(() => {
    if (!autoScroll) return;
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs, autoScroll]);

  const refreshAll = async () => {
    await Promise.all([
      fetchModels(),
      fetchManifest(),
      fetchWorkspacePaths(),
      fetchWorkspaceContext(),
      fetchWorkspaceFiles(),
    ]);
  };

  const fetchModels = async () => {
    try {
      const res = await api.get("/api/models");
      setModels(res.data);
      setOllamaStatus("online");
    } catch (err) {
      setOllamaStatus("offline");
      console.error("Failed to fetch models", err);
    }
  };

  const fetchManifest = async () => {
    try {
      const res = await api.get("/api/manifest");
      setManifest(res.data);
    } catch (err) {
      console.error("Failed to fetch manifest", err);
    }
  };

  const fetchWorkspacePaths = async () => {
    try {
      const res = await api.get("/api/workspace/paths");
      setAllowedPaths(res.data.paths || []);
    } catch (err) {
      console.error("Failed to fetch workspace paths", err);
    }
  };

  const fetchWorkspaceContext = async () => {
    try {
      const res = await api.get("/api/workspace/context");
      setContext(res.data.context || "");
    } catch (err) {
      console.error("Failed to fetch workspace context", err);
    }
  };

  const fetchWorkspaceFiles = async () => {
    try {
      const res = await api.get("/api/workspace/files", {
        params: { pattern: filePattern, limit: 400 },
      });
      setFiles(res.data.files || []);
      setFileTotal(res.data.total || 0);
    } catch (err) {
      console.error("Failed to fetch workspace files", err);
    }
  };

  const fetchFileContent = async (file) => {
    if (!file) return;
    setSelectedFile(file);
    try {
      const res = await api.get("/api/workspace/read", {
        params: { path: file.abs },
      });
      setFileContent(res.data.content || "");
    } catch (err) {
      setFileContent("Unable to read file. Check sandbox permissions.");
    }
  };

  const addWorkspacePath = async () => {
    if (!newPath.trim()) return;
    try {
      const res = await api.post("/api/workspace/paths", { path: newPath.trim() });
      setAllowedPaths(res.data.paths || []);
      setNewPath("");
      fetchWorkspaceFiles();
      fetchWorkspaceContext();
    } catch (err) {
      console.error("Failed to add workspace path", err);
    }
  };

  const deleteWorkspacePath = async (pathToDelete) => {
    try {
      const res = await api.delete("/api/workspace/paths", { data: { path: pathToDelete } });
      setAllowedPaths(res.data.paths || []);
      fetchWorkspaceFiles();
      fetchWorkspaceContext();
    } catch (err) {
      console.error("Failed to delete workspace path", err);
    }
  };

  const updateWiring = async (role, modelName) => {
    if (!manifest) return;
    const newManifest = {
      ...manifest,
      model_wiring: {
        ...manifest.model_wiring,
        [role]: modelName,
      },
    };
    try {
      await api.post("/api/manifest", newManifest);
      setManifest(newManifest);
    } catch (err) {
      console.error("Failed to update wiring", err);
    }
  };

  const runTask = async () => {
    if (!task.trim()) return;
    setIsRunning(true);
    setLogs([]);
    setAutoScroll(true);
    setRunOutput("");
    setRunOutputPath(null);
    try {
      await api.post("/api/run", { task });
    } catch (err) {
      console.error("Run failed", err);
      setIsRunning(false);
    }
  };

  const stopTask = async () => {
    try {
      await api.post("/api/stop");
      setIsRunning(false);
    } catch (err) {
      console.error("Stop failed", err);
    }
  };

  const loadLatestOutput = async () => {
    try {
      const res = await api.get("/api/output/latest");
      setRunOutput(res.data.content || "");
      setRunOutputPath(res.data.path || null);
    } catch (err) {
      console.error("Failed to load output", err);
    }
  };

  const statusPill = useMemo(() => {
    if (ollamaStatus === "online") return "Online";
    if (ollamaStatus === "offline") return "Offline";
    return "Checking";
  }, [ollamaStatus]);

  return (
    <div className="min-h-screen">
      <div className="mx-auto flex min-h-screen max-w-7xl flex-col gap-6 px-6 py-6 lg:flex-row">
        <aside className="surface flex w-full flex-col gap-6 p-6 lg:w-72">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-900 text-white">
              <Cpu size={24} />
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Conductor AI</p>
              <h1 className="text-xl font-semibold">Studio</h1>
            </div>
          </div>

          <nav className="space-y-2">
            <NavItem
              active={activeTab === "orchestrate"}
              onClick={() => setActiveTab("orchestrate")}
              icon={<Activity size={18} />}
              label="Orchestrate"
            />
            <NavItem
              active={activeTab === "wiring"}
              onClick={() => setActiveTab("wiring")}
              icon={<Layers size={18} />}
              label="Model Wiring"
            />
            <NavItem
              active={activeTab === "workspace"}
              onClick={() => setActiveTab("workspace")}
              icon={<Folder size={18} />}
              label="Workspace"
            />
          </nav>

          <div className="rounded-2xl border border-slate-200 bg-white/80 p-4">
            <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Inference</p>
            <div className="mt-2 flex items-center gap-2 text-sm">
              <span
                className={`h-2 w-2 rounded-full ${
                  ollamaStatus === "online" ? "bg-emerald-500" : "bg-amber-400"
                }`}
              ></span>
              <span className="font-medium">Ollama {statusPill}</span>
            </div>
          </div>

          <button
            onClick={refreshAll}
            className="flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:-translate-y-0.5"
          >
            <RefreshCw size={16} /> Refresh Data
          </button>
        </aside>

        <main className="flex-1">
          <AnimatePresence mode="wait">
            {activeTab === "orchestrate" && (
              <motion.section
                key="orchestrate"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -16 }}
                className="space-y-6"
              >
                <header className="surface flex flex-col gap-4 p-6">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <span className="chip">Mission control</span>
                      <h2 className="mt-3 text-3xl font-semibold">
                        Orchestrate a full multi-agent run.
                      </h2>
                      <p className="mt-2 text-sm text-slate-600">
                        Send a clear task to the Conductor and watch every step stream back in real time.
                      </p>
                    </div>
                    <div className="surface-dark px-4 py-2 text-sm">
                      <div className="flex items-center gap-2">
                        <Play size={16} />
                        <span>{isRunning ? "Executing" : "Idle"}</span>
                      </div>
                    </div>
                  </div>
                  <div className="grid gap-4 lg:grid-cols-[1.4fr_0.6fr]">
                    <textarea
                      value={task}
                      onChange={(e) => setTask(e.target.value)}
                      placeholder="Describe the coding task in detail. Example: 'Audit the auth flow, then refactor to use JWT with refresh tokens.'"
                      className="min-h-[140px] rounded-2xl border border-slate-200 bg-white/90 p-4 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-orange-200"
                    />
                    <div className="space-y-3">
                      <div className="rounded-2xl border border-slate-200 bg-white/80 p-4">
                        <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Ready checks</p>
                        <div className="mt-3 space-y-2 text-sm text-slate-600">
                          <div className="flex items-center gap-2">
                            <CheckCircle2 size={16} className="text-emerald-500" />
                            <span>Sandbox paths loaded</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <CheckCircle2 size={16} className="text-emerald-500" />
                            <span>Approval gate ready</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={runTask}
                          disabled={isRunning || !task.trim()}
                          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {isRunning ? "Orchestrating..." : "Begin Execution"}
                        </button>
                        {isRunning && (
                          <button
                            onClick={stopTask}
                            className="flex items-center justify-center gap-2 rounded-2xl bg-red-500 px-4 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-red-600 shadow-[0_0_15px_rgba(239,68,68,0.5)]"
                            title="Stop Execution"
                          >
                            <span className="font-bold">STOP</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </header>

                <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
                  <div className="surface p-6">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-sm font-semibold">
                        <Terminal size={16} /> Live Feed
                      </div>
                      <span className="text-xs text-slate-400">Streaming console output</span>
                    </div>
                    <div
                      ref={logContainerRef}
                      onScroll={(event) => {
                        const el = event.currentTarget;
                        const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
                        setAutoScroll(atBottom);
                      }}
                      className="soft-scroll mono mt-4 h-[360px] overflow-y-auto rounded-2xl border border-slate-200 bg-slate-950 p-4 text-xs text-slate-200"
                    >
                      {logs.length === 0 ? (
                        <div className="text-slate-500">Waiting for log events...</div>
                      ) : (
                        logs.map((log, i) => (
                          <div key={`${log.type}-${i}`} className="mb-1">
                            <span className="text-slate-500">
                              [{new Date(log.at).toLocaleTimeString()}]
                            </span>{" "}
                            <span className={log.type === "error" ? "text-red-300" : "text-slate-200"}>
                              {log.message}
                            </span>
                          </div>
                        ))
                      )}
                      <div ref={logEndRef} />
                    </div>
                  </div>

                  <div className="surface p-6">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      <BookOpen size={16} /> Session Notes
                    </div>
                    <p className="mt-3 text-sm text-slate-600">
                      The Conductor will stream planner/worker/critic logs here as it progresses.
                      Use the Workspace tab to inspect allowed paths and file snapshots.
                    </p>
                    <div className="mt-6 rounded-2xl border border-slate-200 bg-white/80 p-4 text-sm text-slate-600">
                      <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Quick tips</p>
                      <ul className="mt-3 space-y-2">
                        <li>Keep tasks focused and executable.</li>
                        <li>Review approval prompts in the terminal.</li>
                        <li>Use model wiring to steer agent roles.</li>
                      </ul>
                    </div>
                    <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-950 p-4 text-xs text-slate-200">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold">Latest Output</span>
                        <button
                          onClick={loadLatestOutput}
                          className="rounded-full border border-slate-700 px-3 py-1 text-[11px] text-slate-200"
                        >
                          Load
                        </button>
                      </div>
                      {runOutputPath && (
                        <div className="mt-2 text-[11px] text-slate-500">{runOutputPath}</div>
                      )}
                      <pre className="soft-scroll mono mt-3 max-h-[220px] overflow-y-auto whitespace-pre-wrap">
                        {runOutput || "No output received yet."}
                      </pre>
                    </div>
                  </div>
                </section>
              </motion.section>
            )}

            {activeTab === "wiring" && (
              <motion.section
                key="wiring"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -16 }}
                className="space-y-6"
              >
                <header className="surface p-6">
                  <span className="chip">Model wiring</span>
                  <h2 className="mt-3 text-3xl font-semibold">Map models to each agent role.</h2>
                  <p className="mt-2 text-sm text-slate-600">
                    Select the Ollama models you want for planner, worker, critic, and synthesizer.
                  </p>
                </header>
                <div className="grid gap-6 md:grid-cols-2">
                  {ROLES.map((role) => (
                    <div key={role} className="surface p-6">
                      <div className="flex items-center justify-between">
                        <h3 className="flex items-center gap-2 text-lg font-semibold">
                          <Cpu size={18} /> {role}
                        </h3>
                        <span className="text-xs text-slate-400">Role</span>
                      </div>
                        <div className="mt-4 flex flex-col gap-2">
                          {(Array.isArray(manifest?.model_wiring?.[role]) 
                              ? manifest?.model_wiring?.[role] 
                              : manifest?.model_wiring?.[role] ? [manifest?.model_wiring?.[role]] : []
                           ).map((selectedModel, idx) => (
                            <div key={`${selectedModel}-${idx}`} className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                              <span className="font-medium text-slate-700">{selectedModel}</span>
                              <button 
                                onClick={() => {
                                  let current = Array.isArray(manifest?.model_wiring?.[role]) ? [...manifest.model_wiring[role]] : [manifest?.model_wiring?.[role]].filter(Boolean);
                                  current.splice(idx, 1);
                                  updateWiring(role, current);
                                }}
                                className="text-red-400 hover:text-red-600 font-bold"
                              >
                                &times;
                              </button>
                            </div>
                          ))}
                          
                          <select
                            value=""
                            onChange={(e) => {
                              if (!e.target.value) return;
                              let current = Array.isArray(manifest?.model_wiring?.[role]) 
                                  ? [...manifest.model_wiring[role]] 
                                  : manifest?.model_wiring?.[role] ? [manifest?.model_wiring?.[role]] : [];
                              if (!current.includes(e.target.value)) {
                                current.push(e.target.value);
                                updateWiring(role, current);
                              }
                            }}
                            className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm"
                          >
                            <option value="">+ Add a model...</option>
                            {models.map((model) => (
                              <option key={model.name} value={model.name}>
                                {model.name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <p className="mt-3 text-xs text-slate-500">
                          {Array.isArray(manifest?.model_wiring?.[role]) && manifest.model_wiring[role].length > 1 
                            ? `These ${manifest.model_wiring[role].length} models will work together simultaneously for this role.`
                            : `Auto-wires to the ${role} node inside the Conductor graph.`}
                        </p>
                    </div>
                  ))}
                </div>
              </motion.section>
            )}

            {activeTab === "workspace" && (
              <motion.section
                key="workspace"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -16 }}
                className="space-y-6"
              >
                <header className="surface p-6">
                  <span className="chip">Workspace</span>
                  <h2 className="mt-3 text-3xl font-semibold">Inspect sandboxed files and context.</h2>
                  <p className="mt-2 text-sm text-slate-600">
                    This reflects the Conductor sandbox. Add absolute paths and refresh to scan files.
                  </p>
                </header>

                <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
                  <div className="space-y-6">
                    <div className="surface p-6">
                      <div className="flex items-center justify-between">
                        <h3 className="text-lg font-semibold">Allowed paths</h3>
                        <button
                          onClick={fetchWorkspacePaths}
                          className="text-xs text-slate-500 hover:text-slate-700"
                        >
                          Refresh
                        </button>
                      </div>
                      <div className="mt-4 space-y-2 text-sm text-slate-600">
                        {allowedPaths.length === 0 ? (
                          <div>No paths declared yet.</div>
                        ) : (
                          allowedPaths.map((p) => (
                            <div key={p} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white/80 px-3 py-2">
                              <span>{p}</span>
                              <button 
                                onClick={() => deleteWorkspacePath(p)}
                                className="text-red-400 hover:text-red-600 font-bold px-2"
                                title="Remove path"
                              >
                                &times;
                              </button>
                            </div>
                          ))
                        )}
                      </div>
                      <div className="mt-4 flex flex-col gap-3">
                        <input
                          value={newPath}
                          onChange={(e) => setNewPath(e.target.value)}
                          placeholder="C:\\path\\to\\workspace"
                          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                        />
                        <button
                          onClick={addWorkspacePath}
                          className="rounded-xl border border-slate-200 bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
                        >
                          Add path
                        </button>
                      </div>
                    </div>

                    <div className="surface p-6">
                      <div className="flex items-center gap-2 text-sm font-semibold">
                        <FileText size={16} /> Project context
                      </div>
                      <pre className="soft-scroll mono mt-4 max-h-[260px] overflow-y-auto whitespace-pre-wrap rounded-2xl border border-slate-200 bg-white/80 p-4 text-xs text-slate-600">
                        {context || "No context available yet."}
                      </pre>
                    </div>
                  </div>

                  <div className="surface p-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-lg font-semibold">File browser</h3>
                        <p className="text-xs text-slate-500">
                          Showing {files.length} of {fileTotal} files
                        </p>
                      </div>
                      <button
                        onClick={fetchWorkspaceFiles}
                        className="text-xs text-slate-500 hover:text-slate-700"
                      >
                        Refresh
                      </button>
                    </div>
                    <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1.1fr]">
                      <div className="rounded-2xl border border-slate-200 bg-white/80 p-3">
                        <label className="text-xs uppercase tracking-[0.3em] text-slate-400">
                          Pattern
                        </label>
                        <div className="mt-2 flex gap-2">
                          <input
                            value={filePattern}
                            onChange={(e) => setFilePattern(e.target.value)}
                            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                          />
                          <button
                            onClick={fetchWorkspaceFiles}
                            className="rounded-xl border border-slate-200 bg-slate-900 px-3 py-2 text-sm font-semibold text-white"
                          >
                            Apply
                          </button>
                        </div>
                      </div>
                      <div className="soft-scroll max-h-[380px] overflow-y-auto rounded-2xl border border-slate-200 bg-white/70 p-3 text-sm text-slate-600">
                        {files.length === 0 ? (
                          <div>No files found in sandbox.</div>
                        ) : (
                          files.map((file) => (
                            <button
                              key={file.abs}
                              onClick={() => fetchFileContent(file)}
                              className={`mb-2 flex w-full items-start justify-between gap-2 rounded-xl px-3 py-2 text-left transition ${
                                selectedFile?.abs === file.abs
                                  ? "bg-orange-100 text-slate-900"
                                  : "hover:bg-slate-100"
                              }`}
                            >
                              <span className="line-clamp-2">{file.rel}</span>
                              <span className="text-xs text-slate-400">{file.root.split("\\").pop()}</span>
                            </button>
                          ))
                        )}
                      </div>
                      <div className="soft-scroll mono max-h-[380px] overflow-y-auto rounded-2xl border border-slate-200 bg-slate-950 p-4 text-xs text-slate-200">
                        {selectedFile ? (
                          <div>
                            <div className="mb-3 text-xs text-slate-400">{selectedFile.abs}</div>
                            <pre className="whitespace-pre-wrap">{fileContent}</pre>
                          </div>
                        ) : (
                          <div className="text-slate-400">Select a file to preview its contents.</div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </motion.section>
            )}
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}

function NavItem({ active, icon, label, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-sm font-medium transition ${
        active
          ? "bg-slate-900 text-white"
          : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
