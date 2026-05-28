#!/usr/bin/env node

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
  ];

  console.log('📁 Creating directories...\n');
  for (const dir of dirs) {
    await fs.ensureDir(dir);
    console.log(`   ✅ ${dir}`);
  }

  // Create example documents
  console.log('\n📝 Creating example documents...\n');

  const exampleAPI = `# API Documentation Example

## User Endpoints

### GET /api/v1/users
Returns a paginated list of all users.

Query Parameters:
- limit (int, default: 20)
- offset (int, default: 0)
- role (string): Filter by user role

Example Response:
\`\`\`
{
  "users": [
    {
      "id": "user_123",
      "name": "John Doe",
      "email": "john@example.com",
      "role": "user"
    }
  ],
  "total": 150,
  "limit": 20
}
\`\`\`
`;

  await fs.writeFile('intelligence/knowledge/docs/api-example.md', exampleAPI);
  console.log('   ✅ api-example.md');

  // Create initialization script
  const initScript = `import { MemoryManager } from './MemoryManager.js';
import { KnowledgeProcessor } from './intelligence/KnowledgeProcessor.js';

async function main() {
  console.log('🚀 Initializing knowledge base...');
  
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

  // Update manifest
  const manifestPath = 'intelligence/manifest.json';
  const manifest = await fs.readJson(manifestPath);
  
  manifest.knowledge_base = {
    enabled: true,
    docs_dir: 'intelligence/knowledge/docs',
    chunk_size: 500,
  };

  await fs.writeJson(manifestPath, manifest, { spaces: 2 });
  console.log('   ✅ Updated manifest.json');

  console.log('\n' + '='.repeat(60));
  console.log('✅ RAG Setup Complete!');
  console.log('='.repeat(60) + '\n');

  console.log('🚀 Quick Start:\n');
  console.log('1. Install PDF support:');
  console.log('   npm install pdf-parse\n');

  console.log('2. Add YOUR documents:');
  console.log('   cp your-api-docs.pdf intelligence/knowledge/docs/');
  console.log('   cp system-guide.md intelligence/knowledge/docs/\n');

  console.log('3. Ingest your documents:');
  console.log('   node intelligence/KnowledgeProcessor.js ingest-all\n');

  console.log('4. Start your server:');
  console.log('   npm run dev\n');

  console.log('✨ Models will now answer ONLY based on your knowledge!\n');
}

setup().catch(console.error);
