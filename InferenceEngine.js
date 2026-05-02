import { ChatOllama } from "@langchain/ollama";

export class InferenceEngine {
  constructor(defaultModel = "llama3.1:8b") {
    this.defaultModel = defaultModel;
    this.models = new Map();
  }

  getModel(modelName) {
    const name = modelName || this.defaultModel;
    if (!this.models.has(name)) {
      this.models.set(name, new ChatOllama({
        baseUrl: "http://localhost:11434",
        model: name,
        temperature: 0.1,
      }));
    }
    return this.models.get(name);
  }

  /**
   * Invoke a specific model for a task
   * @param {string} prompt 
   * @param {string} modelName 
   */
  async ask(prompt, modelName) {
    const model = this.getModel(modelName);
    const response = await model.invoke(prompt);
    return response.content;
  }

  /**
   * Specialized method for structured planning
   */
  async plan(taskDescription, context) {
    const prompt = `You are a Lead AI Architect. 
    Task: ${taskDescription}
    Context: ${context}
    
    Break this task into small, executable steps for coding agents. 
    Output as a JSON array of sub-tasks.`;
    
    return await this.ask(prompt, "llama3.1:8b");
  }
}
