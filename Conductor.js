/**
 * Conductor.js
 *
 * Core orchestration engine. All agents share:
 *   - One MemoryManager  (intelligence/ folder)
 *   - One SandboxManager (path allowlist enforcement)
 *   - One ApprovalGate   (human-in-the-loop decisions)
 *
 * Flow: Planner → [User approves plan] → Worker ↔ Critic (self-heal loop)
 */

import { StateGraph, START, END } from "@langchain/langgraph";
import { InferenceEngine } from "./InferenceEngine.js";
import { FileSystemManager } from "./FileSystemManager.js";
import { MemoryManager } from "./MemoryManager.js";
import chalk from "chalk";
import ora from "ora";

// ─────────────────────────────────────────────
//  State schema
// ─────────────────────────────────────────────
const GraphChannels = {
  task: { value: (_, x) => x ?? "", default: () => "" },
  plan: { value: (_, x) => x ?? [], default: () => [] },
  currentStep: { value: (_, x) => x ?? 0, default: () => 0 },
  code: { value: (_, x) => x ?? "", default: () => "" },
  codeParts: { value: (_, x) => x ?? [], default: () => [] },
  review: { value: (_, x) => x ?? "", default: () => "" },
  errors: { value: (_, x) => x ?? [], default: () => [] },
  retries: { value: (_, x) => x ?? 0, default: () => 0 },
  aborted: { value: (_, x) => x ?? false, default: () => false },
};

const MAX_RETRIES = 3;

export class Conductor {
  /**
   * @param {import('./MemoryManager.js').MemoryManager}   memory
   * @param {import('./SandboxManager.js').SandboxManager} sandbox
   * @param {import('./ApprovalGate.js').ApprovalGate}     gate
   */
  constructor(memory, sandbox, gate) {
    this.memory = memory;
    this.sandbox = sandbox;
    this.gate = gate;
    this.engine = new InferenceEngine();
    this.fs = new FileSystemManager(sandbox, gate);
    this.graph = this._buildGraph();
    this.abortController = new AbortController();
    this.isAborted = false;
    this.lastOutputPath = null;
    this.memoryCache = new Map(); // Optimization: Cache for memory recalls
  }

  async abort() {
    this.isAborted = true;
    this.abortController.abort();
    console.log(chalk.red("\n🛑 Execution stopped by user."));
    await this.memory.logEvent("Execution aborted by user.");
    await this.memory.endSession();
  }

  _detectIntent(task) {
    const trimmed = (task || "").trim();
    const normalized = trimmed.toLowerCase();
    const detectors = [
      { intent: "summarize", prefixes: ["summarize", "summary", "tldr", "tl;dr"] },
      { intent: "explain", prefixes: ["explain", "explanation", "describe", "clarify"] },
    ];

    const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    for (const { intent, prefixes } of detectors) {
      for (const prefix of prefixes) {
        const slash = `/${prefix}`;
        const patterns = [prefix, slash];
        for (const base of patterns) {
          if (normalized === base) {
            return { intent, strippedTask: "" };
          }
          const escaped = escapeRegex(base);
          const withWhitespace = new RegExp(`^${escaped}\\s+`);
          const withColon = new RegExp(`^${escaped}:`);
          const whitespaceMatch = normalized.match(withWhitespace);
          if (whitespaceMatch) {
            return { intent, strippedTask: trimmed.slice(whitespaceMatch[0].length).trim() };
          }
          const colonMatch = normalized.match(withColon);
          if (colonMatch) {
            return { intent, strippedTask: trimmed.slice(colonMatch[0].length).trim() };
          }
        }
      }
    }

    return { intent: "code", strippedTask: trimmed };
  }

  async _buildInlineFileContext(task) {
    let inlineFileContext = "";
    const possiblePaths = task.match(/[a-zA-Z]:\\[^"'\s\n]+|\/[^"'\s\n]+/g) || [];
    for (const p of possiblePaths) {
      if (this.sandbox.isAllowed(p, "read") && !FileSystemManager.isIgnoredPath(p)) {
        try {
          const content = await this.fs.readFile(p);
          inlineFileContext += `\n--- CONTENT OF ${p} ---\n${content}\n`;
        } catch (e) {
          // ignore read errors
        }
      }
    }
    return inlineFileContext;
  }

  // ── Optimization: Cached memory recalls ────────────────────────
  async cachedRecall(query, topK = 5) {
    const key = `${query}:${topK}`;
    if (this.memoryCache.has(key)) {
      return this.memoryCache.get(key);
    }
    const results = await this.memory.recall(query, topK);
    this.memoryCache.set(key, results);
    return results;
  }

  // Clear cache at start of each session
  _clearCache() {
    this.memoryCache.clear();
  }

  async _runNonCodingTask(intentInfo, task, fileContext = null) {
    const inlineFileContext = fileContext || await this._buildInlineFileContext(task);
    const baseTask = intentInfo.strippedTask?.length ? intentInfo.strippedTask : "";
    const kind = intentInfo.intent === "summarize" ? "summary" : "explanation";
    const prompt =
      `You are a precise technical writer.

TASK:
${baseTask || "(No additional task details provided.)"}

${inlineFileContext ? "FILES MENTIONED IN TASK:\n" + inlineFileContext : ""}

Provide a clear ${kind}.
- Keep it concise and accurate.
- If files are provided, focus on their content.
- Output plain text only. No code blocks. No markdown.`;

    if (this.isAborted) return "";
    const response = await this.engine.ask(prompt, "writer", { signal: this.abortController.signal });
    if (this.isAborted) throw new Error("ABORTED");

    await this.memory.remember(response, { type: `generated_${intentInfo.intent}`, task: baseTask, agent: "writer" });
    await this.memory.logEvent(`Writer completed ${intentInfo.intent} response`);
    return response;
  }

  // ── Agent Nodes ────────────────────────────────────────────────

  async _plannerNode(state) {
    const spinner = ora(chalk.blue("🧠 Planner thinking...")).start();
    console.log("🧠 Planner is analyzing your request...");

    const savedContext = await this.memory.getContext();
    const lessons = await this.cachedRecall(state.task, 5); // Optimization: Use cached recall
    const lessonBlock = lessons.length
      ? "Lessons from past sessions:\n" + lessons.map((l) => `- ${l.text}`).join("\n")
      : "";
    const projectContext = await this.fs.getProjectContext();

    // Automatically detect and read files mentioned in the task
    const inlineFileContext = await this._buildInlineFileContext(state.task);

    const prompt =
      `You are a Lead AI Architect and expert software planner.

TASK:
${state.task}

${inlineFileContext ? "FILES MENTIONED IN TASK:\n" + inlineFileContext : ""}
${lessonBlock}

PROJECT FILES (sandbox scope):
${projectContext}

${savedContext ? "SAVED CONTEXT:\n" + savedContext : ""}

Break the task into concrete, small, executable sub-steps for a coding agent.
Output ONLY a valid JSON array of strings. No explanation. No markdown.`;

    if (this.isAborted) return { plan: [], aborted: true };

    const timeoutMs = 60000;
    const plannerAbort = new AbortController();
    const onAbort = () => plannerAbort.abort();
    this.abortController.signal.addEventListener("abort", onAbort, { once: true });
    if (this.abortController.signal.aborted) {
      plannerAbort.abort();
    }

    let raw;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      plannerAbort.abort();
    }, timeoutMs);

    try {
      raw = await this.engine.ask(prompt, "planner", {
        signal: plannerAbort.signal,
        timeoutMs,
      });
    } catch (error) {
      if (timedOut || error.name === "AbortError") {
        spinner.warn(chalk.yellow("Planner timed out. Falling back to a single-step plan."));
        await this.memory.logEvent("Planner timed out; fallback to single-step plan.");
        raw = null;
      } else {
        throw error;
      }
    } finally {
      clearTimeout(timer);
      this.abortController.signal.removeEventListener("abort", onAbort);
    }
    if (this.isAborted) throw new Error("ABORTED");
    let plan = [state.task];
    if (raw) {
      const match = raw.match(/\[[\s\S]*?\]/);
      if (match) {
        try {
          plan = JSON.parse(match[0]);
        } catch (error) {
          plan = [state.task];
        }
      }
    }

    spinner.succeed(chalk.green(`Plan ready — ${plan.length} steps`));

    // ── Human approves / edits / rejects the plan ──────────────
    const { approved, plan: finalPlan } = await this.gate.approvePlan(plan);

    if (!approved || finalPlan.length === 0) {
      console.log(chalk.yellow("\n  Plan rejected. Task cancelled."));
      return { plan: [], aborted: true };
    }

    await this.memory.logEvent(`Planner created ${finalPlan.length}-step plan`);
    return { plan: finalPlan, currentStep: 0, fileContext: inlineFileContext }; // Optimization: Cache file context in state
  }

  async _workerNode(state) {
    if (state.aborted) return { aborted: true };

    const step = state.plan[state.currentStep];
    const spinner = ora(chalk.yellow(`⚙️  Worker [${state.currentStep + 1}/${state.plan.length}]: ${step}`)).start();
    console.log(`⚙️  Worker executing step [${state.currentStep + 1}/${state.plan.length}]: ${step}`);

    const memories = await this.cachedRecall(step, 3); // Optimization: Use cached recall
    const memBlock = memories.length
      ? "Related past knowledge:\n" + memories.map((m) => `- ${m.text}`).join("\n")
      : "";

    // Optimization: Use cached file context from planner state (avoid re-reading)
    const inlineFileContext = state.fileContext || "";

    const prompt =
      `You are an expert software engineer working inside a sandboxed workspace.

CURRENT STEP:
${step}

EXISTING CODE SO FAR:
${(state.codeParts || []).filter(Boolean).join("\n\n") || "(none yet — start fresh)"}

${inlineFileContext ? "FILES MENTIONED BY USER:\n" + inlineFileContext : ""}
${memBlock}

ERRORS TO FIX (from Critic):
${state.errors.length ? state.errors.join("\n") : "None"}

Write complete, production-quality code. Output ONLY the code. No markdown fences, no explanations.`;

    if (this.isAborted) return { aborted: true };
    const newCode = await this.engine.ask(prompt, "worker", { signal: this.abortController.signal });
    if (this.isAborted) throw new Error("ABORTED");

    await this.memory.remember(newCode, { type: "generated_code", step, agent: "worker" });
    await this.memory.logEvent(`Worker completed step: ${step}`);
    spinner.succeed(chalk.green(`Step ${state.currentStep + 1} done`));

    const nextParts = [...(state.codeParts || [])];
    nextParts[state.currentStep] = newCode;
    const combinedCode = nextParts.filter(Boolean).join("\n\n");

    return { code: combinedCode, codeParts: nextParts, errors: [], retries: state.retries };
  }

  async _criticNode(state) {
    if (state.aborted) return { aborted: true };

    const spinner = ora(chalk.magenta("🔍 Critic reviewing...")).start();
    console.log("🔍 Critic is reviewing the code...");

    const lessons = await this.cachedRecall(`code review ${state.plan[state.currentStep]}`, 3); // Optimization: Use cached recall
    const lessonBlock = lessons.length
      ? "Known anti-patterns:\n" + lessons.map((l) => `- ${l.text}`).join("\n")
      : "";

    const prompt =
      `You are a senior code reviewer.

CODE:
${state.code}

${lessonBlock}

Check for: bugs, logic errors, missing edge-cases, security issues, bad patterns.
- If correct and complete → reply: APPROVED
- If issues → list each one clearly (no preamble).`;

    if (this.isAborted) return { aborted: true };
    const review = await this.engine.ask(prompt, "critic", { signal: this.abortController.signal });
    if (this.isAborted) throw new Error("ABORTED");

    if (review.trim().startsWith("APPROVED")) {
      await this.memory.remember(`APPROVED pattern for: ${state.plan[state.currentStep]}`, {
        type: "approved_pattern", agent: "critic",
      });
      await this.memory.logEvent("Critic: APPROVED");
      spinner.succeed(chalk.green("✅ Code approved!"));
      return {
        review: "APPROVED",
        errors: [],
        currentStep: state.currentStep + 1,
        retries: 0,
      };
    }

    await this.memory.learnLesson(review, "critic");
    await this.memory.logEvent(`Critic: issues found (retry ${state.retries + 1})`);
    spinner.fail(chalk.red(`Issues found (retry ${state.retries + 1}/${MAX_RETRIES})`));
    return { review, errors: [review], retries: state.retries + 1 };
  }

  // ── Routing ────────────────────────────────────────────────────

  _route(state) {
    if (state.aborted) return END;

    if (state.review === "APPROVED") {
      if (state.currentStep < state.plan.length) {
        return "worker";
      }
      return END;
    }
    if (state.retries >= MAX_RETRIES) {
      console.log(chalk.red("\n⚠️  Max retries reached. Output not approved."));
      return END;
    }
    return "worker";
  }

  // ── Graph Assembly ─────────────────────────────────────────────

  _buildGraph() {
    const wf = new StateGraph({ channels: GraphChannels });

    wf.addNode("planner", (s) => this._plannerNode(s));
    wf.addNode("worker", (s) => this._workerNode(s));
    wf.addNode("critic", (s) => this._criticNode(s));

    wf.addEdge(START, "planner");
    wf.addEdge("planner", "worker");
    wf.addEdge("worker", "critic");
    wf.addConditionalEdges("critic", (s) => this._route(s));

    return wf.compile();
  }

  // ── Public API ─────────────────────────────────────────────────

  async run(task) {
    this.isAborted = false;
    this.abortController = new AbortController();
    this._clearCache(); // Optimization: Clear cache for new session
    if (!task || !task.trim()) {
      console.log(chalk.yellow("\n  Task was empty. Please describe what you want."));
      return { aborted: true };
    }
    console.log(chalk.bold.cyan("\n╔══════════════════════════════════════╗"));
    console.log(chalk.bold.cyan("║     CONDUCTOR AI  —  STARTING UP     ║"));
    console.log(chalk.bold.cyan("╚══════════════════════════════════════╝\n"));

    await this.memory.init();
    const sessionId = await this.memory.startSession(task);
    console.log(chalk.dim(`Session ID: ${sessionId}\n`));

    const projectContext = await this.fs.getProjectContext();
    await this.memory.updateContext(`Session: ${task}\n\n${projectContext}`);

    const intentInfo = this._detectIntent(task);
    if (intentInfo.intent !== "code") {
      try {
        // Optimization: Pre-load file context once for non-coding tasks
        const fileContext = await this._buildInlineFileContext(task);
        const response = await this._runNonCodingTask(intentInfo, task, fileContext);
        if (this.isAborted) {
          console.log(chalk.yellow("\n  Task was cancelled before output write."));
          return { aborted: true };
        }
        if (!response) {
          console.log(chalk.yellow("\n  Task was cancelled or produced no output."));
          return { aborted: true };
        }
        const outPath = `intelligence/outputs/output_${sessionId}.md`;
        const written = await this.fs.writeFile(outPath, response);
        if (!written) {
          console.log(chalk.yellow("\n  Output write declined by user."));
          return { aborted: true, outputPath: null };
        }
        this.lastOutputPath = outPath;
        console.log(chalk.bold.green("\n╔══════════════════════════════════════╗"));
        console.log(chalk.bold.green("║          TASK  COMPLETE  ✔           ║"));
        console.log(chalk.bold.green("╚══════════════════════════════════════╝\n"));
        return { outputPath: outPath };
      } catch (err) {
        if (err?.message === "AbortError" || err?.name === "AbortError" || this.isAborted) {
          console.log(chalk.yellow("\n🛑 Task execution was stopped mid-flight."));
          await this.memory.logEvent("Execution aborted by user.");
          return { aborted: true };
        }
        await this.memory.logEvent(`FATAL ERROR: ${err.message}`);
        throw err;
      } finally {
        await this.memory.endSession();
      }
    }

    try {
      const finalState = await this.graph.invoke({
        task, plan: [], currentStep: 0,
        code: "", codeParts: [], review: "", errors: [], retries: 0, aborted: false,
      });

      if (this.isAborted) {
        console.log(chalk.yellow("\n  Task was cancelled before output write."));
        return { aborted: true };
      }

      if (finalState.retries >= MAX_RETRIES && finalState.review !== "APPROVED") {
        console.log(chalk.yellow("\n  Max retries reached. Output not approved."));
        return { aborted: true };
      }

      if (finalState.aborted || !finalState.code) {
        console.log(chalk.yellow("\n  Task was cancelled or produced no output."));
        return { aborted: true };
      }

      // Save output through the gated FileSystemManager
      // This will ask for approval before writing to disk
      const outPath = `intelligence/outputs/output_${sessionId}.js`;
      const written = await this.fs.writeFile(outPath, finalState.code);
      if (!written) {
        console.log(chalk.yellow("\n  Output write declined by user."));
        return { aborted: true, outputPath: null };
      }
      this.lastOutputPath = outPath;

      console.log(chalk.bold.green("\n╔══════════════════════════════════════╗"));
      console.log(chalk.bold.green("║          TASK  COMPLETE  ✔           ║"));
      console.log(chalk.bold.green("╚══════════════════════════════════════╝\n"));

      return { outputPath: outPath };

    } catch (err) {
      if (err.message === "AbortError" || err.name === "AbortError" || this.isAborted) {
        console.log(chalk.yellow("\n🛑 Task execution was stopped mid-flight."));
        await this.memory.logEvent(`Execution aborted by user.`);
        return { aborted: true };
      } else {
        await this.memory.logEvent(`FATAL ERROR: ${err.message}`);
        throw err;
      }
    } finally {
      await this.memory.endSession();
    }
  }
}
