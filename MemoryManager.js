/**
 * MemoryManager.js
 * 
 * Centralized intelligence layer for all Conductor agents.
 * Reads/writes to the local `intelligence/` folder so every agent
 * shares the exact same long-term memory, sessions, and lessons learned.
 * 
 * Embedding model: nomic-embed-text:v1.5 (already in Ollama)
 */

import fs from "fs-extra";
import path from "path";
import { OllamaEmbeddings } from "@langchain/ollama";

const INTEL_DIR = path.resolve("intelligence");
const PATHS = {
  memory:   path.join(INTEL_DIR, "memory"),
  sessions: path.join(INTEL_DIR, "sessions"),
  lessons:  path.join(INTEL_DIR, "lessons"),
  outputs:  path.join(INTEL_DIR, "outputs"),
  context:  path.join(INTEL_DIR, "context"),
};

// ─────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────
function cosineSimilarity(a, b) {
  const dot = a.reduce((sum, v, i) => sum + v * b[i], 0);
  const magA = Math.sqrt(a.reduce((sum, v) => sum + v * v, 0));
  const magB = Math.sqrt(b.reduce((sum, v) => sum + v * v, 0));
  return dot / (magA * magB + 1e-10);
}

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// ─────────────────────────────────────────────
//  MemoryManager
// ─────────────────────────────────────────────
export class MemoryManager {
  constructor() {
    this.embedder = new OllamaEmbeddings({
      baseUrl: "http://localhost:11434",
      model: "nomic-embed-text:v1.5",
    });
    this.initialized = false;
  }

  /** Must be called once before any read/write */
  async init() {
    await Promise.all(Object.values(PATHS).map((p) => fs.ensureDir(p)));
    this.initialized = true;
    console.log("[Intelligence] Shared memory layer ready →", INTEL_DIR);
  }

  // ── Memory (vector snippets) ──────────────────────────────────

  /**
   * Save any text (code, decision, note) into shared memory.
   * @param {string} text
   * @param {{ type?: string, agent?: string, task?: string }} meta
   */
  async remember(text, meta = {}) {
    if (!this.initialized) await this.init();

    const embedding = await this.embedder.embedQuery(text);
    const id = uid();
    const record = { id, text, meta, embedding, createdAt: new Date().toISOString() };

    await fs.writeJson(path.join(PATHS.memory, `${id}.json`), record, { spaces: 2 });
    return id;
  }

  /**
   * Retrieve the top-k most semantically similar memories.
   * @param {string} query
   * @param {number} topK
   * @returns {Promise<Array<{ text: string, meta: object, score: number }>>}
   */
  async recall(query, topK = 5) {
    if (!this.initialized) await this.init();

    const files = await fs.readdir(PATHS.memory);
    if (files.length === 0) return [];

    const queryEmbedding = await this.embedder.embedQuery(query);

    const scored = await Promise.all(
      files
        .filter((f) => f.endsWith(".json"))
        .map(async (f) => {
          const record = await fs.readJson(path.join(PATHS.memory, f));
          const score = cosineSimilarity(queryEmbedding, record.embedding);
          return { text: record.text, meta: record.meta, score };
        })
    );

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .filter((r) => r.score > 0.4); // relevance threshold
  }

  // ── Lessons Learned ───────────────────────────────────────────

  /**
   * Record a bug fix or best-practice that the system discovered.
   * @param {string} lesson  Human-readable lesson text
   * @param {string} agent   Which agent learned it
   */
  async learnLesson(lesson, agent = "unknown") {
    const id = uid();
    const record = { id, lesson, agent, createdAt: new Date().toISOString() };
    await fs.writeJson(path.join(PATHS.lessons, `${id}.json`), record, { spaces: 2 });

    // Also embed into shared memory so it can be recalled by any agent
    await this.remember(`LESSON: ${lesson}`, { type: "lesson", agent });
  }

  /** Get all stored lessons */
  async getLessons() {
    const files = await fs.readdir(PATHS.lessons);
    return Promise.all(
      files.filter((f) => f.endsWith(".json")).map((f) =>
        fs.readJson(path.join(PATHS.lessons, f))
      )
    );
  }

  // ── Sessions ──────────────────────────────────────────────────

  /**
   * Start a new session log. Returns a session id.
   * @param {string} task
   */
  async startSession(task) {
    const id = uid();
    await fs.writeJson(path.join(PATHS.sessions, `${id}.json`), {
      id,
      task,
      events: [],
      startedAt: new Date().toISOString(),
      status: "running",
    }, { spaces: 2 });
    this.currentSessionId = id;
    return id;
  }

  /**
   * Append an event to the active session.
   * @param {string} event
   */
  async logEvent(event) {
    if (!this.currentSessionId) return;
    const file = path.join(PATHS.sessions, `${this.currentSessionId}.json`);
    const session = await fs.readJson(file);
    session.events.push({ event, at: new Date().toISOString() });
    await fs.writeJson(file, session, { spaces: 2 });
  }

  /** Mark the current session as complete */
  async endSession() {
    if (!this.currentSessionId) return;
    const file = path.join(PATHS.sessions, `${this.currentSessionId}.json`);
    const session = await fs.readJson(file);
    session.status = "complete";
    session.endedAt = new Date().toISOString();
    await fs.writeJson(file, session, { spaces: 2 });
    this.currentSessionId = null;
  }

  // ── Outputs ───────────────────────────────────────────────────

  /**
   * Save final code output to intelligence/outputs/
   * @param {string} filename
   * @param {string} content
   */
  async saveOutput(filename, content) {
    const file = path.join(PATHS.outputs, filename);
    await fs.writeFile(file, content, "utf-8");
    return file;
  }

  // ── Project Context ───────────────────────────────────────────

  /**
   * Write a snapshot of the project context (file tree, notes, etc.)
   * All agents load this on startup to understand the codebase.
   * @param {string} content
   */
  async updateContext(content) {
    await fs.writeFile(path.join(PATHS.context, "project.md"), content, "utf-8");
  }

  async getContext() {
    const file = path.join(PATHS.context, "project.md");
    if (await fs.pathExists(file)) return fs.readFile(file, "utf-8");
    return "";
  }
}
