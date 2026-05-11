/**
 * FileSystemManager.js
 *
 * All file operations for agents. Every read and write is:
 *   1. Checked against the SandboxManager (path allowlist)
 *   2. Routed through the ApprovalGate (human confirmation)
 *
 * Agents physically cannot touch anything outside what you declared.
 */

import fs from "fs-extra";
import path from "path";
import { glob } from "glob";
import { SandboxManager } from "./SandboxManager.js";
import { ApprovalGate } from "./ApprovalGate.js";

const IGNORE_GLOBS = [
  "**/node_modules/**",
  "**/.git/**",
  "**/intelligence/**",
  "**/.vscode/**",
  "**/.idea/**",
  "**/.cache/**",
  "**/coverage/**",
  "**/logs/**",
  "**/tmp/**",
  "**/.next/**",
  "**/dist/**",
  "**/build/**",
  "**/target/**",
  "**/out/**",
  "**/*.zip",
  "**/*.jar",
  "**/*.exe",
  "**/*.dll",
  "**/*.class",
  "**/*.log",
  "**/*.map",
];

const IGNORE_SEGMENTS = [
  "node_modules",
  ".git",
  "intelligence",
  ".vscode",
  ".idea",
  ".cache",
  "coverage",
  "logs",
  "tmp",
  ".next",
  "dist",
  "build",
  "target",
  "out",
];

const IGNORE_EXTENSIONS = [
  ".zip",
  ".jar",
  ".exe",
  ".dll",
  ".class",
  ".log",
  ".map",
];

export class FileSystemManager {
  static isIgnoredPath(filePath) {
    const normalized = path.normalize(filePath).replace(/\\/g, "/");
    if (IGNORE_SEGMENTS.some((segment) => normalized.includes(`/${segment}/`))) return true;
    return IGNORE_EXTENSIONS.some((ext) => normalized.endsWith(ext));
  }
  /**
   * @param {SandboxManager} sandbox  shared sandbox instance
   * @param {ApprovalGate}   gate     shared approval gate instance
   * @param {string}         baseDir  default scan root
   */
  constructor(sandbox, gate, baseDir = process.cwd()) {
    this.sandbox = sandbox;
    this.gate    = gate;
    this.baseDir = baseDir;
  }

  // ── Listing ───────────────────────────────────────────────────

  /**
   * List files — only from paths inside the sandbox.
   */
  async listFiles(pattern = "**/*") {
    const allFiles = [];
    const roots = this.sandbox.getAllowedPaths();
    
    for (const root of roots) {
      const files = await glob(pattern, {
        cwd: root,
        ignore: IGNORE_GLOBS,
        nodir: true,
      });
      files.forEach((f) => allFiles.push({ rel: f, abs: path.join(root, f), root }));
    }

    return allFiles;
  }

  // ── Reading ───────────────────────────────────────────────────

  /**
   * Read a file. Enforces sandbox read access.
   * @param {string} filePath  absolute or relative path
   */
  async readFile(filePath) {
    const abs = path.resolve(filePath);
    this.sandbox.assertAccess(abs, "read");
    if (FileSystemManager.isIgnoredPath(abs)) {
      throw new Error("Read blocked for ignored path.");
    }
    return fs.readFile(abs, "utf-8");
  }

  // ── Writing ───────────────────────────────────────────────────

  /**
   * Write a file. Enforces sandbox write access AND asks for approval.
   * If the user edits the content in the approval prompt, the edited
   * version is written instead of the AI-generated one.
   *
   * @param {string} filePath  absolute or relative path
   * @param {string} content   proposed content
   * @returns {boolean}        true if written, false if user declined
   */
  async writeFile(filePath, content) {
    const abs = path.resolve(filePath);

    // 1. Sandbox check — hard block if outside allowed paths
    this.sandbox.assertAccess(abs, "write");

    // 2. Approval gate — show diff and ask user
    const result = await this.gate.approveFileWrite(abs, content);

    if (result.decision === "no") {
      console.log(`  ↩  Skipped: ${abs}`);
      return false;
    }

    const finalContent = result.content ?? content;
    await fs.ensureDir(path.dirname(abs));
    await fs.writeFile(abs, finalContent, "utf-8");
    console.log(`  ✅ Written: ${abs}`);
    return true;
  }

  /**
   * Delete a file. Enforces sandbox write access AND asks for approval.
   * @param {string} filePath
   * @returns {boolean}
   */
  async deleteFile(filePath) {
    const abs = path.resolve(filePath);
    this.sandbox.assertAccess(abs, "delete");

    const confirmed = await this.gate.approveFileDelete(abs);
    if (!confirmed) {
      console.log(`  ↩  Delete cancelled: ${abs}`);
      return false;
    }

    await fs.remove(abs);
    console.log(`  🗑  Deleted: ${abs}`);
    return true;
  }

  // ── Context snapshot ──────────────────────────────────────────

  /**
   * Build a human/AI-readable summary of all files in the sandbox.
   */
  async getProjectContext() {
    const files = await this.listFiles();

    if (files.length === 0) {
      return "No workspace paths declared yet. Use the startup wizard to add folders.";
    }

    let ctx = "Declared Workspace Files:\n";
    let currentRoot = null;
    let count = 0;
    
    for (const { rel, root } of files) {
      if (count >= 300) {
        ctx += `\n  ... and ${files.length - 300} more files omitted to save context space.\n`;
        break;
      }
      if (root !== currentRoot) {
        ctx += `\n📁 ${root}\n`;
        currentRoot = root;
      }
      ctx += `  - ${rel}\n`;
      count++;
    }
    return ctx;
  }
}
