import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  REQUIRED_SUPABASE_ENV,
  envIsSet,
  loadLocalEnv,
  printResult,
  readNetlifySiteId,
  resolveCommand,
  root,
} from "./lib/setup-utils.mjs";

const env = loadLocalEnv();
const nodeMajor = Number(process.versions.node.split(".")[0]);
const npm = resolveCommand("npm");
const supabase = resolveCommand("supabase");
const netlify = resolveCommand("netlify");
const migration = path.join(root, "supabase", "migrations", "202606180001_creative_os.sql");
const imports = ["scripts/import-supabase.mjs", "scripts/import-workspace-files.mjs"].map((file) => path.join(root, file));
const siteId = readNetlifySiteId();
const missingEnv = REQUIRED_SUPABASE_ENV.filter((name) => !envIsSet(name));

console.log("Creative OS setup prerequisites\n");
printResult("Node.js 20+", nodeMajor >= 20, `detected ${process.version}`);
printResult("npm", Boolean(npm), npm ? "available" : "install Node.js from https://nodejs.org/");
printResult("Supabase CLI", Boolean(supabase), supabase ? "available" : "install with: npm install --save-dev supabase");
printResult("Netlify CLI", Boolean(netlify), netlify ? "available" : "install with: npm install --save-dev netlify-cli");
printResult("Local .env", env.exists, env.exists ? "loaded without displaying values" : "copy .env.example to .env");
for (const name of REQUIRED_SUPABASE_ENV) printResult(name, envIsSet(name));
printResult("Supabase migration", fs.existsSync(migration), path.relative(root, migration));
for (const file of imports) printResult(`Import script ${path.basename(file)}`, fs.existsSync(file));
printResult("Netlify site link", Boolean(siteId), siteId ? "linked (site ID hidden)" : "run netlify login && netlify link, or set NETLIFY_SITE_ID");

if (!supabase) {
  console.log("\nSupabase CLI alternatives (do not use npm install -g supabase):");
  console.log("- Repository-local: npm install --save-dev supabase");
  console.log("- Windows/Scoop: scoop bucket add supabase https://github.com/supabase/scoop-bucket.git && scoop install supabase");
}
if (!netlify) console.log("\nNetlify CLI: npm install --save-dev netlify-cli (or npm install -g netlify-cli).");
if (missingEnv.length) console.log(`\nNext step: add the ${missingEnv.length} missing value(s) to .env. Secret values were not printed.`);

const requiredFilesPresent = fs.existsSync(migration) && imports.every((file) => fs.existsSync(file));
process.exitCode = nodeMajor >= 20 && npm && env.exists && !missingEnv.length && requiredFilesPresent && siteId ? 0 : 1;
