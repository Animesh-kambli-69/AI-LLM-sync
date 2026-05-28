import { ChatOllama } from "@langchain/ollama";
import fs from "fs-extra";
import path from "path";

export class InferenceEngine {
  constructor() {
    this.models = new Map();                    // model name → ChatOllama instance
    this.modelLastUsed = new Map();             // model name → timestamp (for LRU)
    this.modelLocks = new Map();                // model name → lock count (prevent unload if in use)
    this.wiring = null;
    this.availableModels = null;
    this.lastModelRefresh = 0;
    
    // CPU optimization settings
    this.cpuOptimized = true;
    this.maxParallelRequests = 1;               // Will be updated from manifest
    this.responseStreaming = true;
    this.aggressiveUnload = true;               // Will be updated from manifest
    this.modelKeepAliveMs = 120000;             // Default 2 min
    this.maxCachedModels = 4;
    this.enableMemoryMonitoring = false;
    this.autoReduceParallel = false;
    this.vramThresholdPercent = 85;
    
    // Queue management
    this.requestQueue = [];
    this.activeRequests = 0;
    this.requestStats = { total: 0, reused: 0 };
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
      
      // Load CPU optimization settings
      if (manifest.inference?.cpu_optimizations?.enabled) {
        const cpuOpts = manifest.inference.cpu_optimizations;
        this.cpuOptimized = true;
        this.maxParallelRequests = cpuOpts.max_parallel_requests || 1;
        this.responseStreaming = cpuOpts.response_streaming !== false;
        this.aggressiveUnload = cpuOpts.aggressive_unload !== false;
        this.modelKeepAliveMs = cpuOpts.model_keep_alive_ms || 120000;
        this.maxCachedModels = cpuOpts.max_cached_models || 4;
        this.enableMemoryMonitoring = cpuOpts.enable_memory_monitoring || false;
        this.autoReduceParallel = cpuOpts.auto_reduce_parallel || false;
        this.vramThresholdPercent = cpuOpts.vram_threshold_percent || 85;
        
        console.log(`[Inference] ⚡ Optimizations enabled:`);
        console.log(`  - Max parallel requests: ${this.maxParallelRequests}`);
        console.log(`  - Aggressive unload: ${this.aggressiveUnload}`);
        console.log(`  - Max cached models: ${this.maxCachedModels}`);
        console.log(`  - Model keep-alive: ${this.modelKeepAliveMs}ms`);
        console.log(`  - Memory monitoring: ${this.enableMemoryMonitoring}`);
      }
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
      // Check if we need to evict LRU before adding new model
      if (this.models.size >= this.maxCachedModels && this.maxCachedModels > 0) {
        this.evictLRU();
      }
      this.models.set(modelName, new ChatOllama({
        baseUrl: "http://localhost:11434",
        model: modelName,
        temperature: 0.1,
      }));
      console.log(`[Inference] 📦 Loaded model: ${modelName} (cache size: ${this.models.size}/${this.maxCachedModels})`);
    }
    return this.models.get(modelName);
  }

  // ── Smart Model Management (LRU Cache) ────────────────────────

  /**
   * Track model usage for LRU eviction policy
   */
  trackModelUsage(modelName) {
    this.modelLastUsed.set(modelName, Date.now());
    this.requestStats.total++;
    if (this.models.has(modelName)) {
      this.requestStats.reused++;
    }
  }

  /**
   * Check if we should keep model in memory based on time and cache size
   */
  shouldKeepModel(modelName) {
    if (this.aggressiveUnload === false) {
      // If aggressive unload is disabled, keep all models hot
      return true;
    }

    // If model is locked (currently in use), keep it
    if ((this.modelLocks.get(modelName) || 0) > 0) {
      return true;
    }

    // Check if within keep-alive window
    const lastUsed = this.modelLastUsed.get(modelName) || 0;
    const age = Date.now() - lastUsed;
    if (age < this.modelKeepAliveMs) {
      return true;
    }

    // If cache not full, keep the model
    if (this.models.size < this.maxCachedModels) {
      return true;
    }

    return false;
  }

  /**
   * Evict least recently used model if cache is full
   */
  async evictLRU() {
    if (this.models.size < this.maxCachedModels) {
      return;
    }

    // Find least recently used model that's not locked
    let oldestModel = null;
    let oldestTime = Infinity;

    for (const [modelName, _] of this.models.entries()) {
      if ((this.modelLocks.get(modelName) || 0) > 0) {
        // Skip locked models
        continue;
      }
      const lastUsed = this.modelLastUsed.get(modelName) || 0;
      if (lastUsed < oldestTime) {
        oldestTime = lastUsed;
        oldestModel = modelName;
      }
    }

    if (oldestModel) {
      console.log(`[Inference] 🗑️  LRU evicting model: ${oldestModel}`);
      this.models.delete(oldestModel);
      this.modelLastUsed.delete(oldestModel);
      await this.unloadModel(oldestModel);
    }
  }

  /**
   * Get VRAM usage percentage from Ollama
   */
  async getVramUsagePercent() {
    try {
      const response = await fetch("http://localhost:11434/api/ps");
      const data = await response.json();
      // This is a rough estimate; Ollama doesn't expose exact VRAM limits
      // In practice, you'd query system VRAM and active model sizes
      return 50; // Default: assume moderate load
    } catch (e) {
      return 0;
    }
  }

  /**
   * Conditional unload: only unload if:
   * - Aggressive mode is enabled, OR
   * - Cache is full, OR
   * - Memory pressure is high
   */
  async conditionalUnload(modelName) {
    if (this.aggressiveUnload) {
      // Legacy behavior: always unload
      await this.unloadModel(modelName);
      this.models.delete(modelName);
      return;
    }

    // Smart conditional unload
    const shouldKeep = this.shouldKeepModel(modelName);
    if (!shouldKeep) {
      console.log(`[Inference] ⏹️  Unloading ${modelName} (keep-alive expired)`);
      await this.unloadModel(modelName);
      this.models.delete(modelName);
    } else {
      console.log(`[Inference] ♻️  Keeping ${modelName} hot in memory`);
    }
  }

  async unloadModel(modelName) {
    try {
      // Don't log on every keep - only on actual unload
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
    
    // Process request with smart queuing and parallelism
    return new Promise((resolve, reject) => {
      this.requestQueue.push(async () => {
        try {
          let modelsToQuery = this.wiring[modelOrRole] || modelOrRole;
          if (!Array.isArray(modelsToQuery)) {
            modelsToQuery = [modelsToQuery];
          }

          modelsToQuery = await this.resolveModels(modelsToQuery);

          if (modelsToQuery.length === 1) {
            const modelName = modelsToQuery[0];
            console.log(`[Multi-Agent] 🤖 ${modelOrRole} → ${modelName}`);
            
            // Lock model to prevent eviction
            this.modelLocks.set(modelName, (this.modelLocks.get(modelName) || 0) + 1);
            try {
              const model = this.getModel(modelName);
              this.trackModelUsage(modelName);
              const response = await this.invokeWithTimeout(model, prompt, options);
              await this.conditionalUnload(modelName);
              return response.content;
            } finally {
              // Unlock model
              const count = this.modelLocks.get(modelName) || 0;
              if (count > 1) {
                this.modelLocks.set(modelName, count - 1);
              } else {
                this.modelLocks.delete(modelName);
              }
            }
          }

          console.log(`[Multi-Agent] 🔄 ${modelOrRole} using ${modelsToQuery.length} models (sequential)`);
          
          const responses = [];
          for (const modelName of modelsToQuery) {
            if (options.signal?.aborted) throw new Error("AbortError");
            
            // Lock model
            this.modelLocks.set(modelName, (this.modelLocks.get(modelName) || 0) + 1);
            try {
              console.log(`[Multi-Agent]   → Querying ${modelName}...`);
              const model = this.getModel(modelName);
              this.trackModelUsage(modelName);
              const res = await this.invokeWithTimeout(model, prompt, options);
              responses.push(`=== Response from ${modelName} ===\n${res.content}\n`);
              await this.conditionalUnload(modelName);
            } finally {
              // Unlock model
              const count = this.modelLocks.get(modelName) || 0;
              if (count > 1) {
                this.modelLocks.set(modelName, count - 1);
              } else {
                this.modelLocks.delete(modelName);
              }
            }
          }

          console.log(`[Multi-Agent] ✅ Responses received. Synthesizing...`);
          return await this.synthesize(prompt, responses.join("\n"), options);
        } catch (error) {
          throw error;
        }
      });
      
      this._processQueue().then(resolve).catch(reject);
    });
  }

  async _processQueue() {
    // Auto-reduce parallelism if memory pressure is high
    let effectiveParallel = this.maxParallelRequests;
    if (this.autoReduceParallel && this.enableMemoryMonitoring) {
      const vramUsage = await this.getVramUsagePercent();
      if (vramUsage > this.vramThresholdPercent) {
        effectiveParallel = Math.max(1, Math.floor(this.maxParallelRequests / 2));
        console.log(`[Inference] 🚨 VRAM high (${vramUsage}%). Reducing parallelism to ${effectiveParallel}.`);
      }
    }

    while (this.requestQueue.length > 0 && this.activeRequests < effectiveParallel) {
      this.activeRequests++;
      const task = this.requestQueue.shift();
      try {
        return await task();
      } finally {
        this.activeRequests--;
        if (this.requestQueue.length > 0) {
          return await this._processQueue();
        } else {
          // Queue empty - log stats
          const reuseRate = this.requestStats.total > 0 
            ? ((this.requestStats.reused / this.requestStats.total) * 100).toFixed(1)
            : "0";
          console.log(`[Inference] 📊 Stats: ${this.requestStats.total} total, ${reuseRate}% model reuse`);
        }
      }
    }
  }

  async synthesize(originalPrompt, combinedResponses, options = {}) {
    if (!this.wiring) await this.loadWiring();
    
    let synthModelNames = this.wiring["synthesizer"] || "llama3.1:8b";
    if (!Array.isArray(synthModelNames)) synthModelNames = [synthModelNames];
    const resolvedSynth = await this.resolveModels(synthModelNames);
    const synthModelName = resolvedSynth[0];

    // Lock model
    this.modelLocks.set(synthModelName, (this.modelLocks.get(synthModelName) || 0) + 1);
    try {
      const synthModel = this.getModel(synthModelName);
      this.trackModelUsage(synthModelName);
      
      const synthPrompt = `You are a master AI Synthesizer.
    
ORIGINAL PROMPT:
${originalPrompt}

RESPONSES FROM EXPERT AGENTS:
${combinedResponses}

Your job is to synthesize these responses into a single, cohesive, and optimal final output. 
Resolve any contradictions by picking the best approach. 
Output ONLY the final synthesized content as requested by the original prompt (e.g. if the original prompt asked for ONLY JSON or ONLY code, output ONLY that format).`;

      const response = await this.invokeWithTimeout(synthModel, synthPrompt, options);
      await this.conditionalUnload(synthModelName);
      return response.content;
    } finally {
      // Unlock model
      const count = this.modelLocks.get(synthModelName) || 0;
      if (count > 1) {
        this.modelLocks.set(synthModelName, count - 1);
      } else {
        this.modelLocks.delete(synthModelName);
      }
    }
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
