import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { handleCreativeOsRequest } from "../netlify/functions/creative-os.mjs";
import { createCreativeOsHandler } from "../src/server/creative-os/handle-creative-os.mjs";
import { LocalTestRuntimeAdapter } from "../src/server/runtime/local-test-runtime-adapter.mjs";
import {
  createOfflineSupabaseFixture,
  ownerIdentity,
  ownerProfile,
  runtimeFixtureConfig,
} from "./lib/request-budget-fixture.mjs";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const runtime = () => new LocalTestRuntimeAdapter({
  environment: { CREATIVE_OS_RUNTIME_CONTEXT: "deploy-preview" },
  deployment: { branch: "runtime-parity", deployId: "deploy-fixture", commitRef: "commit-fixture" },
  now: "2026-08-09T16:00:00.000Z",
  uuids: ["11111111-1111-4111-8111-111111111111"],
});

const responseSnapshot = async (response) => {
  const text = await response.text();
  return {
    status: response.status,
    headers: Object.fromEntries([...response.headers.entries()].sort(([left], [right]) => left.localeCompare(right))),
    body: text ? JSON.parse(text) : null,
  };
};

const parity = async ({ request, services, context = {}, status }) => {
  const directRequest = request();
  const compatibilityRequest = request();
  const directServices = services();
  const compatibilityServices = services();
  const direct = await responseSnapshot(await createCreativeOsHandler(directServices)(directRequest, runtime()));
  const compatibility = await responseSnapshot(await handleCreativeOsRequest(compatibilityRequest, context, {
    ...compatibilityServices,
    runtime: runtime(),
  }));
  assert.equal(direct.status, status);
  assert.deepEqual(direct, compatibility);
  return direct;
};

const ready = { ready: true, failures: [], checks: { configurationValid: true } };
const anonymous = { authenticated: false, userRole: "viewer", authFailure: "missing", authFailureStatus: 401 };
const ownerServices = () => ({
  config: runtimeFixtureConfig(),
  readiness: ready,
  identity: ownerIdentity,
  profile: ownerProfile,
  supabase: createOfflineSupabaseFixture().client,
});

test("RuntimeAdapter stays narrow and excludes future provider boundaries", () => {
  const contract = read("src/server/runtime/runtime-adapter.ts");
  for (const capability of ["getConfig", "getSecret", "deploymentMetadata", "now", "randomUUID", "readonly name"]) assert.match(contract, new RegExp(capability));
  for (const deferred of ["AuthProvider", "BlobProvider", "GenerationProvider", "JobQueue", "WorkflowExecutor"]) assert.doesNotMatch(contract.replace(/\*[^]*?\*\//g, ""), new RegExp(deferred));
});

test("shared core has no direct Netlify runtime, process environment, clock, or UUID primitive", () => {
  const core = read("src/server/creative-os/handle-creative-os.mjs");
  assert.doesNotMatch(core, /globalThis\.Netlify|process\.env|clientContext|requestContext/);
  assert.doesNotMatch(core, /from ["']node:crypto["']|new Date\s*\(/);
  assert.match(core, /handleCreativeOs = createCreativeOsHandler\(\)/);

  const entry = read("netlify/functions/creative-os.mjs");
  assert.match(entry, /handleCreativeOs\(request, new NetlifyRuntimeAdapter\(\)\)/);
  assert.doesNotMatch(entry, /supabase\.from|runRuntimeReadiness|classifyCreativeOsRoute/);
});

test("LocalTestRuntimeAdapter supplies deterministic time, UUIDs, environment, secrets, and deployment metadata", () => {
  const adapter = new LocalTestRuntimeAdapter({
    environment: { PUBLIC_VALUE: "visible" },
    secrets: { SECRET_VALUE: "hidden" },
    deployment: { branch: "test", deployId: "deploy", commitRef: "commit" },
    now: "2026-08-09T12:34:56.000Z",
    uuids: ["22222222-2222-4222-8222-222222222222"],
  });
  assert.equal(adapter.name, "local-test");
  assert.equal(adapter.getConfig("PUBLIC_VALUE"), "visible");
  assert.equal(adapter.getSecret("SECRET_VALUE"), "hidden");
  assert.deepEqual(adapter.deploymentMetadata(), { branch: "test", deployId: "deploy", commitRef: "commit" });
  assert.equal(adapter.now().toISOString(), "2026-08-09T12:34:56.000Z");
  assert.equal(adapter.randomUUID(), "22222222-2222-4222-8222-222222222222");
  assert.equal(adapter.randomUUID(), "00000000-0000-4000-8000-000000000001");
});

test("Netlify compatibility path preserves health response", async () => {
  const snapshot = await parity({
    request: () => new Request("https://fixture.invalid/api/creative-os/health"),
    services: () => ({ config: runtimeFixtureConfig() }),
    status: 200,
  });
  assert.equal(snapshot.body.health, "reachable");
  assert.equal(snapshot.body.deployedBranch, "runtime-parity");
});

test("Netlify compatibility path preserves readiness response", async () => {
  const snapshot = await parity({
    request: () => new Request("https://fixture.invalid/api/creative-os/ready"),
    services: () => ({ config: runtimeFixtureConfig(), readiness: ready }),
    status: 200,
  });
  assert.equal(snapshot.body.ready, true);
});

test("Netlify compatibility path preserves anonymous artifact rejection", async () => {
  const snapshot = await parity({
    request: () => new Request("https://fixture.invalid/api/creative-os/artifacts"),
    services: () => ({ config: runtimeFixtureConfig(), readiness: ready, identity: anonymous }),
    status: 401,
  });
  assert.equal(snapshot.body.databaseWriteApplied, false);
});

test("Netlify compatibility path preserves authenticated artifact listing", async () => {
  const snapshot = await parity({
    request: () => new Request("https://fixture.invalid/api/creative-os/artifacts"),
    services: ownerServices,
    status: 200,
  });
  assert.equal(snapshot.body.userRole, "owner");
  assert.equal(snapshot.body.artifacts.length, 404);
});

test("Netlify compatibility path preserves privileged review read", async () => {
  const snapshot = await parity({
    request: () => new Request("https://fixture.invalid/api/creative-os/review-requests"),
    services: ownerServices,
    status: 200,
  });
  assert.deepEqual(snapshot.body.requests, []);
});

test("Netlify compatibility path preserves invalid-route error", async () => {
  const snapshot = await parity({
    request: () => new Request("https://fixture.invalid/api/creative-os/not-a-route"),
    services: ownerServices,
    status: 404,
  });
  assert.match(snapshot.body.error, /No Creative OS API route/);
});

test("Netlify compatibility path preserves validation error", async () => {
  const snapshot = await parity({
    request: () => new Request("https://fixture.invalid/api/creative-os/controlled-values/tags", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }),
    services: ownerServices,
    status: 400,
  });
  assert.match(snapshot.body.error, /name is required/i);
});

test("Netlify compatibility path preserves mutation authorization failure", async () => {
  const snapshot = await parity({
    request: () => new Request("https://fixture.invalid/api/creative-os/folders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "Archive/Test" }),
    }),
    services: () => ({ config: runtimeFixtureConfig(), readiness: ready, identity: anonymous }),
    status: 401,
  });
  assert.equal(snapshot.body.databaseWriteAttempted, false);
});

test("Netlify compatibility path preserves OPTIONS and CORS headers", async () => {
  const snapshot = await parity({
    request: () => new Request("https://fixture.invalid/api/creative-os/artifacts", { method: "OPTIONS" }),
    services: () => ({}),
    status: 204,
  });
  assert.equal(snapshot.body, null);
  assert.equal(snapshot.headers["access-control-allow-methods"], "GET,POST,PATCH,OPTIONS");
});
