/// <reference types="astro/client" />

declare module "node:fs" {
  const fs: { readFileSync(path: string, encoding: string): string; existsSync(path: string): boolean };
  export default fs;
}

declare module "node:path" {
  const path: { join(...parts: string[]): string };
  export default path;
}

declare const process: { cwd(): string };
