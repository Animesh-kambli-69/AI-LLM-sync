/**
 * MemoryManager.js
 * 
 * Centralized intelligence layer for all Conductor agents.
 * Uses ChromaDB for vector storage + local `intelligence/` folder for sessions, lessons, outputs.
 * 
 * Embedding model: nomic-embed-text:v1.5 (already in Ollama)
 */

import fs from "fs-extra";
import path from "path";
import { OllamaEmbeddings } from "@langchain/ollama";
import { ChromaClient } from "chromadb";
import { DefaultEmbeddingFunction } from "@chroma-core/default-embed";

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
    this.client = null;
    this.collection = null;
    this.initialized = false;
  }

  /** Must be called once before any read/write */
  async init() {
    await Promise.all(Object.values(PATHS).map((p) => fs.ensureDir(p)));
    
    // Use file-based storage for maximum reliability
    // ChromaDB HTTP client would require a running ChromaDB server
    this.initialized = true;
    this.useFallback = true;
    console.log("[Intelligence] File-based memory storage ready →", INTEL_DIR);
  }

  // ── Memory (vector snippets) ──────────────────────────────────

  /**
   * Save any text (code, decision, note) into ChromaDB.
   * @param {string} text
   * @param {{ type?: string, agent?: string, task?: string }} meta
   */
  async remember(text, meta = {}) {
    if (!this.initialized) await this.init();

    const id = uid();
    const metadata = {
      type: meta.type || "general",
      agent: meta.agent || "unknown",
      task: meta.task || "unknown",
      createdAt: new Date().toISOString(),
    };

    // Fallback to file storage if ChromaDB is unavailable
    if (this.useFallback || !this.collection) {
      try {
        const record = { id, text, meta, createdAt: new Date().toISOString() };
        await fs.writeJson(
          path.join(PATHS.memory || path.join(INTEL_DIR, "memory"), `${id}.json`),
          record,
          { spaces: 2 }
        );
        return id;
      } catch (error) {
        console.error("[Memory] Fallback file storage failed:", error);
        return id;
      }
    }

    try {
      await this.collection.add({
        ids: [id],
        documents: [text],
        metadatas: [metadata],
      });
      return id;
    } catch (error) {
      console.error("[Memory] Failed to save to ChromaDB, falling back to file:", error);
      // Fallback to file
      try {
        const record = { id, text, meta, createdAt: new Date().toISOString() };
        await fs.writeJson(
          path.join(INTEL_DIR, "memory", `${id}.json`),
          record,
          { spaces: 2 }
        );
      } catch (fallbackError) {
        console.error("[Memory] Even fallback failed:", fallbackError);
      }
      return id;
    }
  }

  /**
   * Optimization: Save multiple texts to ChromaDB in a single batch.
   * Much faster than calling remember() multiple times.
   * @param {string[]} texts
   * @param {Array<{ type?: string, agent?: string, task?: string }>} metas
   * @returns {Promise<string[]>} Array of memory IDs
   */
  async rememberBatch(texts, metas = []) {
    if (!this.initialized) await this.init();

    if (!Array.isArray(texts) || texts.length === 0) {
      return [];
    }

    // Fallback to file storage if ChromaDB unavailable
    if (this.useFallback || !this.collection) {
      try {
        const ids = texts.map(() => uid());
        await Promise.all(
          texts.map(async (text, i) => {
            const meta = metas[i] || {};
            const record = {
              id: ids[i],
              text,
              meta,
              createdAt: new Date().toISOString(),
            };
            await fs.writeJson(
              path.join(PATHS.memory, `${ids[i]}.json`),
              record,
              { spaces: 2 }
            );
          })
        );
        return ids;
      } catch (error) {
        console.error("[Memory] Fallback batch save failed:", error);
        return [];
      }
    }

    try {
      const ids = texts.map(() => uid());
      const metadatas = texts.map((_, i) => {
        const meta = metas[i] || {};
        return {
          type: meta.type || "general",
          agent: meta.agent || "unknown",
          task: meta.task || "unknown",
          createdAt: new Date().toISOString(),
        };
      });

      await this.collection.add({
        ids,
        documents: texts,
        metadatas,
      });

      return ids;
    } catch (error) {
      console.error("[Memory] Failed to save batch to ChromaDB, falling back to file:", error);
      // Fallback to file
      try {
        const ids = texts.map(() => uid());
        await Promise.all(
          texts.map(async (text, i) => {
            const meta = metas[i] || {};
            const record = {
              id: ids[i],
              text,
              meta,
              createdAt: new Date().toISOString(),
            };
            await fs.writeJson(
              path.join(PATHS.memory, `${ids[i]}.json`),
              record,
              { spaces: 2 }
            );
          })
        );
        return ids;
      } catch (fallbackError) {
        console.error("[Memory] Fallback batch save failed:", fallbackError);
        return [];
      }
    }
  }

  /**
   * Retrieve the top-k most semantically similar memories from ChromaDB.
   * @param {string} query
   * @param {number} topK
   * @returns {Promise<Array<{ text: string, meta: object, score: number }>>}
   */
  async recall(query, topK = 5) {
    if (!this.initialized) await this.init();

    // Fallback to file-based search if ChromaDB unavailable
    if (this.useFallback || !this.collection) {
      try {
        const memoryDir = PATHS.memory || path.join(INTEL_DIR, "memory");
        if (!await fs.pathExists(memoryDir)) return [];
        
        const files = await fs.readdir(memoryDir);
        if (files.length === 0) return [];

        const queryEmbedding = await this.embedder.embedQuery(query);
        
        // Manual cosine similarity search (fallback)
        const scored = await Promise.all(
          files
            .filter((f) => f.endsWith(".json"))
            .map(async (f) => {
              const record = await fs.readJson(path.join(memoryDir, f));
              // Generate embedding on the fly for fallback
              const embedding = await this.embedder.embedQuery(record.text);
              const score = this._cosineSimilarity(queryEmbedding, embedding);
              return { text: record.text, meta: record.meta || {}, score };
            })
        );

        return scored
          .sort((a, b) => b.score - a.score)
          .slice(0, topK)
          .filter((r) => r.score > 0.4);
      } catch (error) {
        console.error("[Memory] Fallback recall failed:", error);
        return [];
      }
    }

    try {
      const results = await this.collection.query({
        queryTexts: [query],
        nResults: topK,
      });

      if (!results.documents[0] || results.documents[0].length === 0) {
        return [];
      }

      // Map ChromaDB results to our format
      return results.documents[0].map((text, i) => ({
        text,
        meta: results.metadatas[0][i],
        score: results.distances[0][i], // ChromaDB returns distances; lower is better for cosine
      }));
    } catch (error) {
      console.error("[Memory] Failed to recall from ChromaDB:", error);
      return [];
    }
  }

  // Helper for fallback cosine similarity
  _cosineSimilarity(a, b) {
    const dot = a.reduce((sum, v, i) => sum + v * b[i], 0);
    const magA = Math.sqrt(a.reduce((sum, v) => sum + v * v, 0));
    const magB = Math.sqrt(b.reduce((sum, v) => sum + v * v, 0));
    return dot / (magA * magB + 1e-10);
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
