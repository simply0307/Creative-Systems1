import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

export const root = process.cwd();

export const REQUIRED_SUPABASE_ENV = [
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_PROJECT_REF",
  "SUPABASE_STORAGE_BUCKET_ARTIFACTS",
  "SUPABASE_STORAGE_BUCKET_EXPORTS",
];

export const REQUIRED_TABLES = [
  "profiles",
  "artifacts",
  "tags",
  "artifact_tags",
  "categories",
  "artifact_categories",
  "archive_records",
  "artifact_archive_records",
  "decisions",
  "decision_resolutions",
  "review_requests",
  "review_notes",
  "audit_events",
  "import_batches",
  "exports",
];

export const REQUIRED_BUCKETS = ["artifacts", "exports", "imports-raw", "imports-processed", "thumbnails"];

const unquote = (value) => {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1).replaceAll("\\n", "\n");
  }
  return trimmed.replace(/\s+#.*$/, "").trim();
};

export const readEnvFile = (file = path.join(root, ".env")) => {
  if (!fs.existsSync(file)) return {};
  return Object.fromEntries(fs.readFileSync(file, "utf8").split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    return match ? [[match[1], unquote(match[2])]] : [];
  }));
};

export const loadLocalEnv = (file = path.join(root, ".env")) => {
  const values = readEnvFile(file);
  for (const [name, value] of Object.entries(values)) {
    if (process.env[name] === undefined) process.env[name] = value;
  }
  return { exists: fs.existsSync(file), file, values };
};

export const envIsSet = (name) => {
  const value = String(process.env[name] || "").trim();
  return Boolean(value && !/^(YOUR_|https:\/\/YOUR_|change-me)/i.test(value));
};

export const maskSecrets = (value) => {
  let output = String(value || "");
  for (const name of ["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_ANON_KEY", "NETLIFY_AUTH_TOKEN", "NETLIFY_IDENTITY_TOKEN"]) {
    const secret = process.env[name];
    if (secret && secret.length > 5) output = output.split(secret).join("[redacted]");
  }
  return output;
};

const executableCandidates = (name) => {
  const suffixes = process.platform === "win32" ? [".cmd", ".exe", ""] : [""];
  return suffixes.map((suffix) => path.join(root, "node_modules", ".bin", `${name}${suffix}`));
};

export const resolveCommand = (name) => {
  const local = executableCandidates(name).find((candidate) => fs.existsSync(candidate));
  if (local) return local;
  const finder = process.platform === "win32" ? "where.exe" : "which";
  const result = spawnSync(finder, [name], { encoding: "utf8", windowsHide: true });
  return result.status === 0 ? result.stdout.split(/\r?\n/).map((item) => item.trim()).find(Boolean) || null : null;
};

export const runCommand = (command, args, options = {}) => {
  const capture = options.capture !== false;
  const result = spawnSync(command, args, {
    cwd: options.cwd || root,
    env: options.env || process.env,
    encoding: capture ? "utf8" : undefined,
    stdio: capture ? "pipe" : "inherit",
    windowsHide: true,
  });
  if (capture && options.print !== false) {
    if (result.stdout) process.stdout.write(maskSecrets(result.stdout));
    if (result.stderr) process.stderr.write(maskSecrets(result.stderr));
  }
  return result;
};

export const runNodeScript = (relative, args = [], options = {}) => runCommand(process.execPath, [path.join(root, relative), ...args], options);

export const readNetlifySiteId = () => {
  if (envIsSet("NETLIFY_SITE_ID")) return process.env.NETLIFY_SITE_ID.trim();
  const statePath = path.join(root, ".netlify", "state.json");
  if (!fs.existsSync(statePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(statePath, "utf8")).siteId || null;
  } catch {
    return null;
  }
};

export const printResult = (label, ok, detail = "") => {
  const mark = ok ? "OK" : "MISSING";
  console.log(`${mark.padEnd(8)} ${label}${detail ? ` — ${detail}` : ""}`);
};

export const printManualMigrationFallback = () => {
  const migration = path.join(root, "supabase", "migrations", "202606180001_creative_os.sql");
  console.log("\nSupabase CLI fallback:");
  console.log("1. Open Supabase Dashboard > SQL Editor > New query.");
  console.log(`2. Copy all SQL from: ${migration}`);
  console.log("3. Run the query once, then rerun: npm run setup:supabase");
  console.log("The migration uses CREATE IF NOT EXISTS/upserts and does not reset or drop the database.");
};

export const safeJson = (value) => JSON.stringify(value, null, 2);
