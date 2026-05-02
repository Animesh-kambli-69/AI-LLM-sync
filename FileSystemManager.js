import fs from 'fs-extra';
import path from 'path';
import { glob } from 'glob';

export class FileSystemManager {
  constructor(baseDir = process.cwd()) {
    this.baseDir = baseDir;
  }

  async listFiles(pattern = '**/*') {
    return await glob(pattern, { 
      cwd: this.baseDir, 
      ignore: ['node_modules/**', '.git/**', 'venv/**', 'web/**'] 
    });
  }

  async readFile(filePath) {
    const fullPath = path.join(this.baseDir, filePath);
    return await fs.readFile(fullPath, 'utf-8');
  }

  async writeFile(filePath, content) {
    const fullPath = path.join(this.baseDir, filePath);
    await fs.ensureDir(path.dirname(fullPath));
    await fs.writeFile(fullPath, content);
    return true;
  }

  async getProjectContext() {
    const files = await this.listFiles();
    let context = "Project File Structure:\n";
    files.forEach(f => context += `- ${f}\n`);
    return context;
  }
}
