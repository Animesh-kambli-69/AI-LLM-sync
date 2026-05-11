import { ChatOllama } from "@langchain/ollama";
import fs from "fs-extra";
import path from "path";

export class InferenceEngine {
  constructor() {
    this.models = new Map();
    this.wiring = null;
    this.availableModels = null;
    this.lastModelRefresh = 0;
  }

  createAbortController(externalSignal) {
    const controller = new AbortController();
    if (externalSignal) {
      if (externalSignal.aborted) {
        controller.abort();
      } else {
        externalSignal.addEventListener("abort", () => controller.abort(), { once: true });
      }
    }
    return controller;
  }

  async invokeWithTimeout(model, prompt, options = {}) {
    const controller = this.createAbortController(options.signal);
    const timeoutMs = options.timeoutMs ?? 0;
    let timer;

    if (timeoutMs > 0) {
      timer = setTimeout(() => controller.abort(), timeoutMs);
    }

    try {
      return await model.invoke(prompt, { signal: controller.signal });
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async loadWiring() {
    try {
      const manifestPath = path.resolve("intelligence", "manifest.json");
      const manifest = await fs.readJson(manifestPath);
      this.wiring = manifest.model_wiring || {};
    } catch (error) {
      console.warn("Could not load model wiring, using defaults.");
      this.wiring = {};
    }
  }

  async refreshAvailableModels() {
    const now = Date.now();
    if (this.availableModels && now - this.lastModelRefresh < 15000) return;
    try {
      const response = await fetch("http://localhost:11434/api/tags");
      const data = await response.json();
      const names = (data.models || []).map((m) => m.name);
      this.availableModels = new Set(names);
      this.lastModelRefresh = now;
    } catch (error) {
      this.availableModels = null;
    }
  }

  async resolveModels(modelsToQuery, fallbackModel = "llama3.1:8b") {
    await this.refreshAvailableModels();
    const normalized = modelsToQuery.map((name) => {
      const resolved = this.normalizeModelName(name, fallbackModel);
      const looksLikeModel = name.includes(":");
      if (resolved === name && !this.wiring?.[name] && !looksLikeModel) return fallbackModel;
      return resolved;
    });
    if (!this.availableModels) return normalized;

    const filtered = normalized.filter((name) => this.availableModels.has(name));
    if (filtered.length > 0) return filtered;

    console.log(`[Multi-Agent] No configured models available. Falling back to ${fallbackModel}.`);
    return [fallbackModel];
  }

  normalizeModelName(modelOrRole, defaultModel = "llama3.1:8b") {
    const resolved = this.wiring?.[modelOrRole] ?? modelOrRole ?? defaultModel;
    if (Array.isArray(resolved)) return resolved[0] || defaultModel;
    return resolved || defaultModel;
  }

  getModelForRole(role, defaultModel = "llama3.1:8b") {
    const modelName = this.normalizeModelName(role, defaultModel);
    return this.getModel(modelName);
  }

  getModel(modelName) {
    if (!this.models.has(modelName)) {
      this.models.set(modelName, new ChatOllama({
        baseUrl: "http://localhost:11434",
        model: modelName,
        temperature: 0.1,
      }));
    }
    return this.models.get(modelName);
  }

  async unloadModel(modelName) {
    try {
      console.log(`[Multi-Agent] Unloading ${modelName} from memory to save VRAM...`);
      await fetch("http://localhost:11434/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: modelName, keep_alive: 0 })
      });
    } catch(e) {
      // ignore
    }
  }

  async ask(prompt, modelOrRole, options = {}) {
    if (!this.wiring) await this.loadWiring();
    
    let modelsToQuery = this.wiring[modelOrRole] || modelOrRole;
    if (!Array.isArray(modelsToQuery)) {
      modelsToQuery = [modelsToQuery]; // Ensure it's an array
    }

    modelsToQuery = await this.resolveModels(modelsToQuery);

    if (modelsToQuery.length === 1) {
      const modelName = modelsToQuery[0];
      console.log(`[Multi-Agent] -> Querying ${modelName} for ${modelOrRole} role...`);
      const model = this.getModel(modelName);
      const response = await this.invokeWithTimeout(model, prompt, options);
      await this.unloadModel(modelName); // Aggressive memory flush
      return response.content;
    }

    console.log(`[Multi-Agent] ${modelOrRole} role has ${modelsToQuery.length} models. Querying sequentially to save memory...`);
    
    // Sequentially ask models to avoid out-of-memory errors on local setups
    const responses = [];
    for (const modelName of modelsToQuery) {
      if (options.signal?.aborted) throw new Error("AbortError");
      console.log(`[Multi-Agent] -> Querying ${modelName}...`);
      const model = this.getModel(modelName);
      const res = await this.invokeWithTimeout(model, prompt, options);
      responses.push(`=== Response from ${modelName} ===\n${res.content}\n`);
      await this.unloadModel(modelName); // Unload to make room for the next
    }

    // If it's multiple models, use the synthesizer to merge
    console.log(`[Multi-Agent] ${modelOrRole} responses received. Synthesizing...`);
    return await this.synthesize(prompt, responses.join("\n"), options);
  }

  async synthesize(originalPrompt, combinedResponses, options = {}) {
    if (!this.wiring) await this.loadWiring();
    
    let synthModelNames = this.wiring["synthesizer"] || "llama3.1:8b";
    if (!Array.isArray(synthModelNames)) synthModelNames = [synthModelNames];
    const resolvedSynth = await this.resolveModels(synthModelNames);
    const synthModelName = resolvedSynth[0];

    const synthModel = this.getModel(synthModelName);
    const synthPrompt = `You are a master AI Synthesizer.
    
ORIGINAL PROMPT:
${originalPrompt}

RESPONSES FROM EXPERT AGENTS:
${combinedResponses}

Your job is to synthesize these responses into a single, cohesive, and optimal final output. 
Resolve any contradictions by picking the best approach. 
Output ONLY the final synthesized content as requested by the original prompt (e.g. if the original prompt asked for ONLY JSON or ONLY code, output ONLY that format).`;

    const response = await this.invokeWithTimeout(synthModel, synthPrompt, options);
    await this.unloadModel(synthModelName); // Unload the synthesizer
    return response.content;
  }

  async plan(taskDescription, context) {
    const prompt = `You are a Lead AI Architect. 
    Task: ${taskDescription}
    Context: ${context}
    
    Break this task into small, executable steps for coding agents. 
    Output as a JSON array of sub-tasks.`;
    
    return await this.ask(prompt, "planner");
  }
}
