import { Conductor } from "./Conductor.js";
import inquirer from "inquirer";
import chalk from "chalk";

async function main() {
  console.clear();
  console.log(chalk.bold.magenta(`
   ⚡ CONDUCTOR AI ⚡
   Local Multi-Agent Orchestration
  `));

  const conductor = new Conductor();

  const answers = await inquirer.prompt([
    {
      type: "input",
      name: "task",
      message: "What coding task should I handle today?",
      validate: (val) => val.length > 0 || "Please describe a task."
    }
  ]);

  try {
    await conductor.run(answers.task);
  } catch (error) {
    console.error(chalk.red("\nOrchestration failed:"), error.message);
    if (error.message.includes("fetch failed")) {
      console.log(chalk.yellow("Hint: Is Ollama running? Try 'ollama serve'"));
    }
  }
}

main();
