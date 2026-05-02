import { StateGraph, START, END } from "@langchain/langgraph";
import { InferenceEngine } from "./InferenceEngine.js";
import { FileSystemManager } from "./FileSystemManager.js";
import { MemoryManager } from "./MemoryManager.js";
import chalk from "chalk";
import ora from "ora";

// Define the state structure
const StateAnnotation = {
  task: "",
  plan: [],
  currentStep: 0,
  code: "",
  review: "",
  errors: [],
  history: []
};

export class Conductor {
  constructor() {
    this.engine = new InferenceEngine();
    this.fs = new FileSystemManager();
    this.memory = new MemoryManager();
    this.graph = this.createGraph();
  }

  createGraph() {
    const workflow = new StateGraph({
        channels: StateAnnotation
    });

    // 1. Planner Node
    workflow.addNode("planner", async (state) => {
      const spinner = ora(chalk.blue("Planning tasks...")).start();
      const context = await this.fs.getProjectContext();
      const planRaw = await this.engine.plan(state.task, context);
      
      // Basic JSON cleaning if needed
      const plan = JSON.parse(planRaw.match(/\[.*\]/s)[0]);
      spinner.succeed(chalk.green("Plan created with " + plan.length + " steps."));
      return { plan, currentStep: 0 };
    });

    // 2. Worker Node
    workflow.addNode("worker", async (state) => {
      const step = state.plan[state.currentStep];
      const spinner = ora(chalk.yellow(`Executing: ${step}`)).start();
      
      const prompt = `Task Step: ${step}
      Current Code Base Context: ${state.code || "Starting from scratch"}
      Write the necessary code to fulfill this step. Output ONLY the code.`;
      
      const newCode = await this.engine.ask(prompt, "qwen2.5-coder:7b");
      spinner.succeed(chalk.green(`Finished: ${step}`));
      return { code: (state.code || "") + "\n" + newCode };
    });

    // 3. Critic Node
    workflow.addNode("critic", async (state) => {
      const spinner = ora(chalk.red("Reviewing code for bugs...")).start();
      
      const prompt = `Review this code for bugs, smells, or logic errors:
      ${state.code}
      
      If it's perfect, say 'APPROVED'. Otherwise, list the issues.`;
      
      const review = await this.engine.ask(prompt, "qwen2.5-coder:7b");
      
      if (review.includes("APPROVED")) {
        spinner.succeed(chalk.green("Code approved!"));
        return { review: "APPROVED", errors: [] };
      } else {
        spinner.fail(chalk.red("Issues found."));
        return { review, errors: [review] };
      }
    });

    // Define edges
    workflow.addEdge(START, "planner");
    workflow.addEdge("planner", "worker");
    workflow.addEdge("worker", "critic");

    // Conditional routing for the feedback loop
    workflow.addConditionalEdges("critic", (state) => {
      if (state.review === "APPROVED") {
        if (state.currentStep < state.plan.length - 1) {
          state.currentStep++;
          return "worker";
        }
        return END;
      }
      return "worker"; // Loop back to fix issues
    });

    return workflow.compile();
  }

  async run(task) {
    console.log(chalk.bold.cyan("\n--- Conductor AI: Local Orchestration Start ---"));
    await this.memory.init();
    
    const initialState = {
      task,
      plan: [],
      currentStep: 0,
      code: "",
      review: "",
      errors: [],
      history: []
    };

    const finalState = await this.graph.invoke(initialState);
    
    console.log(chalk.bold.green("\n--- Task Complete ---"));
    console.log(chalk.white(finalState.code));
    
    // Save to file or return
    await this.fs.writeFile("output.js", finalState.code);
    console.log(chalk.dim("\nResult saved to output.js"));
  }
}
