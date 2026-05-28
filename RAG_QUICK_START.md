# ⚡ RAG Fine-Tuning Quick Start (5 Minutes)

**Goal:** Make your models answer ONLY based on your specific domain knowledge

---

## 🎯 The 3-Step Process

```
YOUR DOCUMENTS → INGEST → KNOWLEDGE BASE → MODEL ANSWERS
     (PDFs)       ↓      (ChromaDB)          (Based on your data)
   (Markdown)  Search       ↓
   (Text)   & Retrieve    Vector
             Store
```

---

## 📋 Step 1: Prepare Your Documents (2 min)

### Create the knowledge folder:
```bash
mkdir -p intelligence/knowledge/docs
```

### Add your documents (replace examples with REAL docs):
```bash
# Copy your PDFs
cp /path/to/api-documentation.pdf intelligence/knowledge/docs/

# Copy your markdown files
cp /path/to/architecture-guide.md intelligence/knowledge/docs/

# Copy text files
cp /path/to/procedures.txt intelligence/knowledge/docs/
```

**What documents to add:**
- API documentation
- System architecture guides
- Technical specifications
- Code standards
- Business rules
- Any domain-specific knowledge you want models to know

---

## 💾 Step 2: Install & Ingest (2 min)

### Install PDF support:
```bash
npm install pdf-parse
```

### Ingest all documents:
```bash
# Run the ingestion
node intelligence/KnowledgeProcessor.js ingest-all
```

Expected output:
```
🚀 Starting knowledge base ingestion...

Found 3 documents to process:

📄 Processing PDF: api-documentation.pdf
  📊 Extracted 42 chunks from 15 pages
  ✅ Stored 42 chunks

📝 Processing Markdown: architecture-guide.md
  📊 Created 18 chunks
  ✅ Stored 18 chunks

... more documents ...

🎉 Knowledge base ready!
   📚 Documents processed: 3
   📖 Total chunks stored: 127
```

---

## 🚀 Step 3: Start Using It! (1 min)

### Start your server:
```bash
npm run dev
```

### Models now use your knowledge:

**Before (without RAG):**
```
User: "What's the API endpoint for users?"
Model: "You might use /users or /api/users... 
        or could be /v1/users... here are some options"
        ❌ VAGUE & POSSIBLY WRONG
```

**After (with RAG):**
```
User: "What's the API endpoint for users?"
[Model searches your docs...]
[Finds: "GET /api/v1/users" in api-documentation.pdf]
Model: "According to our API documentation, 
        use GET /api/v1/users to retrieve the list of users.
        This endpoint returns paginated results."
        ✅ ACCURATE & CITED
```

---

## 🔍 How to Test It Works

### Test 1: Search Your Knowledge Base
```bash
node intelligence/KnowledgeProcessor.js search "API endpoint for users"
```

Expected output:
```
🔍 Searching knowledge base for: "API endpoint for users"

✅ Found 3 relevant chunks:

1. [api-documentation.pdf] (relevance: 95%)
   GET /api/v1/users returns a paginated list of all users...

2. [architecture-guide.md] (relevance: 87%)
   The user service is responsible for managing user accounts...

3. [procedures.txt] (relevance: 76%)
   To list users, follow these steps...
```

### Test 2: Ask Your Model
```
Your app → Ask a question about your domain
↓
Model searches knowledge base
↓
"Based on our documentation, the answer is..."
↓
Answer includes source citation ✅
```

---

## 📊 View What's Ingested

```bash
node intelligence/KnowledgeProcessor.js summary
```

Output:
```
📚 Knowledge Base Summary:
   Documents: 3
   Total chunks: 127

Documents:

   1. api-documentation.pdf
      Type: pdf
      Chunks: 42
      Ingested: 5/26/2026

   2. architecture-guide.md
      Type: md
      Chunks: 18
      Ingested: 5/26/2026

   3. procedures.txt
      Type: txt
      Chunks: 67
      Ingested: 5/26/2026
```

---

## ✨ What Happens Internally

### 1️⃣ When you ingest documents:
```
PDF/Markdown/Text
     ↓
[Split into chunks of 500 chars]
     ↓
[Convert to embeddings (vectors)]
     ↓
[Store in ChromaDB with metadata]
     ↓
[Save index of what was ingested]
```

### 2️⃣ When a model answers:
```
User Question
     ↓
[Search embeddings for similar content]
     ↓
[Retrieve top 5 relevant chunks]
     ↓
[Inject into system prompt]
     ↓
[Model sees: "Here's relevant knowledge from your docs..."]
     ↓
[Model answers based on YOUR data]
```

---

## 🎮 Common Commands

```bash
# Ingest all documents in docs folder
node intelligence/KnowledgeProcessor.js ingest-all

# Ingest a specific PDF
node intelligence/KnowledgeProcessor.js ingest-pdf /path/to/doc.pdf

# Search knowledge base
node intelligence/KnowledgeProcessor.js search "your question"

# View statistics
node intelligence/KnowledgeProcessor.js summary

# Clear everything (DANGER!)
CONFIRM_CLEAR=yes node intelligence/KnowledgeProcessor.js clear
```

---

## 🛡️ How It Prevents Wrong Answers

| Scenario | Without RAG | With RAG |
|----------|-----------|---------|
| **"How do I authenticate?"** | Model guesses common patterns | "Use the API token in the Authorization header as documented in section 3.2" |
| **"What's our data retention policy?"** | Model gives generic advice | "We retain data for 90 days per company policy DOC-2024-01" |
| **"How do I deploy?"** | Model suggests standard approaches | "Follow our deployment checklist in deploy-guide.md steps 1-7" |

---

## 📝 Adding More Documents Later

You can add more documents anytime:

```bash
# Add new document
cp new-guide.pdf intelligence/knowledge/docs/

# Re-ingest everything
node intelligence/KnowledgeProcessor.js ingest-all
```

The system automatically:
- Detects new files
- Processes them
- Updates the knowledge base
- No restart needed!

---

## 🔧 Configuration

Check/edit `intelligence/manifest.json`:

```json
{
  "knowledge_base": {
    "enabled": true,
    "docs_dir": "intelligence/knowledge/docs",
    "chunk_size": 500,
    "chunk_overlap": 100,
    "max_recall_chunks": 5
  },
  "rag": {
    "enable_citations": true,
    "enforce_knowledge_only": false,
    "fallback_on_no_knowledge": true
  }
}
```

**Options explained:**
- `chunk_size: 500` - Size of text chunks (increase for longer contexts)
- `max_recall_chunks: 5` - How many document chunks to use per query
- `enable_citations: true` - Models cite sources ("According to...")
- `enforce_knowledge_only: false` - Allow general answers if no docs found
- `fallback_on_no_knowledge: true` - Can answer without knowledge

---

## ⚠️ Troubleshooting

### ❌ "No documents found"
```bash
# Check that docs exist
ls -la intelligence/knowledge/docs/

# If empty, add some documents:
cp your-doc.pdf intelligence/knowledge/docs/
```

### ❌ "PDF parsing error"
```bash
# Make sure pdf-parse is installed
npm install pdf-parse

# Try again
node intelligence/KnowledgeProcessor.js ingest-all
```

### ❌ "Model still giving generic answers"
```bash
# Check if search works
node intelligence/KnowledgeProcessor.js search "your topic"

# If no results, your documents might not match the question
# Try adding more relevant documentation
```

---

## 🎓 Advanced: Measuring Quality

### Track how often models use your knowledge:

Look for in logs:
```
📚 Retrieved sources: ['api-documentation.pdf', 'architecture-guide.md']
```

This means your knowledge is being used!

### Monitor retrieval quality:
```bash
# Search for a question you expect to find answers for
node intelligence/KnowledgeProcessor.js search "common support question"

# If you see relevant chunks → Good! Documents are helpful
# If no results → Add more relevant documentation
```

---

## ✅ Success Checklist

- [ ] Created `intelligence/knowledge/docs/` folder
- [ ] Added your domain documents (PDFs, markdown, or text)
- [ ] Installed pdf-parse: `npm install pdf-parse`
- [ ] Ran ingestion: `node intelligence/KnowledgeProcessor.js ingest-all`
- [ ] Tested search: `node intelligence/KnowledgeProcessor.js search "test"`
- [ ] Started server: `npm run dev`
- [ ] Asked model a question from your domain
- [ ] Model cited sources from your documents ✅

---

## 🚀 You're Done!

Your models now answer ONLY based on your knowledge base. No more vague or wrong answers!

**What happens next:**
1. Users ask questions
2. System searches your docs
3. Model answers from YOUR knowledge
4. Answers include source citations
5. Perfect accuracy! ✨

---

## 📚 For More Information

- See `RAG_FINE_TUNING_GUIDE.md` for detailed architecture
- See `intelligence/KnowledgeProcessor.js` for implementation details
- Check `IMPLEMENTATION_SUMMARY.md` for previous optimizations
