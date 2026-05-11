/**
 * index.js — Conductor AI Startup Wizard
 *
 * Boots the shared intelligence layer, runs the workspace declaration
 * wizard (asks you which folders the agents are allowed to touch),
 * then launches the interactive task loop.
 */

import { Conductor }      from "./Conductor.js";
import { MemoryManager }  from "./MemoryManager.js";
import { SandboxManager } from "./SandboxManager.js";
import { ApprovalGate }   from "./ApprovalGate.js";
import inquirer from "inquirer";
import chalk    from "chalk";
import fs       from "fs-extra";
import path     from "path";

// ── Banner ─────────────────────────────────────────────────────

function printBanner() {
  console.clear();
  console.log(chalk.bold.magenta(`
  ╔═══════════════════════════════════════════╗
  ║                                           ║
  ║   ⚡  CONDUCTOR AI  ⚡                    ║
  ║   Local Multi-Agent Orchestration         ║
  ║                                           ║
  ║   Sandbox  ✔  |  Shared Memory  ✔         ║
  ║   Human-in-the-loop Approval  ✔           ║
  ║                                           ║
  ╚═══════════════════════════════════════════╝
  `));
}

// ── Workspace declaration wizard ───────────────────────────────

async function runWorkspaceWizard(sandbox) {
  await sandbox.load();

  const existing = sandbox.getAllowedPaths();
  if (existing.length > 0) {
    console.log(chalk.green("\n  Declared workspace paths:"));
    existing.forEach((p) => console.log(chalk.cyan(`    • ${p}`)));

    const { addMore } = await inquirer.prompt([
      {
        type: "confirm",
        name: "addMore",
        message: "Add or change workspace paths?",
        default: false,
      },
    ]);
    if (!addMore) return;
  } else {
    console.log(chalk.yellow("\n  No workspace paths declared yet."));
    console.log(chalk.dim("  Agents can only read and write inside the paths you declare here.\n"));
  }

  // Let user declare as many paths as they want
  let addingPaths = true;
  while (addingPaths) {
    const { workspacePath } = await inquirer.prompt([
      {
        type: "input",
        name: "workspacePath",
        message: "Enter a folder path for agents to access (absolute path):",
        validate: async (val) => {
          if (!val.trim()) return "Path cannot be empty.";
          const exists = await fs.pathExists(val.trim());
          return exists || `Path does not exist: ${val.trim()}`;
        },
      },
    ]);

    await sandbox.addAllowedPath(workspacePath.trim());

    const { more } = await inquirer.prompt([
      {
        type: "confirm",
        name: "more",
        message: "Add another folder?",
        default: false,
      },
    ]);
    addingPaths = more;
  }

  console.log(chalk.green("\n  ✅ Workspace locked in.\n"));
}

// ── Main loop ──────────────────────────────────────────────────

async function main() {
  printBanner();

  // Boot shared singletons — one of each, used by ALL agents
  const memory  = new MemoryManager();
  const sandbox = new SandboxManager();
  const gate    = new ApprovalGate();

  // 1. Let user declare which folders agents can access
  await runWorkspaceWizard(sandbox);

  // 2. Load approval rules from manifest.json
  await gate.load();

  // 3. Show current approval settings
  console.log(chalk.dim("  Approval rules (from intelligence/manifest.json):"));
  const manifestPath = path.resolve("intelligence", "manifest.json");
  const manifest = await fs.readJson(manifestPath);
  const rules = manifest.approval?.require_approval_for ?? {};
  Object.entries(rules).forEach(([k, v]) => {
    const icon = v ? chalk.green("✔") : chalk.gray("✗");
    console.log(chalk.dim(`    ${icon}  ${k}`));
  });
  console.log("");

  // 4. Build conductor with all shared services wired in
  const conductor = new Conductor(memory, sandbox, gate);

  // 5. Task loop — keep asking for tasks until user quits
  let running = true;
  while (running) {
    const { task } = await inquirer.prompt([
      {
        type: "input",
        name: "task",
        message: chalk.bold.cyan("🎯 What coding task should I handle?") + chalk.dim(" (type 'exit' to quit)"),
        validate: (val) => val.trim().length > 0 || "Please describe a task.",
      },
    ]);

    if (task.trim().toLowerCase() === "exit") {
      running = false;
      console.log(chalk.bold.magenta("\n  Goodbye. Intelligence saved. See you next time! 👋\n"));
      break;
    }

    try {
      await conductor.run(task.trim());
    } catch (error) {
      console.error(chalk.red("\n  Orchestration error:"), error.message);

      if (error.message.includes("fetch failed") || error.message.includes("ECONNREFUSED")) {
        console.log(chalk.yellow("  Hint: Is Ollama running? Try: ollama serve"));
      }
      if (error.message.includes("DENIED")) {
        console.log(chalk.yellow("  Hint: Add that folder to your workspace paths next time."));
      }
    }

    const { another } = await inquirer.prompt([
      {
        type: "confirm",
        name: "another",
        message: "Run another task?",
        default: true,
      },
    ]);
    running = another;
  }
}

main();
