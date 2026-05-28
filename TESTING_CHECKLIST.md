# ✅ Performance Testing Checklist

**Quick verification that optimizations are working**

---

## 🧪 Test 1: Model Caching Works

### Steps:
1. Start the server: `npm run dev`
2. Run a simple task first time
3. Run the same task again (or similar task with same models)
4. Watch console logs

### ✅ Success Indicators:
- First run: `[Inference] 📦 Loaded model: qwen2.5-coder:7b`
- Second run: `[Inference] ♻️ Keeping qwen2.5-coder:7b hot in memory`
- No "Unloading" messages between runs

### ❌ Failed If:
- See "Unloading X" followed by "Loaded model X" on second run
- Check manifest.json - verify `aggressive_unload: false`

---

## 🧪 Test 2: Parallel Execution Works

### Steps:
1. Run a coding task that uses multiple agents
2. Watch the console for concurrent logging
3. Compare timestamps

### ✅ Success Indicators:
```
[Multi-Agent] 🤖 planner → llama3.1:8b
[Multi-Agent] 🤖 worker → qwen2.5-coder:7b
[Multi-Agent] 🤖 critic → mistral:7b
```
All three starting nearly simultaneously (within milliseconds)

### ✅ Timing Improvement:
- BEFORE: 3 agents × 3s each = 9s sequential
- AFTER: 3 agents in parallel = ~3s + 1s synthesis = 4s
- Should see **60% speedup** on multi-agent tasks

### ❌ Failed If:
- Each agent output appears sequentially (one after another)
- Check manifest.json - verify `max_parallel_requests: 3`

---

## 🧪 Test 3: Memory Monitoring (Optional)

### Prerequisites:
- GPU or high CPU load setup
- Enable monitoring: `enable_memory_monitoring: true` in manifest.json

### Steps:
1. Run a heavy task that stresses system
2. Watch for memory pressure messages

### ✅ Success Indicators:
- If VRAM gets high, see: `[Inference] 🚨 VRAM high (92%). Reducing parallelism to 1.`
- System automatically self-heals by reducing parallel requests

### This Tests:
- Auto-scaling parallelism based on system load
- Prevents out-of-memory crashes

---

## 📊 Test 4: Reuse Statistics

### Steps:
1. Run a task (any size)
2. Let it complete fully
3. Look at final logs

### ✅ Success Indicators:
```
[Inference] 📊 Stats: 12 total, 75% model reuse
```

### What This Means:
- 12 = total model queries
- 75% = percent that reused cached models
- Higher is better (60%+ is good, 80%+ is excellent)

### ❌ Failed If:
- Stats show 0% reuse
- Stats don't appear at all
- Check that `requestStats` is being tracked in InferenceEngine.js

---

## 🎯 Performance Baseline Test

### Before/After Comparison

**Before Optimization:**
```
Time: npm run dev (wait for ready)
Task: "Write a hello world function in JavaScript"

Observed timing:
[Planner started] 08:30:00
[Planner done] 08:30:03 (3s)
[Worker started] 08:30:04
[Worker done] 08:30:07 (3s)
[Critic started] 08:30:08
[Critic done] 08:30:11 (3s)
Total: ~11 seconds
```

**After Optimization (Run Same Task Again):**
```
Time: npm run dev (wait for ready)
Task: Same task

Observed timing:
[Planner started] 08:35:00
[Worker started] 08:35:00 (parallel!)
[Critic started] 08:35:00 (parallel!)
[All done] 08:35:03
Total: ~3 seconds
Expected: 40-60% faster = YES ✅
```

---

## 🔧 Troubleshooting

### Problem: Still seeing sequential execution
**Solution:**
1. Check manifest.json: `max_parallel_requests` should be ≥ 2
2. Restart server after editing manifest.json
3. Check for errors in console logs

### Problem: Models being unloaded too frequently
**Solution:**
1. Increase `model_keep_alive_ms` (try 300000 = 5 min)
2. Verify `aggressive_unload: false`
3. Increase `max_cached_models` to 5-6

### Problem: Running out of VRAM
**Solution:**
1. Reduce `max_cached_models` from 4 to 2-3
2. Reduce `max_parallel_requests` from 3 to 2
3. Enable `auto_reduce_parallel: true` (will auto-scale)
4. Use smaller models (mistral:7b instead of larger variants)

### Problem: First run still slow
**Solution:**
- This is expected (cold cache)
- Run same task twice - second should be much faster
- Or pre-warm models by running dummy queries

---

## 📋 Quick Reference

| Setting | Purpose | Default | Adjust If |
|---------|---------|---------|-----------|
| `max_parallel_requests` | Concurrent models | 3 | Slow: ↑ to 4 / OOM: ↓ to 1 |
| `aggressive_unload` | Always unload model | false | Needed if OOM: set to true |
| `model_keep_alive_ms` | Keep model in RAM | 120000 (2min) | Cold start: ↑ to 300000 |
| `max_cached_models` | Models in cache | 4 | OOM: ↓ to 2 |
| `auto_reduce_parallel` | Smart scaling | true | Disable if too aggressive |
| `vram_threshold_percent` | When to reduce | 85 | Adjust if threshold too high |

---

## 💡 Expected Log Output

### Healthy Session:
```
[Inference] ⚡ Optimizations enabled:
  - Max parallel requests: 3
  - Aggressive unload: false
  - Max cached models: 4
  - Model keep-alive: 120000ms
  - Memory monitoring: true

[Inference] 📦 Loaded model: llama3.1:8b (cache size: 1/4)
[Inference] 📦 Loaded model: qwen2.5-coder:7b (cache size: 2/4)
[Inference] 📦 Loaded model: mistral:7b (cache size: 3/4)

[Inference] ♻️ Keeping qwen2.5-coder:7b hot in memory
[Inference] ♻️ Keeping mistral:7b hot in memory
[Inference] ♻️ Keeping llama3.1:8b hot in memory

[Inference] 📊 Stats: 15 total, 80% model reuse
```

### Problem Session:
```
[Inference] ⚡ Optimizations enabled...
  aggressive_unload: true   ← ❌ Should be false
  max_parallel_requests: 1  ← ❌ Should be 3

[Multi-Agent] Unloading qwen2.5-coder:7b   ← ❌ Shouldn't unload
[Multi-Agent] Unloading mistral:7b         ← ❌ Shouldn't unload

[Inference] 📊 Stats: 15 total, 20% model reuse ← ❌ Too low
```

---

## ✨ Success Criteria

- [ ] Models kept hot (♻️ messages appearing)
- [ ] Agents run in parallel (timestamps close together)
- [ ] Model reuse > 60%
- [ ] Multi-agent tasks 2-3x faster than before
- [ ] No VRAM errors or crashes
- [ ] Cold start → warm run shows 40%+ speedup

**All boxes checked = Optimization successful! 🚀**
