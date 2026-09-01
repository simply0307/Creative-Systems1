import { copyFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(directory, "..");
const sourceDirectory = path.join(repositoryRoot, "netlify", "functions", "_shared", "reath");
const targetDirectory = path.join(repositoryRoot, "supabase", "functions", "_shared", "reath");
const runtimeFiles = [
  "cluster.mjs",
  "enrichment.mjs",
  "feed-parser.mjs",
  "geography.mjs",
  "headline.mjs",
  "ingestion.mjs",
  "reconciliation.mjs",
  "signal.mjs",
  "source-adapters.mjs",
  "url-normalizer.mjs",
];

const checkOnly = process.argv.includes("--check");
await mkdir(targetDirectory, { recursive: true });

for (const filename of runtimeFiles) {
  const sourcePath = path.join(sourceDirectory, filename);
  const targetPath = path.join(targetDirectory, filename);
  if (checkOnly) {
    const [source, target] = await Promise.all([
      readFile(sourcePath, "utf8"),
      readFile(targetPath, "utf8"),
    ]);
    if (source !== target) throw new Error(`Supabase Edge runtime copy is stale: ${filename}`);
  } else {
    await copyFile(sourcePath, targetPath);
  }
}

console.log(`${checkOnly ? "Verified" : "Synchronized"} ${runtimeFiles.length} shared Reath runtime modules.`);
