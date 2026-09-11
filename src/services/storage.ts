import fs from "node:fs";
import path from "node:path";
import mime from "mime-types";
import { config } from "../config.js";

export interface FilePayload {
  path: string;
  content: string; // raw string or base64
  encoding?: "utf-8" | "base64";
}

export class StorageService {
  private baseDir: string;

  constructor() {
    this.baseDir = config.storageDir;
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  getDeploymentDir(deploymentId: string): string {
    return path.join(this.baseDir, deploymentId);
  }

  saveFiles(deploymentId: string, files: FilePayload[]): { fileCount: number; sizeBytes: number; entrypoint: string } {
    const deployDir = this.getDeploymentDir(deploymentId);
    if (!fs.existsSync(deployDir)) {
      fs.mkdirSync(deployDir, { recursive: true });
    }

    let totalSize = 0;
    let entrypoint = "index.html";

    for (const file of files) {
      // Path traversal security check
      const normalizedPath = path.normalize(file.path).replace(/^(\.\.(\/|\\|$))+/, "");
      if (normalizedPath.includes("..") || path.isAbsolute(normalizedPath)) {
        throw new Error(`Security error: Invalid path '${file.path}'`);
      }

      const fullPath = path.join(deployDir, normalizedPath);
      const parentDir = path.dirname(fullPath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }

      const buffer = file.encoding === "base64" || (!file.encoding && this.isBase64Likely(file.content))
        ? Buffer.from(file.content, "base64")
        : Buffer.from(file.content, "utf-8");

      fs.writeFileSync(fullPath, buffer);
      totalSize += buffer.length;

      if (totalSize > config.limits.maxTotalSizeBytes) {
        throw new Error(`Exceeded maximum deployment size limit (${config.limits.maxTotalSizeBytes / (1024 * 1024)}MB)`);
      }

      if (normalizedPath.toLowerCase() === "index.html") {
        entrypoint = normalizedPath;
      }
    }

    return {
      fileCount: files.length,
      sizeBytes: totalSize,
      entrypoint,
    };
  }

  private isBase64Likely(content: string): boolean {
    // If it looks like base64 and doesn't contain HTML tags, decode as base64
    if (content.startsWith("<") || content.includes("\n") || content.length % 4 !== 0) {
      return false;
    }
    const base64Regex = /^[A-Za-z0-9+/]+={0,2}$/;
    return base64Regex.test(content) && content.length > 32;
  }

  getFile(deploymentId: string, relativePath: string): { content: Buffer; contentType: string } | null {
    const deployDir = this.getDeploymentDir(deploymentId);
    if (!fs.existsSync(deployDir)) return null;

    let targetPath = path.join(deployDir, path.normalize(relativePath).replace(/^(\.\.(\/|\\|$))+/, ""));

    // If directory, try index.html
    if (fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory()) {
      targetPath = path.join(targetPath, "index.html");
    }

    // SPA fallback: if not found, try index.html
    if (!fs.existsSync(targetPath)) {
      const fallback = path.join(deployDir, "index.html");
      if (fs.existsSync(fallback)) {
        targetPath = fallback;
      } else {
        return null;
      }
    }

    const contentType = (mime.lookup(targetPath) as string) || "application/octet-stream";
    const content = fs.readFileSync(targetPath);
    return { content, contentType };
  }

  deleteDeploymentFiles(deploymentId: string): void {
    const deployDir = this.getDeploymentDir(deploymentId);
    if (fs.existsSync(deployDir)) {
      fs.rmSync(deployDir, { recursive: true, force: true });
    }
  }
}

export const storage = new StorageService();
