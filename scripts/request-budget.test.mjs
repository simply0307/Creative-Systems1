import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import baseline from "../docs/evidence/request-budget-baseline-2026-08-09.json" with { type: "json" };
import { measureCurrentRequestBudgets } from "./request-budget-report.mjs";
import { WORKER_FREE_REQUEST_BUDGET } from "./lib/request-budget-targets.mjs";

const root = path.resolve(import.meta.dirname, "..");
const withoutDetailBreakdown = (measurement) => JSON.parse(JSON.stringify(measurement, (key, value) => ["byDatabaseTable", "byOperation"].includes(key) ? undefined : value));

test("current request-budget measurements match the committed evidence baseline", async () => {
  const measured = withoutDetailBreakdown(await measureCurrentRequestBudgets());
  const expected = { ...baseline };
  delete expected.capturedOn;
  delete expected.interpretation;
  assert.deepEqual(measured, expected);
});

test("current over-budget behavior is recorded instead of disguised as Worker-compatible", () => {
  assert.ok(baseline.ownerArtifactListingFullProtectedRequest.externalSubrequests > WORKER_FREE_REQUEST_BUDGET.externalSubrequests);
  assert.ok(baseline.ownerArtifactListingFullProtectedRequest.maximumConcurrent.total > WORKER_FREE_REQUEST_BUDGET.simultaneousOutgoingConnections);
  assert.ok(baseline.bulkOrganization.normalSmallBatch.externalSubrequests > WORKER_FREE_REQUEST_BUDGET.externalSubrequests);
  assert.equal(baseline.interpretation.knownWorkerBudgetFailure, true);
});

test("request-budget tooling is fixture-only and has no production mutation path", () => {
  const reportSource = fs.readFileSync(path.join(root, "scripts/request-budget-report.mjs"), "utf8");
  assert.equal(baseline.fixture.fixtureOnly, true);
  assert.equal(baseline.fixture.productionMutationPossible, false);
  assert.equal(baseline.interpretation.behaviorChangedByThisReport, false);
  assert.doesNotMatch(reportSource, /process\.env|SUPABASE_SERVICE_ROLE_KEY|createClient\s*\(/);
  assert.match(reportSource, /createOfflineSupabaseFixture/);
  assert.match(reportSource, /fixture\.invalid/);
});

test("future Worker limits remain isolated from production business logic", () => {
  const productionFiles = [
    "netlify/functions/creative-os.mjs",
    "netlify/functions/lib/runtime-contract.mjs",
    "netlify/functions/lib/supabase.mjs",
  ];
  for (const file of productionFiles) {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    assert.doesNotMatch(source, /WORKER_FREE_REQUEST_BUDGET|simultaneousOutgoingConnections/);
  }
});
