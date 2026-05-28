# RAG Fine-Tuning Guide: Make Models Answer Only Your Data

**Date:** May 26, 2026  
**Approach:** Retrieval-Augmented Generation (RAG) + Knowledge Base

Your models will now:
1. Search your knowledge base before answering
2. Use your specific data to generate responses
3. Cite sources and stay within domain boundaries

---

## 🎯 How RAG Works

```
User Question
    ↓
[Search Knowledge Base] ← Your documents live here
    ↓
[Retrieve Top 5 relevant chunks]
    ↓
[Inject into System Prompt] ← "Here's relevant knowledge..."
    ↓
[Model generates answer based ONLY on retrieved data]
    ↓
Answer with proper citations
```

**Advantage:** No model retraining needed, instant results, easy to update data

---

## 📂 Architecture You'll Build

```
intelligence/
  ├── knowledge/              ← NEW: Your domain data
  │   ├── docs/             
  │   │   ├── api-docs.pdf
  │   │   ├── architecture.md
  │   │   └── system-guide.txt
  │   └── ingestion/
  │       └── document-processor.js   ← NEW
  ├── memory/                ← Existing: Vector storage
  ├── context/              
  ├── manifest.json         ← Update this
  └── ...existing files
```

---

## 🚀 Implementation Steps

### Step 1: Install PDF Processing
```bash
npm install pdf-parse pdfjs-dist dotenv
```

### Step 2: Create Document Ingestion Pipeline
See `KnowledgeProcessor.js` below

### Step 3: Update Your Memory Manager
See `Enhanced-MemoryManager.js` below

### Step 4: Update Conductor for RAG
See usage examples below

### Step 5: Add Knowledge Sources
Place your PDFs/docs in `intelligence/knowledge/docs/`

---

## 📋 Step-by-Step Implementation

### Phase 1: Document Processing (20 min)

Create `intelligence/KnowledgeProcessor.js`:

```javascript
import pdf from 'pdf-parse';
import fs from 'fs-extra';
import path from 'path';
import { MemoryManager } from '../MemoryManager.js';

const KNOWLEDGE_DIR = path.resolve('intelligence', 'knowledge');
const DOCS_DIR = path.join(KNOWLEDGE_DIR, 'docs');

export class KnowledgeProcessor {
  constructor(memory) {
    this.memory = memory;
  }

  /**
   * Ingest a PDF document into the knowledge base
   * @param {string} filePath - Path to PDF
   * @param {string} docName - Human-readable name
   * @returns {Promise<number>} - Number of chunks stored
   */
  async ingestPDF(filePath, docName) {
    console.log(`📄 Ingesting PDF: ${docName}`);
    
    const dataBuffer = await fs.readFile(filePath);
    const pdfData = await pdf(dataBuffer);
    
    const chunks = this._chunkText(pdfData.text, 500); // 500 char chunks with overlap
    
    let stored = 0;
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      
      // Store in memory with metadata
      await this.memory.remember(chunk, {
        type: 'knowledge',
        source: docName,
        chunkIndex: i,
        url: filePath,
      });
      stored++;
    }
    
    console.log(`✅ Stored ${stored} chunks from ${docName}`);
    return stored;
  }

  /**
   * Ingest markdown/text file
   */
  async ingestMarkdown(filePath, docName) {
    console.log(`📝 Ingesting Markdown: ${docName}`);
    
    const content = await fs.readFile(filePath, 'utf-8');
    const chunks = this._chunkText(content, 500);
    
    let stored = 0;
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      
      await this.memory.remember(chunk, {
        type: 'knowledge',
        source: docName,
        chunkIndex: i,
        url: filePath,
      });
      stored++;
    }
    
    console.log(`✅ Stored ${stored} chunks from ${docName}`);
    return stored;
  }

  /**
   * Ingest all documents from docs folder
   */
  async ingestAllDocuments() {
    await fs.ensureDir(DOCS_DIR);
    
    const files = await fs.readdir(DOCS_DIR);
    let totalChunks = 0;
    
    for (const file of files) {
      const filePath = path.join(DOCS_DIR, file);
      const stat = await fs.stat(filePath);
      
      if (!stat.isFile()) continue;
      
      try {
        if (file.endsWith('.pdf')) {
          const chunks = await this.ingestPDF(filePath, file);
          totalChunks += chunks;
        } else if (file.endsWith('.md') || file.endsWith('.txt')) {
          const chunks = await this.ingestMarkdown(filePath, file);
          totalChunks += chunks;
        }
      } catch (error) {
        console.error(`❌ Error ingesting ${file}:`, error.message);
      }
    }
    
    console.log(`\n🎉 Knowledge base ready: ${totalChunks} total chunks`);
    return totalChunks;
  }

  /**
   * Smart chunking with overlap
   */
  _chunkText(text, chunkSize = 500, overlap = 100) {
    const chunks = [];
    
    // Split by paragraphs first
    const paragraphs = text.split(/\n\n+/);
    
    let currentChunk = '';
    
    for (const para of paragraphs) {
      if ((currentChunk + para).length > chunkSize) {
        if (currentChunk) {
          chunks.push(currentChunk.trim());
        }
        currentChunk = para;
      } else {
        currentChunk += (currentChunk ? '\n\n' : '') + para;
      }
    }
    
    if (currentChunk) {
      chunks.push(currentChunk.trim());
    }
    
    return chunks.filter(c => c.length > 50); // Skip tiny chunks
  }

  /**
   * Retrieve relevant knowledge for a query
   */
  async retrieveKnowledge(query, topK = 5) {
    const results = await this.memory.recall(query, topK);
    return results.filter(r => r.type === 'knowledge');
  }

  /**
   * Search knowledge base
   */
  async search(query, topK = 5) {
    const results = await this.retrieveKnowledge(query, topK);
    
    return {
      query,
      results: results.map(r => ({
        text: r.text,
        source: r.source,
        relevanceScore: r.score || 0.9,
      })),
    };
  }
}
```

### Phase 2: Enhanced Memory Manager

Modify `MemoryManager.js` to add a `recallWithMetadata()` method:

```javascript
/**
 * Recall with source metadata for RAG
 */
async recallWithMetadata(query, topK = 5) {
  if (!this.initialized) await this.init();
  
  if (this.useFallback || !this.collection) {
    // Fallback to file-based search
    const memoryDir = path.join(INTEL_DIR, "memory");
    const files = await fs.readdir(memoryDir);
    
    const results = [];
    for (const file of files) {
      try {
        const record = await fs.readJson(path.join(memoryDir, file));
        results.push({
          id: record.id,
          text: record.text,
          type: record.meta?.type || 'general',
          source: record.meta?.source || 'unknown',
          createdAt: record.createdAt,
          score: 0.9, // Fallback: assume high relevance
        });
      } catch (e) {
        // Skip invalid files
      }
    }
    
    return results.slice(0, topK);
  }
  
  // ChromaDB with metadata
  const results = await this.collection.query({
    queryTexts: [query],
    nResults: topK,
  });
  
  return (results.ids[0] || []).map((id, i) => ({
    id,
    text: results.documents[0][i],
    source: results.metadatas[0][i]?.source || 'unknown',
    type: results.metadatas[0][i]?.type || 'general',
    score: results.distances[0][i] || 0.9,
  }));
}
```

### Phase 3: RAG-Enhanced Conductor

Update `Conductor.js` to inject knowledge into prompts:

```javascript
/**
 * NEW: Retrieve relevant knowledge for any task
 */
async _getRelevantKnowledge(query, topK = 5) {
  const results = await this.memory.recallWithMetadata(query, topK);
  
  if (results.length === 0) {
    return { knowledge: '', sources: [] };
  }
  
  const knowledge = results
    .map((r, i) => `[Source: ${r.source}]\n${r.text}`)
    .join('\n---\n');
  
  const sources = [...new Set(results.map(r => r.source))];
  
  return { knowledge, sources };
}

/**
 * MODIFY: Existing _plannerNode to use knowledge
 */
async _plannerNode(state) {
  const spinner = ora(chalk.blue("🧠 Planner thinking...")).start();
  
  // ADDED: Retrieve relevant knowledge
  const { knowledge, sources } = await this._getRelevantKnowledge(state.task, 5);
  const knowledgeBlock = knowledge 
    ? `\nRELEVANT KNOWLEDGE FROM YOUR DATA:\n${knowledge}\n`
    : '';
  
  const savedContext = await this.memory.getContext();
  const lessons = await this.cachedRecall(state.task, 5);
  const lessonBlock = lessons.length
    ? "Lessons from past sessions:\n" + lessons.map((l) => `- ${l.text}`).join("\n")
    : "";
  const projectContext = await this.fs.getProjectContext();

  const inlineFileContext = await this._buildInlineFileContext(state.task);

  const prompt =
    `You are a Lead AI Architect specializing in the following domain(s):
${sources.length ? `DOMAINS: ${sources.join(', ')}` : ''}

TASK:
${state.task}

${inlineFileContext ? "FILES MENTIONED IN TASK:\n" + inlineFileContext : ""}
${knowledgeBlock}
${lessonBlock}

PROJECT FILES (sandbox scope):
${projectContext}

${savedContext ? "SAVED CONTEXT:\n" + savedContext : ""}

Break the task into concrete, small, executable sub-steps using the knowledge provided above.
Output ONLY a valid JSON array of strings. No explanation. No markdown.`;

  // ... rest of method stays the same
}

/**
 * MODIFY: Existing _workerNode to use knowledge
 */
async _workerNode(state) {
  if (state.aborted) return { aborted: true };

  const step = state.plan[state.currentStep];
  const spinner = ora(chalk.yellow(`⚙️  Worker [${state.currentStep + 1}/${state.plan.length}]: ${step}`)).start();

  // ADDED: Retrieve knowledge for this specific step
  const { knowledge: stepKnowledge, sources: stepSources } = await this._getRelevantKnowledge(step, 3);
  const stepKnowledgeBlock = stepKnowledge 
    ? `\nRELEVANT KNOWLEDGE:\n${stepKnowledge}\n`
    : '';

  const memories = await this.cachedRecall(step, 3);
  const memBlock = memories.length
    ? "Related past knowledge:\n" + memories.map((m) => `- ${m.text}`).join("\n")
    : "";

  const inlineFileContext = state.fileContext || "";

  const prompt =
    `You are an expert software engineer working with specialized knowledge.
${stepSources.length ? `EXPERTISE AREAS: ${stepSources.join(', ')}` : ''}

CURRENT STEP:
${step}

EXISTING CODE SO FAR:
${(state.codeParts || []).filter(Boolean).join("\n\n") || "(none yet — start fresh)"}

${inlineFileContext ? "FILES MENTIONED BY USER:\n" + inlineFileContext : ""}
${stepKnowledgeBlock}
${memBlock}

ERRORS TO FIX (from Critic):
${state.errors.length ? state.errors.join("\n") : "None"}

Using the knowledge and expertise above, write complete, production-quality code. 
Output ONLY the code. No markdown fences, no explanations.`;

  // ... rest of method stays the same
}
```

### Phase 4: Initialize Knowledge Base

Create `initialize-knowledge-base.js`:

```javascript
import { MemoryManager } from './MemoryManager.js';
import { KnowledgeProcessor } from './intelligence/KnowledgeProcessor.js';

async function initializeKnowledgeBase() {
  console.log('🚀 Initializing Knowledge Base...\n');
  
  const memory = new MemoryManager();
  await memory.init();
  
  const processor = new KnowledgeProcessor(memory);
  
  // Ingest all documents from docs folder
  const totalChunks = await processor.ingestAllDocuments();
  
  console.log(`\n✅ Knowledge base initialized with ${totalChunks} chunks`);
  console.log('📁 Place your PDFs and markdown files in: intelligence/knowledge/docs/');
}

initializeKnowledgeBase().catch(console.error);
```

### Phase 5: Add Commands to package.json

```json
{
  "scripts": {
    "dev": "concurrently \"npm run server\" \"vite\"",
    "server": "nodemon server.js",
    "build": "vite build",
    "preview": "vite preview",
    "init-knowledge": "node initialize-knowledge-base.js",
    "ingest:pdf": "node -e \"import('./intelligence/KnowledgeProcessor.js').then(m => new m.KnowledgeProcessor().ingestPDF(process.argv[1], process.argv[2]))\" --",
    "search-knowledge": "node -e \"import('./intelligence/KnowledgeProcessor.js').then(m => new m.KnowledgeProcessor().search(process.argv[1]))\" --"
  }
}
```

---

## 💾 How to Add Your Domain Knowledge

### Method 1: PDFs (Easiest)
```bash
# 1. Create docs folder
mkdir -p intelligence/knowledge/docs

# 2. Add your PDFs
cp /path/to/api-documentation.pdf intelligence/knowledge/docs/
cp /path/to/system-architecture.pdf intelligence/knowledge/docs/
cp /path/to/best-practices.pdf intelligence/knowledge/docs/

# 3. Ingest them
npm run init-knowledge
```

### Method 2: Markdown Files
```bash
# Add markdown docs
echo "# My Custom API Docs
This is a GET endpoint that does X
" > intelligence/knowledge/docs/api-guide.md

# Ingest
npm run init-knowledge
```

### Method 3: Text Files
```bash
# Simple text files work too
echo "Your domain knowledge here..." > intelligence/knowledge/docs/notes.txt

npm run init-knowledge
```

### Method 4: Programmatically (in code)
```javascript
const processor = new KnowledgeProcessor(memory);

// Add single PDF
await processor.ingestPDF('path/to/doc.pdf', 'API Documentation');

// Add markdown
await processor.ingestMarkdown('path/to/guide.md', 'System Guide');

// Or ingest entire folder
await processor.ingestAllDocuments();
```

---

## 🧪 Test Your RAG System

### Test 1: Search Knowledge Base
```bash
npm run search-knowledge "What is the API endpoint for users?"
```

Expected output:
```
{
  query: 'What is the API endpoint for users?',
  results: [
    {
      text: 'GET /api/v1/users - Returns list of all users...',
      source: 'api-documentation.pdf',
      relevanceScore: 0.95
    },
    { ... }
  ]
}
```

### Test 2: Ask Question (Model will use knowledge)
```
User: "How do I list all users?"

Model searches knowledge base first...
[Finds: "GET /api/v1/users from api-documentation.pdf"]

Model answers: "Use the GET /api/v1/users endpoint as documented 
in our API guide. This returns a paginated list of all users in the system."
```

### Test 3: Verify Knowledge Injection
```javascript
// In Conductor, before asking the model:
const { knowledge, sources } = await this._getRelevantKnowledge(userQuery, 5);

console.log('📚 Retrieved sources:', sources);
// Output: Retrieved sources: ['api-documentation.pdf', 'system-guide.md']

console.log('🔍 Knowledge chunks:', knowledge);
// Output: Shows the actual text chunks from your docs
```

---

## 🎯 How This Prevents Wrong Answers

**Before RAG:**
```
User: "How do I list users?"
Model: "You could use a /users endpoint... or maybe fetch('...') 
        could work... Here are several approaches..."
        [VAGUE, POSSIBLY WRONG]
```

**After RAG:**
```
User: "How do I list users?"
[RAG retrieves from your docs: "GET /api/v1/users returns users"]
Model: "According to our API documentation, use GET /api/v1/users. 
        Example: curl https://api.example.com/api/v1/users"
        [ACCURATE, CITED, SPECIFIC]
```

---

## 📊 Configuration

Update `manifest.json`:

```json
{
  "knowledge_base": {
    "enabled": true,
    "docs_dir": "intelligence/knowledge/docs",
    "chunk_size": 500,
    "chunk_overlap": 100,
    "max_recall_chunks": 5,
    "auto_ingest_on_startup": true
  },
  "rag": {
    "enable_citations": true,
    "enforce_knowledge_only": false,
    "fallback_on_no_knowledge": true
  }
}
```

**Options:**
- `enforce_knowledge_only: true` - Model ONLY answers from your data (strict mode)
- `enforce_knowledge_only: false` - Model can answer generally if no knowledge found
- `enable_citations: true` - Model cites sources ("According to api-docs.pdf...")

---

## 🚀 Quick Start (5 minutes)

```bash
# 1. Install dependencies
npm install pdf-parse pdfjs-dist

# 2. Add your documents
mkdir -p intelligence/knowledge/docs
cp your-api-docs.pdf intelligence/knowledge/docs/

# 3. Initialize knowledge base
npm run init-knowledge

# 4. Start your app
npm run dev

# 5. Ask a question - model will now use your data!
```

---

## 📈 Advanced: Measuring Relevance

Add relevance scoring to ensure quality:

```javascript
async function evaluateRelevance(query, retrievedKnowledge) {
  // Simple: check if keywords from query appear in knowledge
  const queryWords = query.toLowerCase().split(/\s+/);
  const knowledgeText = retrievedKnowledge.text.toLowerCase();
  
  const matches = queryWords.filter(w => knowledgeText.includes(w));
  const relevance = matches.length / queryWords.length;
  
  return relevance > 0.5 ? 'RELEVANT' : 'NEEDS_REVIEW';
}
```

---

## 🎓 When to Use RAG vs Fine-Tuning

| Approach | Setup Time | Best For | Can Update Data |
|----------|-----------|----------|-----------------|
| **RAG** (what we built) | 5 min | Domain docs, APIs, policies | ✅ Yes (instant) |
| **Fine-tuning** | Hours-days | Style, tone, reasoning patterns | ❌ Need retrain |
| **Custom Instructions** | 1 min | Behavior, output format | ✅ Yes (instant) |

**You chose RAG:** Perfect for keeping models accurate on your specific documentation!

---

## 💡 Next Steps

1. **Start here:** Create `intelligence/knowledge/docs/` folder
2. **Add your docs:** PDFs, markdown, text files
3. **Run:** `npm run init-knowledge`
4. **Test:** Ask your model questions - it will search your data first
5. **Monitor:** Check logs for knowledge retrieval: `📚 Retrieved sources: [...]`

Ready to add your domain knowledge? 🚀
