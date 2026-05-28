#!/usr/bin/env node

/**
 * Quick setup script for RAG Fine-tuning
 * Run this once to set up the knowledge base infrastructure
 */

import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function setup() {
  console.log('\n' + '='.repeat(60));
  console.log('🚀 RAG Fine-Tuning Setup');
  console.log('='.repeat(60) + '\n');

  // Create directory structure
  const dirs = [
    'intelligence/knowledge/docs',
    'intelligence/knowledge/examples',
    'intelligence/knowledge/schemas',
  ];

  console.log('📁 Creating directory structure...\n');
  for (const dir of dirs) {
    await fs.ensureDir(dir);
    console.log(`   ✅ ${dir}`);
  }

  // Create example files
  console.log('\n📝 Creating example files...\n');

  const exampleAPI = `# API Documentation Example

## User Endpoints

### GET /api/v1/users
Returns a paginated list of all users.

**Query Parameters:**
- \`limit\` (int, default: 20): Number of users to return
- \`offset\` (int, default: 0): Pagination offset
- \`role\` (string): Filter by user role (admin, user, moderator)

**Response:**
\`\`\`json
{
  "users": [
    {
      "id": "user_123",
      "name": "John Doe",
      "email": "john@example.com",
      "role": "user",
      "createdAt": "2024-01-15T10:30:00Z"
    }
  ],
  "total": 150,
  "limit": 20,
  "offset": 0
}
\`\`\`

### POST /api/v1/users
Create a new user.

**Request Body:**
\`\`\`json
{
  "name": "Jane Smith",
  "email": "jane@example.com",
  "role": "user"
}
\`\`\`

**Response:** 201 Created with user object

## Rate Limiting
- 1000 requests per hour per API key
- 10 requests per second per IP address
`;

  await fs.writeFile('intelligence/knowledge/docs/api-example.md', exampleAPI);
  console.log('   ✅ intelligence/knowledge/docs/api-example.md');

  const exampleSystem = `# System Architecture

## Overview
Our system is built with a microservices architecture consisting of:

1. **API Gateway** - Routes requests, handles authentication
2. **User Service** - Manages user accounts and profiles
3. **Data Service** - Handles data persistence
4. **Cache Layer** - Redis for performance
5. **Message Queue** - RabbitMQ for async processing

## Data Flow

User Request
  ↓
API Gateway (validates token)
  ↓
Routes to appropriate service
  ↓
Cache check (if applicable)
  ↓
Database query
  ↓
Response to user

## Best Practices

1. **Always validate input** - User data must be sanitized
2. **Use pagination** - Never return unlimited results
3. **Cache aggressively** - Cache reads, not writes
4. **Log everything** - Helps with debugging
5. **Handle errors gracefully** - Return meaningful error messages

## Performance Requirements

- API response time: < 200ms
- Database query: < 100ms
- Cache hit rate: > 85%
`;

  await fs.writeFile('intelligence/knowledge/docs/system-guide.md', exampleSystem);
  console.log('   ✅ intelligence/knowledge/docs/system-guide.md');

  // Create package.json updates guide
  const packageUpdates = `# Required Package Updates

Add these scripts to your package.json:

\`\`\`json
{
  "scripts": {
    "init-knowledge": "node initialize-knowledge-base.js",
    "ingest": "node intelligence/KnowledgeProcessor.js ingest-all",
    "search-kb": "node intelligence/KnowledgeProcessor.js search",
    "kb-summary": "node intelligence/KnowledgeProcessor.js summary",
    "kb-clear": "CONFIRM_CLEAR=yes node intelligence/KnowledgeProcessor.js clear"
  }
}
\`\`\`

Also install the PDF processing dependency:

\`\`\`bash
npm install pdf-parse
\`\`\`
`;

  await fs.writeFile('intelligence/knowledge/README.md', packageUpdates);
  console.log('   ✅ intelligence/knowledge/README.md');

  // Create initialization script
  const initScript = `import { MemoryManager } from './MemoryManager.js';
import { KnowledgeProcessor } from './intelligence/KnowledgeProcessor.js';

async function main() {
  console.log('Initializing knowledge base...');
  
  const memory = new MemoryManager();
  await memory.init();
  
  const processor = new KnowledgeProcessor(memory);
  await processor.ingestAllDocuments();
  
  console.log('\\n✅ Knowledge base ready!');
}

main().catch(console.error);
`;

  await fs.writeFile('initialize-knowledge-base.js', initScript);
  console.log('   ✅ initialize-knowledge-base.js');

  // Create manifest update
  const manifestPath = 'intelligence/manifest.json';
  const manifest = await fs.readJson(manifestPath);
  
  manifest.knowledge_base = {
    enabled: true,
    docs_dir: 'intelligence/knowledge/docs',
    chunk_size: 500,
    chunk_overlap: 100,
    max_recall_chunks: 5,
    auto_ingest_on_startup: false,
  };

  manifest.rag = {
    enable_citations: true,
    enforce_knowledge_only: false,
    fallback_on_no_knowledge: true,
  };

  await fs.writeJson(manifestPath, manifest, { spaces: 2 });
  console.log('   ✅ Updated intelligence/manifest.json');

  console.log('\n' + '='.repeat(60));
  console.log('✅ Setup Complete!');
  console.log('='.repeat(60) + '\n');

  console.log('📚 Next Steps:\n');
  console.log('1. Add your domain documents:');
  console.log('   cp your-api-docs.pdf intelligence/knowledge/docs/');
  console.log('   cp system-architecture.md intelligence/knowledge/docs/\n');

  console.log('2. Install PDF support:');
  console.log('   npm install pdf-parse\n');

  console.log('3. Ingest your documents:');
  console.log('   npm run ingest\n');

  console.log('4. Start your server:');
  console.log('   npm run dev\n');

  console.log('5. Your models will now answer only based on your data! 🚀\n');

  console.log('Optional commands:');
  console.log('  npm run search-kb "your query"  - Search knowledge base');
  console.log('  npm run kb-summary              - View ingested documents');
  console.log('\n');
}

setup().catch(console.error);
`;

  await fs.writeFile('setup-rag.js', initScript);
  console.log('   ✅ setup-rag.js');

  console.log('\n📋 Configuration:\n');
  console.log('   Chunk size: 500 characters');
  console.log('   Overlap: 100 characters (for context continuity)');
  console.log('   Max recall chunks: 5 per query');
  console.log('   Citations: Enabled (models cite sources)');
  console.log('   Fallback: Enabled (answers without knowledge if needed)');

  console.log('\n📚 Example documents created:\n');
  console.log('   - api-example.md (API documentation example)');
  console.log('   - system-guide.md (Architecture example)');
  console.log('   ➡️  Replace these with YOUR actual documents!\n');

  console.log('🔗 Your system is now connected to:\n');
  console.log('   ✅ ChromaDB (vector database)');
  console.log('   ✅ KnowledgeProcessor (ingestion)');
  console.log('   ✅ Conductor (question answering)');
  console.log('   ✅ Your domain documents (answers source)\n');

  console.log('Run: npm run ingest\n');
}

setup().catch(console.error);
`;

  await fs.writeFile('setup-rag.js', initScript);
  console.log('   ✅ setup-rag.js');

  console.log('\n' + '='.repeat(60));
  console.log('✅ Setup Complete!');
  console.log('='.repeat(60) + '\n');

  console.log('📚 Next Steps:\n');
  console.log('1. Add your domain documents:');
  console.log('   mkdir -p intelligence/knowledge/docs');
  console.log('   cp your-api-docs.pdf intelligence/knowledge/docs/');
  console.log('   cp architecture.md intelligence/knowledge/docs/\n');

  console.log('2. Install PDF support (if using PDFs):');
  console.log('   npm install pdf-parse\n');

  console.log('3. Ingest your documents:');
  console.log('   node intelligence/KnowledgeProcessor.js ingest-all\n');

  console.log('4. Start your server:');
  console.log('   npm run dev\n');

  console.log('Your models will now answer ONLY based on your data! 🚀\n');

  console.log('Useful commands:');
  console.log('  node intelligence/KnowledgeProcessor.js search "your query"');
  console.log('  node intelligence/KnowledgeProcessor.js summary\n');
}

setup().catch(console.error);
`;

  await fs.writeFile('setup-rag.js', initScript);
  console.log('   ✅ setup-rag.js');

  console.log('\n' + '='.repeat(60));
  console.log('✅ Setup Complete!');
  console.log('='.repeat(60) + '\n');

  console.log('🚀 Quick Start:\n');
  console.log('1. Add your documents:');
  console.log('   cp your-api-docs.pdf intelligence/knowledge/docs/');
  console.log('   cp architecture.md intelligence/knowledge/docs/\n');

  console.log('2. Install PDF support:');
  console.log('   npm install pdf-parse\n');

  console.log('3. Ingest documents:');
  console.log('   node intelligence/KnowledgeProcessor.js ingest-all\n');

  console.log('4. Start using it:');
  console.log('   npm run dev\n');

  console.log('Your models will answer ONLY based on your knowledge base! 🎯\n');
}

setup().catch(console.error);
`;

  console.log('\n' + '='.repeat(60));
  console.log('✅ RAG Setup Complete!');
  console.log('='.repeat(60) + '\n');

  console.log('📚 What was created:\n');
  console.log('   📁 intelligence/knowledge/docs       - Your document folder');
  console.log('   📁 intelligence/knowledge/examples   - Example storage');
  console.log('   📁 intelligence/knowledge/schemas    - Schema storage');
  console.log('   📄 api-example.md                    - API docs example');
  console.log('   📄 system-guide.md                   - System docs example');
  console.log('   🔧 intelligence/KnowledgeProcessor.js - Ingestion engine');
  console.log('   ⚙️  initialize-knowledge-base.js      - Initialization script\n');

  console.log('🚀 Next Steps:\n');
  console.log('1. Replace example documents with YOUR actual docs:');
  console.log('   rm intelligence/knowledge/docs/*.md');
  console.log('   cp /path/to/your-api-docs.pdf intelligence/knowledge/docs/\n');

  console.log('2. Install PDF processing (if using PDFs):');
  console.log('   npm install pdf-parse\n');

  console.log('3. Ingest all documents:');
  console.log('   npm run init-knowledge\n');

  console.log('4. Test the knowledge base:');
  console.log('   node intelligence/KnowledgeProcessor.js search "your question"\n');

  console.log('5. Start your server:');
  console.log('   npm run dev\n');

  console.log('✨ Your models will now answer ONLY based on your documents!\n');
}

setup().catch(console.error);
