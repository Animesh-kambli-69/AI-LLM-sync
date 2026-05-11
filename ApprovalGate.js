/**
 * ApprovalGate.js
 *
 * Human-in-the-loop checkpoint. Before any important action, the system
 * pauses, shows a full preview (diff-style for file changes), and waits
 * for your explicit YES / NO / EDIT decision — exactly like Cursor or
 * GitHub Copilot Workspace.
 *
 * Which actions require approval is controlled in intelligence/manifest.json
 * under `approval.require_approval_for`.
 */

import inquirer from "inquirer";
import chalk from "chalk";
import fs from "fs-extra";
import path from "path";

const MANIFEST_PATH = path.resolve("intelligence", "manifest.json");

// ── Helpers ────────────────────────────────────────────────────

function header(label) {
  const line = "─".repeat(52);
  console.log("\n" + chalk.bold.yellow(`┌${line}┐`));
  console.log(chalk.bold.yellow(`│  🔔  APPROVAL REQUIRED — ${label.padEnd(26)}│`));
  console.log(chalk.bold.yellow(`└${line}┘`));
}

function showDiff(filePath, newContent, existingContent) {
  if (!existingContent) {
    console.log(chalk.dim("  (New file — no previous content)"));
    console.log(chalk.green(newContent.split("\n").map((l) => `  + ${l}`).join("\n")));
    return;
  }

  const oldLines = existingContent.split("\n");
  const newLines = newContent.split("\n");
  const maxLines = Math.max(oldLines.length, newLines.length);

  for (let i = 0; i < Math.min(maxLines, 40); i++) {
    const o = oldLines[i] ?? "";
    const n = newLines[i] ?? "";
    if (o === n) {
      console.log(chalk.dim(`    ${n}`));
    } else {
      if (o) console.log(chalk.red(`  - ${o}`));
      if (n) console.log(chalk.green(`  + ${n}`));
    }
  }
  if (maxLines > 40) {
    console.log(chalk.dim(`  ... (${maxLines - 40} more lines)`));
  }
}

// ── ApprovalGate class ─────────────────────────────────────────

export class ApprovalGate {
  constructor() {
    this.rules = {};
    this.loaded = false;
  }

  async load() {
    const manifest = await fs.readJson(MANIFEST_PATH);
    this.rules = manifest.approval?.require_approval_for ?? {};
    this.loaded = true;
  }

  _needsApproval(actionKey) {
    return this.rules[actionKey] === true;
  }

  // ── Public API ─────────────────────────────────────────────────

  /**
   * Ask the user to approve a file write.
   * Shows a live diff between existing content and proposed content.
   *
   * @returns {'yes'|'no'|'edit'}
   */
  async approveFileWrite(filePath, newContent) {
    if (!this._needsApproval("file_write")) return "yes";

    const abs = path.resolve(filePath);
    const exists = await fs.pathExists(abs);
    const existingContent = exists ? await fs.readFile(abs, "utf-8") : null;
    const action = exists ? "OVERWRITE" : "CREATE";

    header(`FILE ${action}`);
    console.log(chalk.white(`  Path : ${chalk.cyan(abs)}`));
    console.log(chalk.white(`  Lines: ${newContent.split("\n").length}`));
    console.log(chalk.dim("  ─ Diff Preview ─────────────────────────────────"));
    showDiff(filePath, newContent, existingContent);
    console.log(chalk.dim("  ────────────────────────────────────────────────"));

    const { decision } = await inquirer.prompt([
      {
        type: "list",
        name: "decision",
        message: chalk.bold("What would you like to do?"),
        choices: [
          { name: "✅  Yes — apply this change",  value: "yes" },
          { name: "✏️   Edit — I'll modify the content first", value: "edit" },
          { name: "❌  No  — skip this change",   value: "no"  },
        ],
      },
    ]);

    if (decision === "edit") {
      const { edited } = await inquirer.prompt([
        {
          type: "editor",
          name: "edited",
          message: "Edit the content (your default editor will open):",
          default: newContent,
        },
      ]);
      return { decision: "yes", content: edited };
    }

    return { decision, content: newContent };
  }

  /**
   * Ask the user to approve a file deletion.
   * @returns {boolean}
   */
  async approveFileDelete(filePath) {
    if (!this._needsApproval("file_delete")) return true;

    header("FILE DELETE");
    console.log(chalk.red(`  Path: ${path.resolve(filePath)}`));

    const { confirmed } = await inquirer.prompt([
      {
        type: "confirm",
        name: "confirmed",
        message: chalk.bold.red("⚠️  Permanently delete this file?"),
        default: false,
      },
    ]);
    return confirmed;
  }

  /**
   * Show the generated execution plan and let the user approve, edit,
   * or reject it before any work starts.
   *
   * @param {string[]} plan
   * @returns {{ approved: boolean, plan: string[] }}
   */
  async approvePlan(plan) {
    if (!this._needsApproval("plan_change")) return { approved: true, plan };

    header("EXECUTION PLAN");
    console.log(chalk.white("  The Planner agent wants to execute the following steps:\n"));
    plan.forEach((step, i) => {
      console.log(chalk.cyan(`  ${String(i + 1).padStart(2, "0")}. `) + chalk.white(step));
    });
    console.log("");

    const { decision } = await inquirer.prompt([
      {
        type: "list",
        name: "decision",
        message: chalk.bold("Approve this plan?"),
        choices: [
          { name: "✅  Yes — proceed with this plan",     value: "yes"  },
          { name: "✏️   Edit — remove or reorder steps",   value: "edit" },
          { name: "❌  No  — cancel and re-describe task", value: "no"   },
        ],
      },
    ]);

    if (decision === "no")   return { approved: false, plan };

    if (decision === "edit") {
      const checks = plan.map((step, i) => ({ name: step, value: i, checked: true }));
      const { kept } = await inquirer.prompt([
        {
          type: "checkbox",
          name: "kept",
          message: "Uncheck steps you want to REMOVE:",
          choices: checks,
        },
      ]);
      const editedPlan = kept.map((i) => plan[i]);
      console.log(chalk.green(`\n  Plan trimmed to ${editedPlan.length} steps.\n`));
      return { approved: true, plan: editedPlan };
    }

    return { approved: true, plan };
  }

  /**
   * Generic approval prompt for any custom decision.
   * @param {string} label    Short title
   * @param {string} details  Detailed description of what will happen
   * @returns {boolean}
   */
  async approveAction(label, details) {
    header(label);
    console.log(chalk.white("  " + details.split("\n").join("\n  ")));
    console.log("");

    const { confirmed } = await inquirer.prompt([
      {
        type: "confirm",
        name: "confirmed",
        message: chalk.bold("Proceed?"),
        default: true,
      },
    ]);
    return confirmed;
  }
}
