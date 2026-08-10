import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  CANONICAL_PROJECT_REF,
  MIGRATION_FILENAME,
  PRODUCTION_CONFIRMATION,
  SUPABASE_COMMANDS,
  assertDryRun,
  assertPostPushHistory,
  assertPrePushHistory,
  parseGateArguments,
  validateMigrationFiles,
} from "./deploy-production-migrations.mjs";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("every repository migration has a unique canonical timestamp filename", () => {
  const files = fs.readdirSync(path.join(root, "supabase", "migrations")).filter((name) => name.endsWith(".sql"));
  const versions = validateMigrationFiles(files);
  assert.equal(versions.size, files.length);
  for (const file of files) assert.match(file, MIGRATION_FILENAME);
});

test("production deployment requires exact branch, commit, project, migration, and confirmation", () => {
  const parsed = parseGateArguments([
    "--apply",
    "--expected-branch=main",
    `--expected-commit=${"a".repeat(40)}`,
    "--expected-migrations=20260810032000,20260811120000",
    `--confirm-project-ref=${CANONICAL_PROJECT_REF}`,
    `--confirm-production=${PRODUCTION_CONFIRMATION}`,
  ]);
  assert.deepEqual(parsed.expectedMigrations, ["20260810032000", "20260811120000"]);
  assert.throws(() => parseGateArguments([]), /--apply/);
  assert.throws(() => parseGateArguments(["--apply", "--db-url=forbidden"]), /Unsupported/);
});

test("pre-push history permits only the explicitly approved local-only versions", () => {
  const cleanPending = { migrations: [
    { local: "20260807101623", remote: "20260807101623" },
    { local: "20260810032000", remote: "" },
  ] };
  assert.doesNotThrow(() => assertPrePushHistory(cleanPending, ["20260810032000"]));
  assert.throws(() => assertPrePushHistory(cleanPending, ["20260811120000"]), /do not exactly match/);
  assert.throws(() => assertPrePushHistory({ migrations: [{ local: "", remote: "20260810143101" }] }, ["20260810032000"]), /remote-only/);
});

test("dry run and post-push history must exactly match the approved versions", () => {
  assert.doesNotThrow(() => assertDryRun({ migrations: ["20260810032000_worker_budget_rpc.sql"] }, ["20260810032000"]));
  assert.throws(() => assertDryRun({ migrations: ["20260810032000_a.sql", "20260811120000_b.sql"] }, ["20260810032000"]), /did not exactly match/);
  assert.doesNotThrow(() => assertPostPushHistory({ migrations: [{ local: "20260810032000", remote: "20260810032000" }] }, ["20260810032000"]));
  assert.throws(() => assertPostPushHistory({ migrations: [{ local: "20260810032000", remote: "" }] }, ["20260810032000"]), /differ/);
});

test("the production command sequence dry-runs before one push and always verifies history afterward", () => {
  assert.deepEqual(SUPABASE_COMMANDS.dryRun.slice(0, 3), ["db", "push", "--dry-run"]);
  assert.deepEqual(SUPABASE_COMMANDS.push.slice(0, 2), ["db", "push"]);
  assert.ok(!SUPABASE_COMMANDS.push.includes("--dry-run"));
  assert.deepEqual(SUPABASE_COMMANDS.historyAfter.slice(0, 2), ["migration", "list"]);
  const script = read("scripts/deploy-production-migrations.mjs");
  const writes = [...script.matchAll(/runner\(supabase, SUPABASE_COMMANDS\.(\w+)/g)].map((match) => match[1]);
  assert.deepEqual(writes, ["link", "projects", "historyBefore", "dryRun", "push", "historyAfter"]);
  assert.doesNotMatch(script, /apply_migration|execute_sql|migration repair|db reset|migration up|--include-all|--include-seed/i);
});

test("documentation and workflow enforce the sole serialized production path", () => {
  const policy = read("docs/PRODUCTION_MIGRATIONS.md");
  const workflow = read(".github/workflows/production-supabase-migration.yml");
  assert.match(policy, /supabase db push/);
  for (const prohibited of ["SQL Editor", "apply_migration", "ad-hoc SQL", "alternate migration runner"]) assert.match(policy, new RegExp(prohibited, "i"));
  assert.match(policy, /one production migration writer/i);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /concurrency:/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /supabase:migrate:production/);
  assert.match(workflow, /SUPABASE_ACCESS_TOKEN/);
  assert.match(workflow, /SUPABASE_DB_PASSWORD/);
});
