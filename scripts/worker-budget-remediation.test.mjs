import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { getRuntimeReadiness, resetRuntimeReadinessCache } from "../netlify/functions/lib/runtime-contract.mjs";
import {
  DEFAULT_ARTIFACT_PAGE_SIZE,
  MAX_ARTIFACT_PAGE_SIZE,
  MAX_BULK_ORGANIZATION_ITEMS,
  MAX_UPLOAD_BYTES,
  handleCreativeOsRequest,
} from "../netlify/functions/creative-os.mjs";
import { createRequestBudgetRecorder, instrumentSupabaseClient } from "./lib/request-budget.mjs";
import {
  createOfflineSupabaseFixture,
  ownerIdentity,
  ownerProfile,
  runtimeFixtureConfig,
} from "./lib/request-budget-fixture.mjs";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const ready = { ready: true, failures: [], checks: {} };

const ownerServices = (supabase, overrides = {}) => ({
  config: runtimeFixtureConfig(),
  readiness: ready,
  identity: ownerIdentity,
  profile: ownerProfile,
  supabase,
  ...overrides,
});

test("artifact listing is deterministic, bounded, paginated, and batch-signs only the current page", async () => {
  const fixture = createOfflineSupabaseFixture();
  const recorder = createRequestBudgetRecorder();
  const response = await handleCreativeOsRequest(new Request("https://fixture.invalid/api/creative-os/artifacts?page=2&limit=10"), {}, ownerServices(instrumentSupabaseClient(fixture.client, recorder)));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.artifacts.length, 10);
  assert.equal(body.artifacts[0].id, "artifact.fixture-0011");
  assert.deepEqual(body.pagination, {
    page: 2,
    limit: 10,
    total: 404,
    totalPages: 41,
    hasPrevious: true,
    hasNext: true,
    order: "updated_at.desc,id.asc",
  });
  assert.equal(body.indexedRefs.length, 404);
  assert.ok(body.artifacts.every((artifact) => artifact.downloadUrl === null));
  const budget = recorder.snapshot();
  assert.equal(budget.storageSigningRequests, 1);
  assert.ok(budget.externalSubrequests < 10);
  assert.ok(budget.maximumConcurrent.total <= 6);
});

test("artifact pagination defaults and maximum are explicit", async () => {
  const fixture = createOfflineSupabaseFixture();
  const defaultResponse = await handleCreativeOsRequest(new Request("https://fixture.invalid/api/creative-os/artifacts"), {}, ownerServices(fixture.client));
  const defaultBody = await defaultResponse.json();
  assert.equal(defaultBody.pagination.limit, DEFAULT_ARTIFACT_PAGE_SIZE);
  assert.equal(defaultBody.artifacts.length, DEFAULT_ARTIFACT_PAGE_SIZE);
  const invalid = await handleCreativeOsRequest(new Request(`https://fixture.invalid/api/creative-os/artifacts?limit=${MAX_ARTIFACT_PAGE_SIZE + 1}`), {}, ownerServices(fixture.client));
  assert.equal(invalid.status, 400);
});

test("database-side artifact filters apply before pagination", async () => {
  const artifacts = createOfflineSupabaseFixture().artifacts.map((artifact, index) => ({ ...artifact, project: index < 7 ? "para-poker" : "creative-systems" }));
  const fixture = createOfflineSupabaseFixture({ artifacts });
  const response = await handleCreativeOsRequest(new Request("https://fixture.invalid/api/creative-os/artifacts?project=para-poker&limit=5"), {}, ownerServices(fixture.client));
  const body = await response.json();
  assert.equal(body.pagination.total, 7);
  assert.equal(body.artifacts.length, 5);
  assert.ok(body.artifacts.every((artifact) => artifact.project === "para-poker"));
});

test("download grants are authenticated, private, short-lived, and on demand", async () => {
  const fixture = createOfflineSupabaseFixture();
  const artifactId = fixture.artifacts[0].id;
  const anonymous = await handleCreativeOsRequest(new Request(`https://fixture.invalid/api/creative-os/artifacts/${artifactId}/download`), {}, {
    config: runtimeFixtureConfig(), readiness: ready, identity: { authenticated: false, userRole: "viewer" }, supabase: fixture.client,
  });
  assert.equal(anonymous.status, 401);

  const recorder = createRequestBudgetRecorder();
  const owner = await handleCreativeOsRequest(new Request(`https://fixture.invalid/api/creative-os/artifacts/${artifactId}/download`), {}, ownerServices(instrumentSupabaseClient(fixture.client, recorder)));
  const body = await owner.json();
  assert.equal(owner.status, 200);
  assert.equal(body.artifactId, artifactId);
  assert.equal(body.expiresIn, 300);
  assert.match(body.downloadUrl, /download=1/);
  assert.equal(recorder.snapshot().externalSubrequests, 2);
});

test("successful readiness caches briefly, expires deterministically, and never caches failure", async () => {
  resetRuntimeReadinessCache();
  const fixture = createOfflineSupabaseFixture();
  const config = runtimeFixtureConfig();
  const firstRecorder = createRequestBudgetRecorder();
  assert.equal((await getRuntimeReadiness({ supabase: instrumentSupabaseClient(fixture.client, firstRecorder), config, now: new Date("2026-08-10T00:00:00Z") })).ready, true);
  assert.equal(firstRecorder.snapshot().externalSubrequests, 2);
  const cachedRecorder = createRequestBudgetRecorder();
  assert.equal((await getRuntimeReadiness({ supabase: instrumentSupabaseClient(fixture.client, cachedRecorder), config, now: new Date("2026-08-10T00:00:29Z") })).ready, true);
  assert.equal(cachedRecorder.snapshot().externalSubrequests, 0);
  const expiredRecorder = createRequestBudgetRecorder();
  assert.equal((await getRuntimeReadiness({ supabase: instrumentSupabaseClient(fixture.client, expiredRecorder), config, now: new Date("2026-08-10T00:00:31Z") })).ready, true);
  assert.equal(expiredRecorder.snapshot().externalSubrequests, 2);

  resetRuntimeReadinessCache();
  let calls = 0;
  const failing = {
    rpc: async () => { calls += 1; return { data: null, error: { message: "unavailable" } }; },
    storage: { listBuckets: async () => ({ data: [], error: { message: "unavailable" } }) },
  };
  assert.equal((await getRuntimeReadiness({ supabase: failing, config, now: new Date("2026-08-10T00:01:00Z") })).ready, false);
  assert.equal((await getRuntimeReadiness({ supabase: failing, config, now: new Date("2026-08-10T00:01:01Z") })).ready, false);
  assert.equal(calls, 2);
});

test("bulk organization is one atomic RPC for 1, 10, and the accepted maximum", async () => {
  for (const count of [1, 10, MAX_BULK_ORGANIZATION_ITEMS]) {
    const fixture = createOfflineSupabaseFixture();
    const recorder = createRequestBudgetRecorder();
    const response = await handleCreativeOsRequest(new Request("https://fixture.invalid/api/creative-os/artifacts/bulk/organization", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ artifactIds: fixture.artifacts.slice(0, count).map((artifact) => artifact.id), changes: { notes: "Atomic fixture" }, reason: "Test atomic bulk" }),
    }), {}, ownerServices(instrumentSupabaseClient(fixture.client, recorder)));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.affectedCount, count);
    assert.equal(body.results.length, count);
    assert.equal(recorder.snapshot().externalSubrequests, 1);
    assert.equal(recorder.snapshot().mutationRequests, 1);
  }
});

test("bulk policy still proposes contributor controlled changes and rejects oversize batches", async () => {
  const fixture = createOfflineSupabaseFixture();
  const contributor = { ...ownerIdentity, userRole: "contributor" };
  const proposal = await handleCreativeOsRequest(new Request("https://fixture.invalid/api/creative-os/artifacts/bulk/organization", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ artifactIds: [fixture.artifacts[0].id], changes: { project: "para-poker" }, reason: "Proposal" }),
  }), {}, ownerServices(fixture.client, { identity: contributor, profile: { ...ownerProfile, role: "contributor" } }));
  const proposalBody = await proposal.json();
  assert.equal(proposal.status, 202);
  assert.equal(proposalBody.mode, "pending-review");
  assert.ok(proposalBody.results[0].reviewRequestId);

  const tooMany = await handleCreativeOsRequest(new Request("https://fixture.invalid/api/creative-os/artifacts/bulk/organization", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ artifactIds: Array.from({ length: MAX_BULK_ORGANIZATION_ITEMS + 1 }, (_, index) => `artifact.${index}`), changes: { notes: "No" } }),
  }), {}, ownerServices(fixture.client));
  assert.equal(tooMany.status, 400);
});

test("upload limit is 50 MB in both browser and API validation", async () => {
  const fixture = createOfflineSupabaseFixture();
  const response = await handleCreativeOsRequest(new Request("https://fixture.invalid/api/creative-os/uploads/sign", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ fileName: "too-large.bin", fileSize: MAX_UPLOAD_BYTES + 1 }),
  }), {}, ownerServices(fixture.client));
  assert.equal(response.status, 413);
  assert.match((await response.json()).error, /50 MB/);
  assert.match(read("src/scripts/creative-os-client.js"), /50 \* 1024 \* 1024/);
});

test("Worker RPC migration is additive and browser roles cannot execute it", () => {
  const sql = read("supabase/migrations/20260810032000_worker_budget_rpc.sql");
  for (const name of ["creative_os_runtime_readiness", "creative_os_list_artifacts_page", "creative_os_artifact_snapshot", "creative_os_bulk_organize_artifacts"]) {
    assert.match(sql, new RegExp(`create or replace function public\\.${name}`));
    assert.match(sql, new RegExp(`revoke execute on function public\\.${name}[^;]+ from anon, authenticated`, "s"));
    assert.match(sql, new RegExp(`grant execute on function public\\.${name}[^;]+ to service_role`, "s"));
  }
  assert.match(sql, /creative_os_runtime_readiness\(\)[\s\S]+stable[\s\S]+security invoker[\s\S]+set search_path = ''/);
  assert.match(sql, /creative_os_bulk_organize_artifacts[\s\S]+cardinality\(v_ids\) > 25/);
  assert.match(sql, /'atomic', true/);
});

test("outbound concurrency remains explicitly bounded", () => {
  const helpers = read("netlify/functions/lib/supabase.mjs");
  const core = read("src/server/creative-os/handle-creative-os.mjs");
  assert.match(helpers, /mapWithConcurrency/);
  assert.match(helpers, /mapWithConcurrency\(\[\.\.\.byBucket\.entries\(\)\], 6/);
  assert.doesNotMatch(core, /Promise\.all\(records\.map/);
});
