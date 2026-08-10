import { pathToFileURL } from "node:url";
import { resolveIdentity } from "../netlify/functions/lib/identity.mjs";
import { runRuntimeReadiness } from "../netlify/functions/lib/runtime-contract.mjs";
import { handleCreativeOsRequest } from "../netlify/functions/creative-os.mjs";
import {
  assertFixtureOnlyBudget,
  createRequestBudgetRecorder,
  instrumentAuthFetch,
  instrumentSupabaseClient,
} from "./lib/request-budget.mjs";
import {
  CURRENT_CORPUS,
  createOfflineSupabaseFixture,
  ownerIdentity,
  ownerProfile,
  runtimeFixtureConfig,
} from "./lib/request-budget-fixture.mjs";

const successfulJson = async (response, label) => {
  const body = await response.json();
  if (!response.ok) throw new Error(`${label} returned ${response.status}: ${body.error || "unknown error"}`);
  return body;
};

const measureReadiness = async () => {
  const fixture = createOfflineSupabaseFixture();
  const recorder = createRequestBudgetRecorder();
  const result = await runRuntimeReadiness({
    supabase: instrumentSupabaseClient(fixture.client, recorder),
    config: runtimeFixtureConfig(),
  });
  if (!result.ready) throw new Error("Readiness fixture must pass before its request budget is recorded.");
  assertFixtureOnlyBudget(fixture.fixtureState);
  return recorder.snapshot();
};

const measureOwnerArtifactListing = async ({ fullProtectedRequest }) => {
  const fixture = createOfflineSupabaseFixture();
  const recorder = createRequestBudgetRecorder();
  const supabase = instrumentSupabaseClient(fixture.client, recorder);
  const overrides = fullProtectedRequest
    ? { config: runtimeFixtureConfig(), supabase }
    : {
        config: runtimeFixtureConfig(),
        readiness: { ready: true, failures: [], checks: {} },
        identity: ownerIdentity,
        profile: ownerProfile,
        supabase,
      };
  const context = fullProtectedRequest ? {
    clientContext: {
      user: {
        id: ownerIdentity.userId,
        email: ownerIdentity.userEmail,
        user_metadata: { full_name: ownerIdentity.userName },
        app_metadata: { roles: [ownerIdentity.userRole] },
      },
    },
  } : {};
  const response = await handleCreativeOsRequest(new Request("https://fixture.invalid/api/creative-os/artifacts"), context, overrides);
  const body = await successfulJson(response, "Owner artifact listing fixture");
  if (body.artifacts.length !== CURRENT_CORPUS.artifacts) throw new Error("Artifact fixture count drifted.");
  assertFixtureOnlyBudget(fixture.fixtureState);
  return recorder.snapshot();
};

const token = () => [
  Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url"),
  Buffer.from(JSON.stringify({ sub: ownerIdentity.userId, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url"),
  "fixture-signature",
].join(".");

const measureAuthVerification = async () => {
  const trustedRecorder = createRequestBudgetRecorder();
  await resolveIdentity({ headers: {} }, { clientContext: { user: {
    id: ownerIdentity.userId,
    email: ownerIdentity.userEmail,
    app_metadata: { roles: ["owner"] },
  } } }, instrumentAuthFetch(() => { throw new Error("Trusted context must not call Identity verification."); }, trustedRecorder));

  const bearerRecorder = createRequestBudgetRecorder();
  const identity = await resolveIdentity({
    rawUrl: "https://fixture.invalid/api/creative-os/artifacts",
    headers: { authorization: `Bearer ${token()}` },
  }, {}, instrumentAuthFetch(() => Promise.resolve(Response.json({
    id: ownerIdentity.userId,
    email: ownerIdentity.userEmail,
    user_metadata: { full_name: ownerIdentity.userName },
    app_metadata: { roles: ["owner"] },
  })), bearerRecorder), { CREATIVE_OS_RUNTIME_CONTEXT: "production" });
  if (!identity.authenticated) throw new Error("Bearer auth fixture must verify.");
  return {
    trustedNetlifyContext: trustedRecorder.snapshot(),
    bearerFallback: bearerRecorder.snapshot(),
  };
};

const measureBulkOrganization = async (batchSize) => {
  const fixture = createOfflineSupabaseFixture();
  const recorder = createRequestBudgetRecorder();
  const artifactIds = fixture.artifacts.slice(0, batchSize).map((artifact) => artifact.id);
  const response = await handleCreativeOsRequest(new Request("https://fixture.invalid/api/creative-os/artifacts/bulk/organization", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ artifactIds, changes: { notes: "Offline request-budget fixture" }, reason: "Measure current route behavior" }),
  }), {}, {
    config: runtimeFixtureConfig(),
    readiness: { ready: true, failures: [], checks: {} },
    identity: ownerIdentity,
    profile: ownerProfile,
    supabase: instrumentSupabaseClient(fixture.client, recorder),
  });
  const body = await successfulJson(response, `Bulk organization fixture (${batchSize})`);
  if (body.affectedCount !== batchSize) throw new Error(`Bulk fixture affected ${body.affectedCount}, expected ${batchSize}.`);
  assertFixtureOnlyBudget(fixture.fixtureState);
  return recorder.snapshot();
};

export const measureCurrentRequestBudgets = async () => ({
  reportType: "offline-current-behavior-measurement",
  fixture: {
    artifacts: CURRENT_CORPUS.artifacts,
    available: CURRENT_CORPUS.available,
    archived: CURRENT_CORPUS.archived,
    missing: CURRENT_CORPUS.missing,
    fixtureOnly: true,
    productionMutationPossible: false,
  },
  readiness: await measureReadiness(),
  ownerArtifactListingRoute: await measureOwnerArtifactListing({ fullProtectedRequest: false }),
  ownerArtifactListingFullProtectedRequest: await measureOwnerArtifactListing({ fullProtectedRequest: true }),
  authVerification: await measureAuthVerification(),
  bulkOrganization: {
    oneItem: await measureBulkOrganization(1),
    normalSmallBatch: await measureBulkOrganization(10),
    currentCorpusBatch: await measureBulkOrganization(CURRENT_CORPUS.artifacts),
  },
});

const invokedDirectly = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedDirectly) process.stdout.write(`${JSON.stringify(await measureCurrentRequestBudgets(), null, 2)}\n`);
