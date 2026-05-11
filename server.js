import express from "express";
import cors from "cors";
import { Server } from "socket.io";
import { createServer } from "http";
import fs from "fs-extra";
import path from "path";
import axios from "axios";
import { Conductor } from "./Conductor.js";
import { MemoryManager } from "./MemoryManager.js";
import { SandboxManager } from "./SandboxManager.js";
import { ApprovalGate } from "./ApprovalGate.js";
import { FileSystemManager } from "./FileSystemManager.js";

const app = express();
app.set("trust proxy", false);

const allowedOrigins = ["http://localhost:3000", "http://127.0.0.1:3000"];
const localIps = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const apiToken = process.env.CONDUCTOR_TOKEN || "";

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("CORS blocked"));
  },
}));
app.use(express.json({ limit: "200kb" }));

app.use((req, res, next) => {
  const remoteAddress = req.socket?.remoteAddress;
  if (localIps.has(remoteAddress) || req.hostname === "localhost") return next();
  return res.status(403).json({ error: "Localhost only" });
});

app.use((req, res, next) => {
  if (!apiToken) return next();
  const token = req.get("x-conductor-token");
  if (token && token === apiToken) return next();
  return res.status(401).json({ error: "Unauthorized" });
});

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: allowedOrigins }
});

io.use((socket, next) => {
  if (localIps.has(socket.handshake.address)) return next();
  return next(new Error("Localhost only"));
});

io.use((socket, next) => {
  if (!apiToken) return next();
  const token = socket.handshake.auth?.token;
  if (token && token === apiToken) return next();
  return next(new Error("Unauthorized"));
});

const MANIFEST_PATH = path.resolve("intelligence", "manifest.json");

// Shared instances
const memory = new MemoryManager();
const sandbox = new SandboxManager();
const gate = new ApprovalGate();
const fsManager = new FileSystemManager(sandbox, gate);

const appReady = (async () => {
  await memory.init();
  await sandbox.load();
  await gate.load();
})();

// Middleware to capture logs and send to UI
const originalLog = console.log;
const originalError = console.error;

console.log = (...args) => {
  io.emit("log", { type: "info", message: args.join(" "), at: new Date().toISOString() });
  originalLog(...args);
};
console.error = (...args) => {
  io.emit("log", { type: "error", message: args.join(" "), at: new Date().toISOString() });
  originalError(...args);
};

// API Endpoints

app.get("/api/health", async (req, res) => {
  res.json({ ok: true });
});

app.get("/api/models", async (req, res) => {
  try {
    const response = await axios.get("http://localhost:11434/api/tags");
    res.json(response.data.models || []);
  } catch (error) {
    res.status(500).json({ error: "Ollama not reachable" });
  }
});

app.get("/api/manifest", async (req, res) => {
  await appReady;
  try {
    const manifest = await fs.readJson(MANIFEST_PATH);
    res.json(manifest);
  } catch (error) {
    res.status(500).json({ error: "Failed to load manifest" });
  }
});

app.post("/api/manifest", async (req, res) => {
  await appReady;
  try {
    await fs.writeJson(MANIFEST_PATH, req.body, { spaces: 2 });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Failed to write manifest" });
  }
});

app.get("/api/workspace/paths", async (req, res) => {
  await appReady;
  res.json({ paths: sandbox.getAllowedPaths() });
});

app.post("/api/workspace/paths", async (req, res) => {
  await appReady;
  const newPath = req.body?.path?.trim();
  if (!newPath) return res.status(400).json({ error: "Path required" });
  try {
    await sandbox.addAllowedPath(newPath);
    res.json({ paths: sandbox.getAllowedPaths() });
  } catch (error) {
    res.status(500).json({ error: "Failed to add workspace path" });
  }
});

app.delete("/api/workspace/paths", async (req, res) => {
  await appReady;
  const targetPath = req.body?.path?.trim();
  if (!targetPath) return res.status(400).json({ error: "Path required" });
  try {
    await sandbox.removeAllowedPath(targetPath);
    res.json({ paths: sandbox.getAllowedPaths() });
  } catch (error) {
    res.status(500).json({ error: "Failed to remove workspace path" });
  }
});

app.get("/api/workspace/context", async (req, res) => {
  await appReady;
  try {
    const context = await fsManager.getProjectContext();
    res.json({ context });
  } catch (error) {
    res.status(500).json({ error: "Failed to build project context" });
  }
});

app.get("/api/workspace/files", async (req, res) => {
  await appReady;
  const pattern = req.query.pattern || "**/*";
  const limit = Number.parseInt(req.query.limit, 10) || 400;
  try {
    const files = await fsManager.listFiles(pattern);
    res.json({ files: files.slice(0, limit), total: files.length });
  } catch (error) {
    res.status(500).json({ error: "Failed to list files" });
  }
});

app.get("/api/workspace/read", async (req, res) => {
  await appReady;
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: "Path required" });
  try {
    const content = await fsManager.readFile(filePath);
    res.json({ content });
  } catch (error) {
    if (error.message.includes("DENIED")) {
      return res.status(403).json({ error: error.message });
    }
    res.status(500).json({ error: "Failed to read file" });
  }
});

app.get("/api/output/latest", async (req, res) => {
  await appReady;
  try {
    const outputDir = path.resolve("intelligence", "outputs");
    const files = (await fs.readdir(outputDir))
      .filter((f) => f.startsWith("output_") && f.endsWith(".js"))
      .sort();
    const latest = files[files.length - 1];
    if (!latest) return res.json({ content: "", path: null });
    const content = await fs.readFile(path.join(outputDir, latest), "utf-8");
    res.json({ content, path: path.join(outputDir, latest) });
  } catch (error) {
    res.status(500).json({ error: "Failed to load output" });
  }
});

let activeConductor = null;
let isStopping = false;

app.post("/api/run", async (req, res) => {
  await appReady;
  const { task } = req.body;
  if (!task) return res.status(400).json({ error: "Task required" });

  if (activeConductor) {
    return res.status(400).json({ error: "A task is already running. Stop it first." });
  }

  if (isStopping) {
    return res.status(409).json({ error: "A task is stopping. Please wait." });
  }

  const conductor = new Conductor(memory, sandbox, gate);
  activeConductor = conductor;

  io.emit("run:status", { state: "started", task });

  // We run this in a non-blocking way and stream via Socket.io
  conductor.run(task).then(async (result) => {
    if (conductor.isAborted || result?.aborted) {
      io.emit("run:status", { state: "stopped", task });
      return;
    }

    if (result?.outputPath) {
      try {
        const content = await fs.readFile(result.outputPath, "utf-8");
        io.emit("run:output", { task, path: result.outputPath, content });
        io.emit("log", { type: "info", message: "Output ready in UI.", at: new Date().toISOString() });
      } catch (error) {
        console.error("Failed to read output:", error);
      }
    }

    io.emit("run:status", { state: "finished", task });
  }).catch(err => {
    if (err.message === "ABORTED" || conductor.isAborted) {
      io.emit("run:status", { state: "stopped", task });
    } else {
      console.error("Run failed:", err);
      io.emit("run:status", { state: "error", task, message: err.message });
    }
  }).finally(() => {
    activeConductor = null;
    isStopping = false;
  });

  res.json({ status: "started" });
});

app.post("/api/stop", async (req, res) => {
  if (activeConductor) {
    await activeConductor.abort();
    isStopping = true;
    io.emit("run:status", { state: "stopped" });
    io.emit("log", { type: "info", message: "Run stopped by user.", at: new Date().toISOString() });
    return res.json({ status: "stopping" });
  }
  res.json({ status: "idle" });
});

const PORT = 3001;
httpServer.listen(PORT, "127.0.0.1", () => {
  console.log(`Conductor API running on http://localhost:${PORT}`);
});
