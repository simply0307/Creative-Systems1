import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import { runRuntimeReadiness } from "../netlify/functions/lib/runtime-contract.mjs";
import { supabaseConfig } from "../netlify/functions/lib/supabase.mjs";
import {
  REQUIRED_BUCKETS,
  REQUIRED_TABLES,
  loadLocalEnv,
  printManualMigrationFallback,
  printResult,
  resolveCommand,
  runCommand,
  safeJson,
} from "./lib/setup-utils.mjs";

loadLocalEnv();

const config = supabaseConfig(process.env);
if (!config.configured) {
  console.error(`Cannot prepare Supabase. Runtime configuration is invalid: ${[...config.missing, ...config.configurationErrors.map((item) => item.code)].join(", ")}.`);
  process.exit(1);
}

const cli = resolveCommand("supabase");
let migrationInspected = false;
if (cli) {
  console.log("Linking this repository for read-only migration inspection...");
  const linked = runCommand(cli, ["link", "--project-ref", process.env.SUPABASE_PROJECT_REF], { capture: false });
  if (linked.status === 0) {
    console.log("Listing local and remote migration history...");
    const listed = runCommand(cli, ["migration", "list", "--linked"], { capture: false });
    console.log("Checking pending migrations without applying them...");
    const dry = runCommand(cli, ["db", "push", "--dry-run"]);
    migrationInspected = listed.status === 0 && dry.status === 0;
    if (!migrationInspected) console.error("Migration inspection failed. No migration was applied.");
    else console.log("Migration inspection complete. Production changes run only through the guarded GitHub Actions workflow.");
  } else {
    console.error("Supabase CLI could not link the project. Run `supabase login` and try again.");
  }
} else {
  console.log("Supabase CLI is not installed, so migration inspection was skipped.");
  printManualMigrationFallback();
}

const supabase = createClient(config.url, config.serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

console.log("\nVerifying database tables...");
const tables = {};
for (const table of REQUIRED_TABLES) {
  const result = await supabase.from(table).select("*", { count: "exact", head: true });
  tables[table] = { exists: !result.error, count: result.count ?? null, error: result.error?.message || null };
  printResult(table, !result.error, result.error ? "migration may still need to run" : `${result.count ?? 0} row(s)`);
}

const tablesReady = Object.values(tables).every((item) => item.exists);
if (!tablesReady) {
  printManualMigrationFallback();
  console.error("Database verification stopped before bucket/audit setup because required tables are missing.");
  process.exit(1);
}

console.log("\nEnsuring private Storage buckets...");
const listed = await supabase.storage.listBuckets();
if (listed.error) throw new Error(`List Storage buckets: ${listed.error.message}`);
const existing = new Map((listed.data || []).map((bucket) => [bucket.id, bucket]));
const buckets = {};
for (const name of REQUIRED_BUCKETS) {
  const current = existing.get(name);
  let result = null;
  if (!current) result = await supabase.storage.createBucket(name, { public: false });
  else if (current.public) result = await supabase.storage.updateBucket(name, { public: false });
  const error = result?.error || null;
  buckets[name] = { exists: !error, private: !error, created: !current && !error };
  printResult(name, !error, error ? error.message : current ? "exists and is private" : "created as private");
}

const readiness = await runRuntimeReadiness({ supabase, config });
if (!readiness.ready) {
  console.error(`Runtime readiness failed: ${readiness.failures.map((item) => `${item.component}/${item.code}`).join(", ")}.`);
  process.exit(1);
}

const auditTarget = `supabase-project:${process.env.SUPABASE_PROJECT_REF}`;
const auditPayload = {
  actor_email: "setup-automation@creative-os.local",
  actor_role: "owner",
  action_type: "setup_configuration",
  target_type: "system",
  target_id: auditTarget,
  intent_summary: "Verify the Creative OS Supabase schema and private Storage buckets.",
  reason: "Guided live setup",
  before_snapshot: {},
  after_snapshot: { tablesVerified: REQUIRED_TABLES.length, bucketsVerified: REQUIRED_BUCKETS, migrationInspected },
  result: "verified",
};
const previous = await supabase.from("audit_events").select("id").eq("action_type", "setup_configuration").eq("target_id", auditTarget).order("created_at", { ascending: false }).limit(1).maybeSingle();
if (previous.error) throw new Error(`Find setup audit event: ${previous.error.message}`);
const audit = previous.data?.id
  ? await supabase.from("audit_events").update(auditPayload).eq("id", previous.data.id).select("id").single()
  : await supabase.from("audit_events").insert(auditPayload).select("id").single();
if (audit.error) throw new Error(`Write setup audit event: ${audit.error.message}`);

console.log("\nSupabase preparation complete.");
console.log(safeJson({
  migrationInspected,
  databaseConnected: true,
  requiredTablesFound: REQUIRED_TABLES.length,
  requiredBucketsFound: REQUIRED_BUCKETS.length,
  bucketsPrivate: true,
  runtimeReady: readiness.ready,
  setupAuditEvent: previous.data?.id ? "updated" : "inserted",
}));
