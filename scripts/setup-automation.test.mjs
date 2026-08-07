import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { buildWorkspaceImportPlan, summarizeWorkspacePlan } from "./lib/workspace-import-plan.mjs";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("package exposes the complete guarded setup command suite", () => {
  const scripts = JSON.parse(read("package.json")).scripts;
  for (const name of ["setup", "setup:check", "setup:supabase", "setup:netlify", "setup:import", "setup:import:apply", "setup:verify"]) assert.ok(scripts[name], `${name} is missing`);
});

test("environment template includes setup inputs without real credentials", () => {
  const template = read(".env.example");
  for (const name of ["CREATIVE_OS_RUNTIME_CONTEXT", "CREATIVE_OS_SCHEMA_CONTRACT_VERSION", "CREATIVE_OS_MUTATION_AUTHORITY", "SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_PROJECT_REF", "SUPABASE_STORAGE_BUCKET_ARTIFACTS", "SUPABASE_STORAGE_BUCKET_EXPORTS", "SUPABASE_STORAGE_BUCKET_IMPORTS_RAW", "SUPABASE_STORAGE_BUCKET_IMPORTS_PROCESSED", "SUPABASE_STORAGE_BUCKET_THUMBNAILS", "NETLIFY_SITE_ID", "CREATIVE_OS_SITE_URL"]) assert.match(template, new RegExp(`^${name}=`, "m"));
  assert.doesNotMatch(template, /sb_secret_[A-Za-z0-9_-]{8,}/);
});

test("Supabase setup pushes migrations safely and stops instead of using a partial SQL fallback", () => {
  const script = read("scripts/setup-supabase.mjs");
  const contract = read("netlify/functions/lib/runtime-contract.mjs");
  assert.match(script, /"db", "push", "--dry-run"/);
  assert.match(script, /printManualMigrationFallback/);
  assert.doesNotMatch(script, /runCommand\([^\n]+["']reset["']|drop database|truncate/i);
  for (const bucket of ["artifacts", "exports", "imports-raw", "imports-processed", "thumbnails"]) assert.match(contract, new RegExp(bucket));
});

test("Netlify setup sends only named runtime values and does not print them", () => {
  const script = read("scripts/setup-netlify.mjs");
  assert.match(script, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(script, /--secret/);
  assert.match(script, /value hidden/);
  assert.match(script, /--context/);
  assert.match(script, /requestedContext/);
  assert.doesNotMatch(script, /console\.log\([^\n]*process\.env\[/);
});

test("guided setup stops before the real import", () => {
  const script = read("scripts/setup.mjs");
  assert.match(script, /setup-check/);
  assert.match(script, /setup-supabase/);
  assert.match(script, /setup-netlify/);
  assert.match(script, /setup-import\.mjs/);
  assert.doesNotMatch(script, /setup-import-apply/);
  assert.match(script, /No real metadata\/file import was run/);
});

test("real import requires explicit confirmation", () => {
  const script = read("scripts/setup-import-apply.mjs");
  assert.match(script, /Type IMPORT to continue/);
  assert.match(script, /--confirm-import/);
  assert.match(script, /supabase:seed/);
  assert.match(script, /supabase:files/);
  assert.match(script, /supabaseConfig/);
  assert.match(script, /runRuntimeReadiness/);
  assert.match(script, /setup_import_complete/);
});

test("all direct import writers fail closed on runtime identity and readiness", () => {
  for (const file of ["scripts/import-supabase.mjs", "scripts/import-workspace-files.mjs"]) {
    const script = read(file);
    assert.match(script, /supabaseConfig/);
    assert.match(script, /runRuntimeReadiness/);
  }
  assert.match(read("scripts/import-workspace-files.mjs"), /config\.artifactsBucket/);
});

test("workspace file plan uses immutable checksum paths and skips exact reruns", () => {
  const built = buildWorkspaceImportPlan({ root, bucket: "artifacts" });
  assert.ok(built.plan.length > 0);
  const sample = built.plan[0];
  assert.match(sample.objectPath, new RegExp(`\\.${sample.checksum.slice(0, 12)}(?:\\.[^./]+)?$`));
  const remote = new Map([[sample.artifact.id, { id: sample.artifact.id, storage_path: sample.objectPath, provenance: { checksumSha256: sample.checksum } }]]);
  const summary = summarizeWorkspacePlan({ plan: [sample], indexed: built.indexed, remoteById: remote });
  assert.equal(summary.unchangedFilesSkipped, 1);
  assert.equal(summary.filesWouldBeUploaded, 0);
  const importer = read("scripts/import-workspace-files.mjs");
  assert.match(importer, /upsert: false/);
  assert.doesNotMatch(importer, /upsert: true/);
  assert.match(importer, /Resume import batch/);
  assert.match(importer, /Update batch review/);
});

test("verification covers the read-only runtime, schema, Storage, API, and GitHub routine-write status", () => {
  const script = read("scripts/setup-verify.mjs");
  for (const phrase of ["/api/creative-os/health", "/api/creative-os/ready", "serviceRoleWorksServerSide", "anonKeyWorks", "schemaContractVersionMatches", "storageBucketsExistAndPrivate", "requiredTablesAndColumnsExist", "apiReportsGitHubRoutineWritesDisabled"]) assert.match(script, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(script, /\.insert\(|\.update\(|\.upload\(|\.remove\(/);
});

test("documentation explains fast setup, fallbacks, safety, and acceptance", () => {
  const guide = read("docs/OPERATIONS_API.md");
  for (const phrase of ["Fast automated setup", "npm run setup", "npm run setup:import:apply", "Safe migration fallback", "never call `supabase db reset`", "Final live acceptance checklist", "Exact acceptance test"]) assert.match(guide, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
});

test("private setup state and credentials stay ignored by Git", () => {
  const ignore = read(".gitignore");
  assert.match(ignore, /^\.env$/m);
  assert.match(ignore, /^\.netlify\/$/m);
  assert.match(ignore, /^supabase\/\.temp\/$/m);
});
