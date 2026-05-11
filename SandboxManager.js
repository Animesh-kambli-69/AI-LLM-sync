/**
 * SandboxManager.js
 *
 * Enforces a strict path allowlist. Agents can ONLY access files and folders
 * that the user has explicitly declared in intelligence/manifest.json.
 *
 * Any attempt to read/write outside the declared paths throws an error
 * and logs an ACCESS DENIED event — the operation is completely blocked.
 */

import path from "path";
import fs from "fs-extra";
import chalk from "chalk";

const MANIFEST_PATH = path.resolve("intelligence", "manifest.json");

export class SandboxManager {
  constructor() {
    this.allowedPaths = [];  // resolved absolute paths
    this.allowReadsOutside = false;
    this.loaded = false;
  }

  // ── Boot ──────────────────────────────────────────────────────

  async load() {
    const manifest = await fs.readJson(MANIFEST_PATH);
    const raw = manifest.sandbox?.allowed_paths ?? [];
    this.allowReadsOutside = manifest.sandbox?.allow_reads_outside_sandbox ?? false;

    // Resolve all paths to absolute
    this.allowedPaths = raw.map((p) => path.resolve(p));
    this.loaded = true;
  }

  /**
   * Register a new path in the allowlist and persist it to manifest.json.
   * Called at startup when the user declares their workspaces.
   * @param {string} rawPath
   */
  async addAllowedPath(rawPath) {
    await this.load();
    const abs = path.resolve(rawPath);

    if (this.allowedPaths.includes(abs)) return; // already allowed

    this.allowedPaths.push(abs);

    const manifest = await fs.readJson(MANIFEST_PATH);
    manifest.sandbox.allowed_paths = this.allowedPaths.map((p) =>
      p.replace(/\\/g, "/")   // store with forward slashes for portability
    );
    await fs.writeJson(MANIFEST_PATH, manifest, { spaces: 2 });
    console.log(chalk.dim(`  [Sandbox] Allowed: ${abs}`));
  }

  /** Return the current list of allowed paths (human-readable) */
  getAllowedPaths() {
    return this.allowedPaths;
  }

  async removeAllowedPath(rawPath) {
    await this.load();
    const abs = path.resolve(rawPath);
    
    if (!this.allowedPaths.includes(abs)) return;
    
    this.allowedPaths = this.allowedPaths.filter(p => p !== abs);
    
    const manifest = await fs.readJson(MANIFEST_PATH);
    manifest.sandbox.allowed_paths = this.allowedPaths.map((p) =>
      p.replace(/\\/g, "/")
    );
    await fs.writeJson(MANIFEST_PATH, manifest, { spaces: 2 });
    console.log(chalk.dim(`  [Sandbox] Removed: ${abs}`));
  }

  // ── Core check ────────────────────────────────────────────────

  /**
   * Throws if the given path is not inside any declared allowed path.
   * @param {string} targetPath   absolute or relative path to check
   * @param {'read'|'write'|'delete'} mode
   */
  assertAccess(targetPath, mode = "write") {
    if (!this.loaded) {
      throw new Error("[Sandbox] SandboxManager not loaded. Call .load() first.");
    }

    const abs = path.resolve(targetPath);

    // Writes always require explicit allowance
    const inSandbox = this.allowedPaths.some((allowed) =>
      abs.startsWith(allowed + path.sep) || abs === allowed
    );

    if (inSandbox) return; // ✅ allowed

    // Reads may be allowed outside (configurable)
    if (mode === "read" && this.allowReadsOutside) return;

    const msg =
      `\n  ╔══════════════════════════════════════════╗\n` +
      `  ║  🚫  ACCESS DENIED  [${mode.toUpperCase()}]               ║\n` +
      `  ║  Path: ${abs.slice(0, 40).padEnd(40)}  ║\n` +
      `  ║  Not in your declared workspace list.   ║\n` +
      `  ╚══════════════════════════════════════════╝`;

    console.error(chalk.red(msg));
    throw new Error(`[Sandbox] ${mode.toUpperCase()} DENIED: "${abs}" is outside the declared workspace.`);
  }

  /**
   * Check without throwing — useful for listing/filtering.
   */
  isAllowed(targetPath, mode = "write") {
    try {
      this.assertAccess(targetPath, mode);
      return true;
    } catch {
      return false;
    }
  }

  /** Filter a list of paths, keeping only those inside the sandbox */
  filterAllowed(paths, mode = "read") {
    return paths.filter((p) => this.isAllowed(p, mode));
  }
}
