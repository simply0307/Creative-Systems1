import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import edgeWorker from "../supabase/functions/reath-ingest/index.mjs";
import { REATH_PROJECT_REF, reathConfig } from "../supabase/functions/_shared/reath/config.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(directory, "..");
const sharedFiles = [
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

test("Supabase Edge runtime uses the canonical deterministic modules", async () => {
  for (const filename of sharedFiles) {
    const [netlifyRuntime, edgeRuntime] = await Promise.all([
      readFile(path.join(repositoryRoot, "netlify", "functions", "_shared", "reath", filename), "utf8"),
      readFile(path.join(repositoryRoot, "supabase", "functions", "_shared", "reath", filename), "utf8"),
    ]);
    assert.equal(edgeRuntime, netlifyRuntime, `${filename} must be synchronized before deployment`);
  }
});

test("Edge configuration fails closed outside the authorized Reath project", () => {
  assert.equal(REATH_PROJECT_REF, "okqkljexfzolzxysjaha");
  const wrongProject = reathConfig({
    SUPABASE_URL: "https://not-the-reath-project.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "server-secret-placeholder",
  });
  assert.equal(wrongProject.configured, false);
  assert.match(wrongProject.errors.join(" "), /authorized Reath project/);
  assert.equal(wrongProject.aiEnabled, false);
});

test("Edge worker hides its custom-token endpoint", async () => {
  const response = await edgeWorker.fetch(new Request("https://example.test/functions/v1/reath-ingest", { method: "GET" }));
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { ok: false, error: "Not found" });
});

test("latest migration removes every Reath automatic job and adds manual cleanup", async () => {
  const migration = await readFile(path.join(
    repositoryRoot,
    "supabase",
    "migrations",
    "20260827193340_manual_only_ingestion_maintenance.sql",
  ), "utf8");
  assert.match(migration, /jobname in \('reath-edge-ingest-half-hourly', 'reath-edge-reconcile-six-hourly'\)/);
  assert.match(migration, /perform cron\.unschedule\(reath_job_id\)/);
  assert.doesNotMatch(migration, /cron\.schedule\s*\(/);
  assert.match(migration, /create function public\.run_manual_ingestion_maintenance/);
  assert.match(migration, /processing_status in \('pending', 'error'\)[\s\S]*not exists \([\s\S]*public\.story_sources/);
  assert.match(migration, /security invoker/);
  assert.doesNotMatch(migration, /security definer/i);
  assert.doesNotMatch(migration, /uzderzjbitmghfvrllvz/);
});

test("database admission rejects a legacy scheduled invocation", async () => {
  const migration = await readFile(path.join(
    repositoryRoot,
    "supabase",
    "migrations",
    "20260827195634_enforce_manual_ingestion_admission.sql",
  ), "utf8");
  assert.match(migration, /if p_trigger_type = 'scheduled' then/);
  assert.match(migration, /'admitted', false[\s\S]*'reason', 'manual_only'/);
  assert.match(migration, /security invoker/);
  assert.doesNotMatch(migration, /security definer/i);
  assert.doesNotMatch(migration, /uzderzjbitmghfvrllvz/);
});
