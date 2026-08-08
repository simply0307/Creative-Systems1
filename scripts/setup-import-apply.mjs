import process from "node:process";
import { createInterface } from "node:readline/promises";
import { envIsSet, loadLocalEnv, resolveCommand, runCommand, safeJson } from "./lib/setup-utils.mjs";
import { getSupabaseAdmin, supabaseConfig } from "../netlify/functions/lib/supabase.mjs";
import { runRuntimeReadiness } from "../netlify/functions/lib/runtime-contract.mjs";

loadLocalEnv();
const required = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_PROJECT_REF"];
const missing = required.filter((name) => !envIsSet(name));
if (missing.length) {
  console.error(`Cannot import. Add ${missing.join(", ")} to .env first.`);
  process.exit(1);
}

const config = supabaseConfig(process.env);
if (!config.configured) {
  console.error(`Cannot import: ${[...config.missing, ...config.configurationErrors.map((item) => item.message)].join("; ")}`);
  process.exit(1);
}
const supabase = getSupabaseAdmin(process.env, config);
const readiness = await runRuntimeReadiness({ supabase, config });
if (!readiness.ready) {
  console.error(`Cannot import: runtime readiness failed (${readiness.failures.join("; ")}).`);
  process.exit(1);
}

let confirmed = process.argv.includes("--confirm-import");
if (!confirmed && process.stdin.isTTY) {
  console.log("This will upsert metadata and upload new/changed workspace files to private Supabase Storage.");
  console.log("Existing matching checksums will be skipped. Existing Storage objects will not be overwritten.");
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await prompt.question('Type IMPORT to continue: ');
  prompt.close();
  confirmed = answer.trim() === "IMPORT";
}
if (!confirmed) {
  console.log("Import cancelled. No data or files were changed.");
  console.log("For a non-interactive run, explicitly pass: npm run setup:import:apply -- --confirm-import");
  process.exit(1);
}

const npm = resolveCommand("npm");
if (!npm) throw new Error("npm is unavailable.");
console.log("Running idempotent metadata seed…");
const productionConfirmation = config.projectRef === "okqkljexfzolzxysjaha" || config.runtimeContext === "production" ? ["--confirm-production"] : [];
const targetConfirmation = [`--confirm-project-ref=${config.projectRef}`, ...productionConfirmation];
const seed = runCommand(npm, ["run", "supabase:seed:apply", "--", ...targetConfirmation], { capture: false });
if (seed.status !== 0) process.exit(seed.status || 1);
console.log("Running checksum-aware private file import…");
const files = runCommand(npm, ["run", "supabase:files:apply", "--", ...targetConfirmation], { capture: false });
if (files.status !== 0) process.exit(files.status || 1);

const counts = {};
for (const table of ["artifacts", "archive_records", "decisions", "import_batches"]) {
  const result = await supabase.from(table).select("*", { count: "exact", head: true });
  if (result.error) throw new Error(`Count ${table}: ${result.error.message}`);
  counts[table] = result.count ?? 0;
}
const targetId = `initial-import:${process.env.SUPABASE_PROJECT_REF}`;
const payload = {
  actor_email: "setup-automation@creative-os.local",
  actor_role: "owner",
  action_type: "setup_import_complete",
  target_type: "system",
  target_id: targetId,
  intent_summary: "Seed Creative OS metadata and import private workspace files.",
  reason: "Explicitly confirmed guided setup import",
  before_snapshot: {},
  after_snapshot: counts,
  result: "completed",
};
const previous = await supabase.from("audit_events").select("id").eq("action_type", "setup_import_complete").eq("target_id", targetId).limit(1).maybeSingle();
if (previous.error) throw new Error(`Find import audit: ${previous.error.message}`);
const audit = previous.data?.id
  ? await supabase.from("audit_events").update(payload).eq("id", previous.data.id)
  : await supabase.from("audit_events").insert(payload);
if (audit.error) throw new Error(`Write import audit: ${audit.error.message}`);

console.log("\nReal import complete.");
console.log(safeJson({ ...counts, importAuditEvent: previous.data?.id ? "updated" : "inserted" }));
