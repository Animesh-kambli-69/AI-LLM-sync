import { ChromaClient } from "chromadb";

export class MemoryManager {
  constructor() {
    this.client = new ChromaClient();
    this.collection = null;
  }

  async init() {
    try {
      this.collection = await this.client.getOrCreateCollection({
        name: "conductor_memory",
      });
      console.log("Memory initialized: ChromaDB collection 'conductor_memory' ready.");
    } catch (error) {
      console.error("Failed to connect to ChromaDB. Ensure Chroma is running.");
      // Fallback or handle error
    }
  }

  async remember(snippet, metadata = {}) {
    if (!this.collection) return;
    
    await this.collection.add({
      ids: [Date.now().toString()],
      metadatas: [metadata],
      documents: [snippet],
    });
  }

  async recall(query, limit = 5) {
    if (!this.collection) return [];
    
    const results = await this.collection.query({
      queryTexts: [query],
      nResults: limit,
    });
    return results.documents[0];
  }
}
