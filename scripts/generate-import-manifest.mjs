import fs from "node:fs";
import path from "node:path";
import { buildRepoMetadataManifest } from "./lib/repo-metadata.mjs";

const root = process.cwd();
const output = path.join(root, "src", "generated", "repo-import-manifest.json");
const manifest = buildRepoMetadataManifest(root);
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Generated protected repo import manifest ${manifest.version}: ${manifest.counts.artifacts} artifacts, ${manifest.counts.archiveRecords} archive records, ${manifest.counts.decisions} decisions, ${manifest.counts.expectedFiles} expected files.`);
