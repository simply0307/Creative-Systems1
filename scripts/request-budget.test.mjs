import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import baseline from "../docs/evidence/request-budget-baseline-2026-08-09.json" with { type: "json" };
import { measureCurrentRequestBudgets } from "./request-budget-report.mjs";
import { WORKER_FREE_REQUEST_BUDGET } from "./lib/request-budget-targets.mjs";
import { SupabaseAuthProvider } from "../netlify/functions/lib/supabase-auth-provider.mjs";
import { createRequestBudgetRecorder } from "./lib/request-budget.mjs";

const root = path.resolve(import.meta.dirname, "..");
const withoutDetailBreakdown = (measurement) => JSON.parse(JSON.stringify(measurement, (key, value) => ["byDatabaseTable", "byOperation"].includes(key) ? undefined : value));

test("current request-budget measurements match the committed evidence baseline", async () => {
  const measured = withoutDetailBreakdown(await measureCurrentRequestBudgets());
  const expected = { ...baseline };
  delete expected.capturedOn;
  delete expected.interpretation;
  assert.deepEqual(measured, expected);
});

test("all measured dynamic requests satisfy Worker request and concurrency targets", () => {
  const measurements = [
    baseline.readiness,
    baseline.readinessCached,
    baseline.ownerArtifactListingRoute,
    baseline.ownerArtifactListingFullProtectedRequest,
    baseline.artifactDownloadGrant,
    baseline.authVerification.trustedNetlifyContext,
    baseline.authVerification.bearerFallback,
    baseline.bulkOrganization.oneItem,
    baseline.bulkOrganization.normalSmallBatch,
    baseline.bulkOrganization.maximumAcceptedBatch,
  ];
  for (const measurement of measurements) {
    assert.ok(measurement.externalSubrequests < WORKER_FREE_REQUEST_BUDGET.externalSubrequests);
    assert.ok(measurement.maximumConcurrent.total <= WORKER_FREE_REQUEST_BUDGET.simultaneousOutgoingConnections);
  }
  assert.equal(baseline.interpretation.knownWorkerBudgetFailure, false);
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
    "src/server/creative-os/handle-creative-os.mjs",
    "netlify/functions/lib/runtime-contract.mjs",
    "netlify/functions/lib/supabase.mjs",
  ];
  for (const file of productionFiles) {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    assert.doesNotMatch(source, /WORKER_FREE_REQUEST_BUDGET|simultaneousOutgoingConnections/);
  }
});

test("Supabase bearer verification consumes exactly one bounded Auth subrequest", async () => {
  const recorder = createRequestBudgetRecorder();
  const token = [
    Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url"),
    Buffer.from(JSON.stringify({ sub: "fixture-user", exp: Math.floor(Date.now() / 1000) + 3600, aal: "aal1" })).toString("base64url"),
    "fixture-signature",
  ].join(".");
  const supabase = { auth: { getUser: (candidate) => recorder.measure({ kind: "auth", operation: "supabase.auth.getUser" }, async () => ({
    data: { user: { id: "fixture-user", email: "fixture@example.test", email_confirmed_at: "2026-08-10T00:00:00Z", app_metadata: {}, user_metadata: {} } },
    error: candidate === token ? null : { status: 401 },
  })) } };
  const identity = await new SupabaseAuthProvider().authenticate(new Request("https://fixture.invalid", { headers: { authorization: `Bearer ${token}` } }), { supabase });
  const budget = recorder.snapshot();
  assert.equal(identity.authenticated, true);
  assert.equal(budget.authVerificationRequests, 1);
  assert.equal(budget.externalSubrequests, 1);
  assert.ok(budget.externalSubrequests < WORKER_FREE_REQUEST_BUDGET.externalSubrequests);
  assert.ok(budget.maximumConcurrent.total <= WORKER_FREE_REQUEST_BUDGET.simultaneousOutgoingConnections);
});
