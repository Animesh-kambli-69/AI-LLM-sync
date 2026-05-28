/**
 * KnowledgeProcessor.js
 * 
 * Ingests PDFs, markdown, and text files into ChromaDB for RAG
 * Enables models to answer only based on your specific domain knowledge
 */

import pdf from 'pdf-parse';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const KNOWLEDGE_DIR = path.resolve('intelligence', 'knowledge');
const DOCS_DIR = path.join(KNOWLEDGE_DIR, 'docs');
const INDEX_FILE = path.join(KNOWLEDGE_DIR, 'index.json');

export class KnowledgeProcessor {
  constructor(memory) {
    this.memory = memory;
    this.processedDocs = new Map(); // Track what's been ingested
  }

  /**
   * Initialize knowledge directories
   */
  async init() {
    await fs.ensureDir(DOCS_DIR);
    if (await fs.pathExists(INDEX_FILE)) {
      const index = await fs.readJson(INDEX_FILE);
      this.processedDocs = new Map(Object.entries(index));
    }
  }

  /**
   * Ingest a PDF document into the knowledge base
   * @param {string} filePath - Path to PDF
   * @param {string} docName - Human-readable name (if different from filename)
   * @returns {Promise<number>} - Number of chunks stored
   */
  async ingestPDF(filePath, docName = null) {
    const fileName = path.basename(filePath);
    const name = docName || fileName;
    
    console.log(`\n📄 Processing PDF: ${name}`);
    
    try {
      const dataBuffer = await fs.readFile(filePath);
      const pdfData = await pdf(dataBuffer);
      
      if (!pdfData.text || pdfData.text.trim().length === 0) {
        console.warn(`⚠️  PDF is empty or unreadable: ${name}`);
        return 0;
      }
      
      const chunks = this._chunkText(pdfData.text, 500, 100);
      console.log(`  📊 Extracted ${chunks.length} chunks from ${pdfData.numpages} pages`);
      
      let stored = 0;
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        
        // Store in memory with rich metadata
        await this.memory.remember(chunk, {
          type: 'knowledge',
          source: name,
          filePath: filePath,
          chunkIndex: i,
          totalChunks: chunks.length,
          fileType: 'pdf',
          timestamp: new Date().toISOString(),
        });
        stored++;
      }
      
      console.log(`  ✅ Stored ${stored} chunks`);
      
      // Update index
      this.processedDocs.set(fileName, {
        name,
        type: 'pdf',
        chunks: stored,
        ingested: new Date().toISOString(),
        filePath,
      });
      
      await this._saveIndex();
      return stored;
    } catch (error) {
      console.error(`  ❌ Error processing PDF: ${error.message}`);
      return 0;
    }
  }

  /**
   * Ingest markdown/text file
   */
  async ingestMarkdown(filePath, docName = null) {
    const fileName = path.basename(filePath);
    const name = docName || fileName;
    
    console.log(`\n📝 Processing ${path.extname(filePath)}: ${name}`);
    
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      
      if (!content.trim()) {
        console.warn(`⚠️  File is empty: ${name}`);
        return 0;
      }
      
      const chunks = this._chunkText(content, 500, 100);
      console.log(`  📊 Created ${chunks.length} chunks`);
      
      let stored = 0;
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        
        await this.memory.remember(chunk, {
          type: 'knowledge',
          source: name,
          filePath: filePath,
          chunkIndex: i,
          totalChunks: chunks.length,
          fileType: path.extname(filePath).slice(1),
          timestamp: new Date().toISOString(),
        });
        stored++;
      }
      
      console.log(`  ✅ Stored ${stored} chunks`);
      
      // Update index
      this.processedDocs.set(fileName, {
        name,
        type: path.extname(filePath).slice(1),
        chunks: stored,
        ingested: new Date().toISOString(),
        filePath,
      });
      
      await this._saveIndex();
      return stored;
    } catch (error) {
      console.error(`  ❌ Error processing file: ${error.message}`);
      return 0;
    }
  }

  /**
   * Ingest all documents from knowledge/docs folder
   */
  async ingestAllDocuments() {
    console.log('\n🚀 Starting knowledge base ingestion...\n');
    
    await this.init();
    
    const files = await fs.readdir(DOCS_DIR);
    let totalChunks = 0;
    let processedCount = 0;
    
    const supportedFormats = ['.pdf', '.md', '.markdown', '.txt'];
    const filesToProcess = files.filter(f => 
      supportedFormats.includes(path.extname(f).toLowerCase())
    );
    
    if (filesToProcess.length === 0) {
      console.log(`⚠️  No documents found in ${DOCS_DIR}`);
      console.log(`   Supported formats: ${supportedFormats.join(', ')}`);
      console.log(`   Add files and try again.`);
      return 0;
    }
    
    console.log(`Found ${filesToProcess.length} documents to process:\n`);
    
    for (const file of filesToProcess) {
      const filePath = path.join(DOCS_DIR, file);
      const stat = await fs.stat(filePath);
      
      if (!stat.isFile()) continue;
      
      try {
        const ext = path.extname(file).toLowerCase();
        let chunks = 0;
        
        if (ext === '.pdf') {
          chunks = await this.ingestPDF(filePath);
        } else if (['.md', '.markdown', '.txt'].includes(ext)) {
          chunks = await this.ingestMarkdown(filePath);
        }
        
        if (chunks > 0) {
          totalChunks += chunks;
          processedCount++;
        }
      } catch (error) {
        console.error(`❌ Error ingesting ${file}:`, error.message);
      }
    }
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🎉 Knowledge base ready!`);
    console.log(`   📚 Documents processed: ${processedCount}`);
    console.log(`   📖 Total chunks stored: ${totalChunks}`);
    console.log(`   💾 Index saved to: ${INDEX_FILE}`);
    console.log(`${'='.repeat(60)}\n`);
    
    return totalChunks;
  }

  /**
   * Smart chunking with paragraph-aware splitting
   */
  _chunkText(text, chunkSize = 500, overlap = 100) {
    const chunks = [];
    
    // Clean up text
    let cleanText = text
      .replace(/\n{3,}/g, '\n\n') // Remove excessive newlines
      .trim();
    
    // Split by double newlines (paragraphs)
    const paragraphs = cleanText.split(/\n\n+/);
    
    let currentChunk = '';
    let previousChunk = '';
    
    for (const para of paragraphs) {
      const potentialChunk = currentChunk 
        ? currentChunk + '\n\n' + para 
        : para;
      
      if (potentialChunk.length > chunkSize) {
        // Chunk is full, save current and start new
        if (currentChunk) {
          chunks.push(currentChunk.trim());
          previousChunk = currentChunk;
          
          // Add overlap from previous chunk
          currentChunk = previousChunk.slice(-overlap) + '\n\n' + para;
        } else {
          // Single paragraph is too long, split it
          const words = para.split(/\s+/);
          let wordChunk = '';
          
          for (const word of words) {
            if ((wordChunk + ' ' + word).length > chunkSize) {
              if (wordChunk) {
                chunks.push(wordChunk.trim());
              }
              wordChunk = word;
            } else {
              wordChunk += (wordChunk ? ' ' : '') + word;
            }
          }
          
          if (wordChunk) {
            currentChunk = wordChunk;
          }
        }
      } else {
        currentChunk = potentialChunk;
      }
    }
    
    // Don't forget the last chunk
    if (currentChunk) {
      chunks.push(currentChunk.trim());
    }
    
    // Filter out tiny chunks
    return chunks.filter(c => c.length > 50);
  }

  /**
   * Retrieve relevant knowledge for a query
   */
  async retrieveKnowledge(query, topK = 5) {
    const results = await this.memory.recall(query, topK);
    
    return results
      .filter(r => r.type === 'knowledge')
      .map(r => ({
        text: r.text,
        source: r.source || 'unknown',
        score: r.score || 0.9,
      }));
  }

  /**
   * Search knowledge base with detailed results
   */
  async search(query, topK = 5) {
    console.log(`\n🔍 Searching knowledge base for: "${query}"\n`);
    
    const results = await this.retrieveKnowledge(query, topK);
    
    if (results.length === 0) {
      console.log(`❌ No relevant knowledge found`);
      return { query, results: [] };
    }
    
    console.log(`✅ Found ${results.length} relevant chunks:\n`);
    results.forEach((r, i) => {
      console.log(`${i + 1}. [${r.source}] (relevance: ${(r.score * 100).toFixed(0)}%)`);
      console.log(`   ${r.text.slice(0, 100)}...`);
      console.log();
    });
    
    return { query, results };
  }

  /**
   * Get knowledge summary
   */
  async getSummary() {
    await this.init();
    
    const totalDocs = this.processedDocs.size;
    const totalChunks = Array.from(this.processedDocs.values())
      .reduce((sum, doc) => sum + (doc.chunks || 0), 0);
    
    console.log(`\n📚 Knowledge Base Summary:`);
    console.log(`   Documents: ${totalDocs}`);
    console.log(`   Total chunks: ${totalChunks}`);
    console.log(`\nDocuments:\n`);
    
    let index = 1;
    for (const [fileName, doc] of this.processedDocs.entries()) {
      console.log(`   ${index}. ${doc.name}`);
      console.log(`      Type: ${doc.type}`);
      console.log(`      Chunks: ${doc.chunks}`);
      console.log(`      Ingested: ${new Date(doc.ingested).toLocaleDateString()}`);
      index++;
    }
    
    console.log();
    return { totalDocs, totalChunks };
  }

  /**
   * Clear all knowledge (dangerous!)
   */
  async clearKnowledge() {
    console.log(`⚠️  Clearing all ingested knowledge...`);
    this.processedDocs.clear();
    await this._saveIndex();
    console.log(`✅ Knowledge base cleared`);
  }

  /**
   * Save processing index
   */
  async _saveIndex() {
    const indexData = Object.fromEntries(this.processedDocs);
    await fs.writeJson(INDEX_FILE, indexData, { spaces: 2 });
  }
}

// CLI Interface
if (import.meta.url === `file://${process.argv[1]}`) {
  const { MemoryManager } = await import('./MemoryManager.js');
  
  const args = process.argv.slice(2);
  const command = args[0];
  
  const memory = new MemoryManager();
  await memory.init();
  const processor = new KnowledgeProcessor(memory);
  
  try {
    switch (command) {
      case 'ingest-all':
      case 'ingest':
        await processor.ingestAllDocuments();
        break;
        
      case 'ingest-pdf':
        if (!args[1]) {
          console.error('Usage: node KnowledgeProcessor.js ingest-pdf <filepath> [name]');
          process.exit(1);
        }
        await processor.ingestPDF(args[1], args[2]);
        break;
        
      case 'search':
        if (!args[1]) {
          console.error('Usage: node KnowledgeProcessor.js search <query>');
          process.exit(1);
        }
        await processor.search(args.slice(1).join(' '));
        break;
        
      case 'summary':
        await processor.getSummary();
        break;
        
      case 'clear':
        if (process.env.CONFIRM_CLEAR !== 'yes') {
          console.error('⚠️  This will delete all knowledge. Run with CONFIRM_CLEAR=yes to proceed.');
          process.exit(1);
        }
        await processor.clearKnowledge();
        break;
        
      default:
        console.log(`
KnowledgeProcessor CLI

Usage:
  node KnowledgeProcessor.js ingest-all        Ingest all docs from docs/ folder
  node KnowledgeProcessor.js ingest-pdf <path> Ingest a specific PDF
  node KnowledgeProcessor.js search <query>    Search the knowledge base
  node KnowledgeProcessor.js summary           Show knowledge base stats
  node KnowledgeProcessor.js clear             Clear all knowledge (DANGER!)
        `);
    }
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

export default KnowledgeProcessor;
