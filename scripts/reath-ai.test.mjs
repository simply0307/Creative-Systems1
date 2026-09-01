import assert from "node:assert/strict";
import test from "node:test";

import { AI_OPERATIONS, aiCacheKey, needsAiConfigurationRefresh, runBoundedAiBatch, runOptionalAiLayer, shouldEnrichStory, storyInputFingerprint, storyProviderInput, validateProviderResult, validateSourceComparisonProvenance } from "../netlify/functions/_shared/reath/ai-core.mjs";
import { AI_PRECONDITION_FAILED_CODE, distinctActiveSourceCount, loadStoryAiContext, processQueuedStoryAnalysis, processStoryAiClaim, processStoryAnalysisClaim, queueAiConfigurationChanges, queueStoryAiEnrichment, queueStorySourceComparison, requestStoryAiEnrichment, runStoryAiEnrichmentBatch, selectActiveAnalysis } from "../netlify/functions/_shared/reath/ai-orchestrator.mjs";
import { createStoryEnrichmentProvider } from "../netlify/functions/_shared/reath/ai-provider.mjs";
import { reathConfig } from "../netlify/functions/_shared/reath/config.mjs";
import { sourceComparisonSchema, storyEnrichmentResultSchema } from "../netlify/functions/_shared/reath/enrichment.mjs";
import { parseSourcePayload } from "../netlify/functions/_shared/reath/source-adapters.mjs";

const reasons = Object.fromEntries([
  "local_impact","civic_utility","significance","momentum","novelty","human_interest",
  "emotional_resonance","reath_potential","satire_potential","locality","confidence",
].map((key) => [key, `${key} evidence reason`]));

const validEnrichment = {
  enrichment: {
    nj_relevance: 96, scope: "municipality", counties: ["Mercer"], municipalities: ["Trenton"],
    topics: ["housing"], people: [], organizations: [], event_type: "ordinance", event_date: null,
    public_impact: 70, civic_utility: 80, novelty: 50, human_interest: 50,
    emotional_register: "frustration", reath_potential: 70, satire_potential: 40, confidence: 0.88,
  },
  scores: {
    local_impact: 80, civic_utility: 80, significance: 60, momentum: 50, novelty: 50,
    human_interest: 50, emotional_resonance: 60, reath_potential: 70, satire_potential: 40,
    locality: 90, confidence: 88, reasons,
  },
  briefing: {
    summary_internal: "Trenton is considering a housing ordinance.",
    why_it_may_matter: "The proposal may affect renters and property owners.",
    disputed_or_different: "Sources emphasize different affected groups.",
    unknowns: "The final ordinance text and implementation date remain unverified.",
  },
};

const context = (sourceItems = [{
  id: "11111111-1111-4111-8111-111111111111", source_id: "source-a", content_hash: "a".repeat(64),
  normalized_headline: "trenton housing ordinance", headline: "Trenton housing ordinance", description: "Proposal details",
  publisher: "Fixture", canonical_url: "https://fixture.example/a", published_at: "2026-08-22T00:00:00Z",
}]) => ({
  story: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", evidence_revision: 12, canonical_title: "Trenton housing ordinance", event_date: null, last_activity_at: "2026-08-22T00:00:00Z" },
  sourceItems,
  geography: { counties: [{ id: 11, name: "Mercer" }], municipalities: [{ id: "trenton", name: "Trenton" }] },
  organizations: [],
});

const withStoryId = (storyContext, storyId) => ({
  ...storyContext,
  story: { ...storyContext.story, id: storyId },
});

const productionAiConfig = (overrides = {}) => ({
  aiEnabled: true,
  aiAvailable: true,
  aiProvider: "fixture",
  aiModel: "fixture-model",
  aiEnrichmentVersion: "1",
  aiTimeoutMs: 1_000,
  aiMaxStoriesPerRun: 3,
  ...overrides,
});

test("Compare Sources requires distinct providers rather than repeated items", () => {
  assert.equal(distinctActiveSourceCount(context([
    { ...context().sourceItems[0], id: "11111111-1111-4111-8111-111111111111" },
    { ...context().sourceItems[0], id: "22222222-2222-4222-8222-222222222222" },
  ])), 1);
});

const fakeStorySupabase = ({ contexts, onRpc, onInsert = async (_table, payload) => payload, onQuery = async () => undefined }) => {
  const contextsByStory = contexts instanceof Map ? contexts : new Map(Object.entries(contexts));
  return {
    async rpc(name, params) {
      return { data: await onRpc(name, params), error: null };
    },
    from(table) {
      const filters = new Map();
      let inserted;
      const resolve = async (terminal) => {
        if (inserted !== undefined) return { data: await onInsert(table, inserted, terminal), error: null };
        const custom = await onQuery(table, filters, terminal);
        if (custom !== undefined) return { data: custom, error: null };
        const storyId = filters.get("story_id") || filters.get("id");
        const storyContext = contextsByStory.get(storyId);
        if (!storyContext) throw new Error(`Unexpected ${table} query for Story ${storyId || "without id"}`);
        if (table === "stories") return { data: storyContext.story, error: null };
        if (table === "story_sources") {
          return {
            data: storyContext.sourceItems.map((sourceItem) => ({
              source_item_id: sourceItem.id,
              attached_at: sourceItem.attached_at || "2026-08-22T00:00:00Z",
              source_items: sourceItem,
            })),
            error: null,
          };
        }
        if (table === "story_counties") {
          return { data: storyContext.geography.counties.map((county) => ({ county_id: county.id, counties: county })), error: null };
        }
        if (table === "story_municipalities") {
          return { data: storyContext.geography.municipalities.map((municipality) => ({ municipality_id: municipality.id, municipalities: municipality })), error: null };
        }
        if (table === "story_enrichments") {
          return { data: { organizations: storyContext.organizations, analysis_kind: "deterministic", is_current: true }, error: null };
        }
        throw new Error(`Unexpected query against ${table}`);
      };
      const query = {
        select() { return query; },
        insert(payload) { inserted = payload; return query; },
        eq(column, value) { filters.set(column, value); return query; },
        neq(column, value) { filters.set(column, value); return query; },
        lte(column, value) { filters.set(column, value); return query; },
        is(column, value) { filters.set(column, value); return query; },
        in(column, value) { filters.set(column, value); return query; },
        order() { return query; },
        limit() { return query; },
        single() { return resolve("single"); },
        maybeSingle() { return resolve("maybeSingle"); },
        then(onFulfilled, onRejected) { return resolve("many").then(onFulfilled, onRejected); },
      };
      return query;
    },
  };
};

test("zero-AI core configuration needs no AI credentials", () => {
  const config = reathConfig({
    SUPABASE_URL: "https://okqkljexfzolzxysjaha.supabase.co", SUPABASE_PROJECT_REF: "okqkljexfzolzxysjaha",
    SUPABASE_SERVICE_ROLE_KEY: "server-secret", REATH_RUNTIME_CONTEXT: "test", REATH_AI_ENABLED: "false",
  });
  assert.equal(config.configured, true);
  assert.equal(config.aiEnabled, false);
  assert.equal(config.aiAvailable, false);
});

test("AI enabled without provider credentials does not invalidate non-AI runtime", () => {
  const config = reathConfig({
    SUPABASE_URL: "https://okqkljexfzolzxysjaha.supabase.co", SUPABASE_PROJECT_REF: "okqkljexfzolzxysjaha",
    SUPABASE_SERVICE_ROLE_KEY: "server-secret", REATH_RUNTIME_CONTEXT: "test", REATH_AI_ENABLED: "true",
  });
  assert.equal(config.configured, true);
  assert.equal(config.aiAvailable, false);
  assert.equal(config.aiUnavailableReason, "missing_server_credentials");
});

test("unchanged successful Story remains cached", () => {
  const fingerprint = storyInputFingerprint(context());
  const decision = shouldEnrichStory({
    state: { enrichment_status: "succeeded", last_successful_fingerprint: fingerprint, enrichment_version: "1" },
    fingerprint, enrichmentVersion: "1",
  });
  assert.deepEqual(decision, { eligible: false, reason: "cached" });
});

test("material Story state change produces a new fingerprint and eligibility", () => {
  const before = storyInputFingerprint(context());
  const after = storyInputFingerprint(context([
    ...context().sourceItems,
    { id: "22222222-2222-4222-8222-222222222222", source_id: "source-b", content_hash: "b".repeat(64), normalized_headline: "trenton council advances housing rule", headline: "Council advances rule", description: "", publisher: "Second", canonical_url: "https://second.example/b", published_at: "2026-08-22T01:00:00Z" },
  ]));
  assert.notEqual(after, before);
  assert.equal(shouldEnrichStory({ state: { enrichment_status: "succeeded", last_successful_fingerprint: before, enrichment_version: "1" }, fingerprint: after, enrichmentVersion: "1" }).reason, "material_change");
});

test("provider evidence selection and fingerprints are deterministic and bounded", () => {
  const sources = Array.from({ length: 30 }, (_, index) => ({
    id: `${String(index + 1).padStart(8, "0")}-1111-4111-8111-111111111111`,
    source_id: `source-${index}`,
    content_hash: String(index).padStart(64, "0"),
    headline: `Evidence ${index}`,
    description: `Description ${index}`,
    publisher: `Publisher ${index}`,
    canonical_url: `https://example.test/${index}`,
    published_at: new Date(Date.UTC(2026, 7, 1, index)).toISOString(),
  }));
  const forward = context(sources);
  const reversed = context([...sources].reverse());
  assert.equal(storyInputFingerprint(forward), storyInputFingerprint(reversed));
  assert.equal(storyProviderInput(forward).source_items.length, 25);
  assert.equal(storyProviderInput(forward).source_inventory.count, 30);
});

test("manual refresh and version change are explicit enrichment gates", () => {
  const fingerprint = storyInputFingerprint(context());
  const state = { enrichment_status: "succeeded", last_successful_fingerprint: fingerprint, enrichment_version: "1" };
  assert.equal(shouldEnrichStory({ state, fingerprint, enrichmentVersion: "1", force: true }).reason, "editor_request");
  assert.equal(shouldEnrichStory({ state, fingerprint, enrichmentVersion: "2" }).reason, "version_change");
  const config = { aiEnrichmentVersion: "2", aiProvider: "openai", aiModel: "gpt-5-mini" };
  assert.equal(needsAiConfigurationRefresh({
    state: { enrichment_version: "1", schema_version: "1", prompt_version: "enrich-story-v1", provider: "openai", model: "gpt-5-mini" },
    config,
    schemaVersion: "1",
    promptVersion: "enrich-story-v1",
  }), true);
});

test("a database evidence revision change immediately falls back to deterministic analysis", () => {
  const rows = [
    { id: "deterministic", analysis_kind: "deterministic", is_current: true },
    { id: "ai", analysis_kind: "ai", is_current: true, input_fingerprint: "a".repeat(64) },
  ];
  const state = {
    enrichment_status: "succeeded",
    current_evidence_revision: 12,
    last_successful_fingerprint: "a".repeat(64),
    enrichment_version: "1",
    schema_version: "1",
    prompt_version: "enrich-story-v1",
    provider: "fixture",
    model: "fixture-model",
  };
  const config = productionAiConfig();
  assert.equal(selectActiveAnalysis(rows, state, config, 12).id, "ai");
  assert.equal(selectActiveAnalysis(rows, state, config, 13).id, "deterministic");
});

test("AI context loading retries a torn evidence snapshot", async () => {
  const storyContext = context();
  let storyReads = 0;
  const supabase = fakeStorySupabase({
    contexts: { [storyContext.story.id]: storyContext },
    async onQuery(table) {
      if (table !== "stories") return undefined;
      storyReads += 1;
      return {
        ...storyContext.story,
        evidence_revision: storyReads === 1 ? 12 : 13,
      };
    },
    async onRpc(name) { throw new Error(`Unexpected RPC ${name}`); },
  });

  const loaded = await loadStoryAiContext(supabase, storyContext.story.id);

  assert.equal(loaded.story.evidence_revision, 13);
  assert.equal(storyReads, 4);
});

test("a PT412 queue precondition reloads evidence and retries once with the new revision", async () => {
  const storyContext = context();
  const requestedRevisions = [];
  const supabase = fakeStorySupabase({
    contexts: { [storyContext.story.id]: storyContext },
    async onQuery(table) {
      if (table !== "stories") return undefined;
      return { ...storyContext.story, evidence_revision: 13 };
    },
    async onRpc(name, params) {
      assert.equal(name, "request_story_ai_enrichment");
      requestedRevisions.push(params.p_evidence_revision);
      if (requestedRevisions.length === 1) {
        const error = new Error("Story evidence changed while AI input was prepared");
        error.code = AI_PRECONDITION_FAILED_CODE;
        throw error;
      }
      return { enrichment_status: "pending", requested_generation: 2 };
    },
  });

  const queued = await queueStoryAiEnrichment({
    supabase,
    config: productionAiConfig(),
    context: storyContext,
  });

  assert.deepEqual(requestedRevisions, [12, 13]);
  assert.equal(queued.state.enrichment_status, "pending");
});

test("malformed provider responses are rejected safely", () => {
  assert.throws(() => validateProviderResult(AI_OPERATIONS.ENRICH_STORY, { output: { invented: true } }), /Invalid input|expected/i);
  assert.throws(() => storyEnrichmentResultSchema.parse({ ...validEnrichment, extra: "not allowed" }));
});

test("provider failure cannot erase a completed deterministic ingestion result", async () => {
  const coreResult = { runId: "run-1", status: "succeeded", inserted: 12 };
  const result = await runOptionalAiLayer({ enabled: true, coreResult, runAi: async () => { throw new Error("provider outage"); } });
  assert.equal(result.status, "succeeded");
  assert.equal(result.inserted, 12);
  assert.equal(result.ai.status, "failed");
});

test("AI-disabled pipeline never invokes an AI runner", async () => {
  let providerRunners = 0;
  let housekeepingRuns = 0;
  const housekeeping = { staleEnrichmentCleanup: { expired: 1, failed: false }, staleAnalysisCleanup: { expired: 2, failed: false } };
  const result = await runOptionalAiLayer({
    enabled: false,
    coreResult: { status: "succeeded" },
    runHousekeeping: async () => { housekeepingRuns += 1; return housekeeping; },
    runAi: async () => { providerRunners += 1; },
  });
  assert.equal(providerRunners, 0);
  assert.equal(housekeepingRuns, 1);
  assert.equal(result.ai.status, "disabled");
  assert.deepEqual(result.ai.housekeeping, housekeeping);
});

test("bounded story batch honors priority and never calls deep analysis automatically", async () => {
  const counters = { enrich: 0, compare: 0 };
  const fakeProvider = {
    async enrichStory() { counters.enrich += 1; return { output: validEnrichment }; },
    async compareStorySources() { counters.compare += 1; return { output: {} }; },
  };
  const candidates = [
    { id: "ordinary", last_activity_at: "2026-08-20T00:00:00Z", source_count: 1 },
    { id: "kept", last_activity_at: "2026-08-20T00:00:00Z", source_count: 1, editorial_queue: { status: "keep" } },
    { id: "requested", requested_at: "2026-08-22T00:00:00Z", last_enriched_at: "2026-08-21T00:00:00Z", last_activity_at: "2026-08-20T00:00:00Z", source_count: 1 },
  ];
  const visited = [];
  const result = await runBoundedAiBatch({ candidates, maxStories: 2, processStory: async (candidate) => {
    visited.push(candidate.id);
    await fakeProvider.enrichStory(context());
    return { storyId: candidate.id, status: "succeeded" };
  } });
  assert.deepEqual(visited, ["requested", "kept"]);
  assert.equal(result.attempted, 2);
  assert.deepEqual(counters, { enrich: 2, compare: 0 });
});

test("provider implementation is replaceable and structured output is validated", async () => {
  const fakeClient = { responses: { parse: async () => ({ id: "resp-test", model: "fixture-model", output_parsed: validEnrichment, usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 } }) } };
  const { provider, capability } = createStoryEnrichmentProvider({ aiEnabled: true, aiProvider: "openai", aiModel: "gpt-5-mini", aiEnrichmentVersion: "1", aiTimeoutMs: 1000, aiMaxStoriesPerRun: 3 }, { client: fakeClient, env: {} });
  const response = validateProviderResult(AI_OPERATIONS.ENRICH_STORY, await provider.enrichStory(context()));
  assert.equal(capability.status, "available");
  assert.equal(response.output.enrichment.event_type, "ordinance");
  assert.equal(response.usage.total_tokens, 30);
});

test("provider null structured output retains response metadata for rejection accounting", async () => {
  const fakeClient = { responses: { parse: async () => ({
    id: "resp-rejected",
    model: "fixture-model-version",
    output_parsed: null,
    usage: { input_tokens: 8, output_tokens: 2, total_tokens: 10, output_tokens_details: { reasoning_tokens: 1 } },
  }) } };
  const { provider } = createStoryEnrichmentProvider(productionAiConfig({ aiProvider: "openai", aiModel: "gpt-5-mini" }), { client: fakeClient, env: {} });
  const response = await provider.enrichStory(context());
  assert.equal(response.output, null);
  assert.equal(response.requestId, "resp-rejected");
  assert.equal(response.modelVersion, "fixture-model-version");
  assert.equal(response.usage.total_tokens, 10);
  assert.throws(() => validateProviderResult(AI_OPERATIONS.ENRICH_STORY, response));
});

test("Compare Sources schema requires structured source-linked claims", () => {
  const output = {
    agreements: [{ claim: "Both sources report a council vote.", source_item_ids: ["11111111-1111-4111-8111-111111111111"] }],
    differences: [], primary_source_claims: [], disputed_claims: [], unknowns: ["Effective date"],
    development_summary: "A second source independently confirmed the vote.", confidence: 0.8,
  };
  assert.doesNotThrow(() => sourceComparisonSchema.parse(output));
  assert.doesNotThrow(() => validateSourceComparisonProvenance(context(), output));
  assert.throws(() => validateSourceComparisonProvenance(context(), {
    ...output,
    differences: [{ claim: "Invented citation", source_item_ids: ["22222222-2222-4222-8222-222222222222"] }],
  }), /not attached/i);
});

test("AI cache key changes with provider, model, or schema controls", () => {
  const fingerprint = storyInputFingerprint(context());
  const key = (model) => aiCacheKey({ operation: "enrich_story", fingerprint, enrichmentVersion: "1", schemaVersion: "1", promptVersion: "p1", provider: "openai", model });
  assert.match(key("gpt-5-mini"), /^[0-9a-f]{64}$/);
  assert.notEqual(key("gpt-5-mini"), key("gpt-5"));
});

test("JSON/API source adapter uses declarative field mapping without AI", () => {
  const [item] = parseSourcePayload({
    name: "API Fixture", feed_url: "https://api.example.test/news", ingestion_method: "api",
    adapter_config: { itemsPath: "payload.records", fields: { headline: "label", url: "links.web", guid: "record_id", publishedAt: "when" } },
  }, JSON.stringify({ payload: { records: [{ record_id: "r1", label: "Trenton opens cooling centers", links: { web: "https://api.example.test/items/1?utm_source=x" }, when: "2026-08-22T01:00:00Z", summary: "Locations are open." }] } }));
  assert.equal(item.externalGuid, "r1");
  assert.equal(item.canonicalUrl, "https://api.example.test/items/1");
  assert.equal(item.rawMetadata.feedType, "api");
});

test("production editor enrichment request only queues and never invokes the provider", async () => {
  const storyContext = context();
  const rpcCalls = [];
  const inserts = [];
  const providerCalls = { enrich: 0, compare: 0 };
  const provider = {
    name: "fixture",
    model: "fixture-model",
    async enrichStory() { providerCalls.enrich += 1; throw new Error("Editor request must not call the provider"); },
    async compareStorySources() { providerCalls.compare += 1; throw new Error("Editor request must not call the provider"); },
  };
  const supabase = fakeStorySupabase({
    contexts: { [storyContext.story.id]: storyContext },
    async onQuery(table) {
      if (table === "story_ai_state") return null;
      return undefined;
    },
    async onRpc(name, params) {
      rpcCalls.push({ name, params });
      if (name === "request_story_ai_enrichment") return { requested_generation: 7 };
      throw new Error(`Unexpected RPC ${name}`);
    },
    async onInsert(table, payload) {
      inserts.push({ table, payload });
      if (table === "editorial_decisions") return payload;
      throw new Error(`Unexpected insert into ${table}`);
    },
  });

  const result = await requestStoryAiEnrichment({
    supabase,
    config: productionAiConfig(),
    storyId: storyContext.story.id,
    identity: { id: "editor-1", email: "editor@example.test", role: "editor" },
    providerOverride: provider,
  });

  assert.deepEqual(result, {
    storyId: storyContext.story.id,
    status: "queued",
    generation: 7,
    coalesced: false,
    dispatchRequired: true,
    auditRecorded: true,
  });
  assert.deepEqual(providerCalls, { enrich: 0, compare: 0 });
  assert.deepEqual(rpcCalls.map(({ name }) => name), ["request_story_ai_enrichment"]);
  assert.equal(rpcCalls[0].params.p_force, true);
  assert.deepEqual(inserts.map(({ table }) => table), ["editorial_decisions"]);
});

test("production editor enrichment reuses a matching success inside the cooldown without queueing or calling the provider", async () => {
  const storyContext = context();
  const config = productionAiConfig();
  const fingerprint = storyInputFingerprint(storyContext);
  const cacheKey = aiCacheKey({
    operation: AI_OPERATIONS.ENRICH_STORY,
    fingerprint,
    enrichmentVersion: config.aiEnrichmentVersion,
    schemaVersion: "1",
    promptVersion: "enrich-story-v1",
    provider: config.aiProvider,
    model: config.aiModel,
  });
  const inserts = [];
  const rpcCalls = [];
  let providerCalls = 0;
  const supabase = fakeStorySupabase({
    contexts: { [storyContext.story.id]: storyContext },
    async onQuery(table) {
      if (table === "story_ai_state") {
        return {
          enrichment_status: "succeeded",
          requested_generation: 5,
          successful_generation: 5,
          current_evidence_revision: 12,
          current_input_fingerprint: fingerprint,
          current_cache_key: cacheKey,
          last_enriched_at: new Date().toISOString(),
        };
      }
      return undefined;
    },
    async onRpc(name, params) {
      rpcCalls.push({ name, params });
      if (name === "record_story_ai_enrichment_cache_hit") return { id: "cache-hit-call-1" };
      throw new Error(`Cooldown cache hit must not call RPC ${name}`);
    },
    async onInsert(table, payload) {
      inserts.push({ table, payload });
      if (table === "editorial_decisions") return payload;
      throw new Error(`Unexpected insert into ${table}`);
    },
  });
  const provider = {
    name: config.aiProvider,
    model: config.aiModel,
    async enrichStory() { providerCalls += 1; throw new Error("Cooldown cache hit must not call the provider"); },
  };

  const result = await requestStoryAiEnrichment({
    supabase,
    config,
    storyId: storyContext.story.id,
    identity: { id: "editor-1", email: "editor@example.test", role: "editor" },
    providerOverride: provider,
  });

  assert.equal(result.status, "cached");
  assert.equal(result.generation, 5);
  assert.equal(result.callAttemptId, "cache-hit-call-1");
  assert.equal(result.dispatchRequired, false);
  assert.ok(result.retryAfterSeconds >= 1 && result.retryAfterSeconds <= 60);
  assert.equal(result.auditRecorded, true);
  assert.equal(providerCalls, 0);
  assert.deepEqual(rpcCalls.map(({ name }) => name), ["record_story_ai_enrichment_cache_hit"]);
  assert.equal(rpcCalls[0].params.p_evidence_revision, 12);
  assert.equal(rpcCalls[0].params.p_input_fingerprint, fingerprint);
  assert.equal(rpcCalls[0].params.p_cache_key, cacheKey);
  assert.deepEqual(inserts.map(({ table }) => table), ["editorial_decisions"]);
});

test("a stale atomic cooldown cache hit falls back to a revision-bound queue request", async () => {
  const storyContext = context();
  const config = productionAiConfig();
  const fingerprint = storyInputFingerprint(storyContext);
  const cacheKey = aiCacheKey({
    operation: AI_OPERATIONS.ENRICH_STORY,
    fingerprint,
    enrichmentVersion: config.aiEnrichmentVersion,
    schemaVersion: "1",
    promptVersion: "enrich-story-v1",
    provider: config.aiProvider,
    model: config.aiModel,
  });
  const rpcCalls = [];
  const supabase = fakeStorySupabase({
    contexts: { [storyContext.story.id]: storyContext },
    async onQuery(table) {
      if (table === "story_ai_state") {
        return {
          enrichment_status: "succeeded",
          requested_generation: 5,
          successful_generation: 5,
          current_evidence_revision: 12,
          current_input_fingerprint: fingerprint,
          current_cache_key: cacheKey,
          last_enriched_at: new Date().toISOString(),
        };
      }
      return undefined;
    },
    async onRpc(name, params) {
      rpcCalls.push({ name, params });
      if (name === "record_story_ai_enrichment_cache_hit") {
        const error = new Error("Story evidence changed before the cache hit was recorded");
        error.code = AI_PRECONDITION_FAILED_CODE;
        throw error;
      }
      if (name === "request_story_ai_enrichment") {
        return { enrichment_status: "pending", requested_generation: 6 };
      }
      throw new Error(`Unexpected RPC ${name}`);
    },
  });
  const provider = {
    name: config.aiProvider,
    model: config.aiModel,
    async enrichStory() { throw new Error("Queue-only editor requests must not call the provider"); },
  };

  const result = await requestStoryAiEnrichment({
    supabase,
    config,
    storyId: storyContext.story.id,
    identity: { id: "editor-1", email: "editor@example.test", role: "editor" },
    providerOverride: provider,
  });

  assert.equal(result.status, "queued");
  assert.equal(result.generation, 6);
  assert.equal(result.dispatchRequired, true);
  assert.deepEqual(rpcCalls.map(({ name }) => name), [
    "record_story_ai_enrichment_cache_hit",
    "request_story_ai_enrichment",
  ]);
  assert.equal(rpcCalls[1].params.p_evidence_revision, 12);
});

test("production source comparison uses one durable request RPC for replacement, coalescing, and cache hits", async () => {
  const secondSource = {
    id: "22222222-2222-4222-8222-222222222222",
    source_id: "source-b",
    content_hash: "b".repeat(64),
    normalized_headline: "council advances housing rule",
    headline: "Council advances housing rule",
    description: "A second account of the proposal",
    publisher: "Second Fixture",
    canonical_url: "https://fixture.example/b",
    published_at: "2026-08-22T01:00:00Z",
  };
  const storyContext = context([...context().sourceItems, secondSource]);
  const config = productionAiConfig();
  const fingerprint = storyInputFingerprint(storyContext);
  const cacheKey = aiCacheKey({
    operation: AI_OPERATIONS.COMPARE_SOURCES,
    fingerprint,
    enrichmentVersion: config.aiEnrichmentVersion,
    schemaVersion: "1",
    promptVersion: "compare-sources-v1",
    provider: config.aiProvider,
    model: config.aiModel,
  });
  let providerCalls = 0;
  const provider = {
    name: config.aiProvider,
    model: config.aiModel,
    async compareStorySources() { providerCalls += 1; throw new Error("Queueing must not call the provider"); },
  };
  const identity = { id: "editor-1", email: "editor@example.test", role: "editor" };
  const replacementRpcCalls = [];
  const replacementInserts = [];
  const replacementSupabase = fakeStorySupabase({
    contexts: { [storyContext.story.id]: storyContext },
    async onRpc(name, params) {
      replacementRpcCalls.push({ name, params });
      if (name === "request_story_analysis_attempt") {
        return { id: "replacement-analysis-call", status: "queued", superseded_call_attempt_id: "stale-analysis-call" };
      }
      throw new Error(`Unexpected RPC ${name}`);
    },
    async onInsert(table, payload) {
      replacementInserts.push({ table, payload });
      if (table === "editorial_decisions") return payload;
      throw new Error(`Unexpected insert into ${table}`);
    },
  });

  const replacement = await queueStorySourceComparison({
    supabase: replacementSupabase,
    config,
    storyId: storyContext.story.id,
    identity,
    providerOverride: provider,
  });

  assert.deepEqual(replacement, {
    status: "queued",
    callAttemptId: "replacement-analysis-call",
    dispatchRequired: true,
    auditRecorded: true,
  });
  assert.deepEqual(replacementRpcCalls.map(({ name }) => name), ["request_story_analysis_attempt"]);
  assert.equal(replacementRpcCalls[0].params.p_input_fingerprint, fingerprint);
  assert.equal(replacementRpcCalls[0].params.p_cache_key, cacheKey);
  assert.equal(replacementRpcCalls[0].params.p_enrichment_version, config.aiEnrichmentVersion);
  assert.equal(replacementRpcCalls[0].params.p_provider, config.aiProvider);
  assert.equal(replacementRpcCalls[0].params.p_model, config.aiModel);
  assert.deepEqual(replacementInserts.map(({ table }) => table), ["editorial_decisions"]);

  const matchingRpcCalls = [];
  const matchingInserts = [];
  const matchingSupabase = fakeStorySupabase({
    contexts: { [storyContext.story.id]: storyContext },
    async onRpc(name, params) {
      matchingRpcCalls.push({ name, params });
      if (name === "request_story_analysis_attempt") return { id: "matching-analysis-call", status: "running" };
      throw new Error(`Matching identity must not call RPC ${name}`);
    },
    async onInsert(table, payload) {
      matchingInserts.push({ table, payload });
      if (table === "editorial_decisions") return payload;
      throw new Error(`Matching identity must not insert into ${table}`);
    },
  });

  const coalesced = await queueStorySourceComparison({
    supabase: matchingSupabase,
    config,
    storyId: storyContext.story.id,
    identity,
    providerOverride: provider,
  });

  assert.deepEqual(coalesced, {
    status: "running",
    callAttemptId: "matching-analysis-call",
    coalesced: true,
    dispatchRequired: false,
    auditRecorded: true,
  });
  assert.deepEqual(matchingRpcCalls.map(({ name }) => name), ["request_story_analysis_attempt"]);
  assert.deepEqual(matchingInserts.map(({ table }) => table), ["editorial_decisions"]);

  const cachedQueries = [];
  const cachedRpcCalls = [];
  const cachedAnalysis = { id: "cached-analysis-1", story_id: storyContext.story.id, result: { development_summary: "Cached" } };
  const cachedSupabase = fakeStorySupabase({
    contexts: { [storyContext.story.id]: storyContext },
    async onQuery(table, filters) {
      cachedQueries.push(table);
      if (table === "story_analyses") {
        assert.equal(filters.get("id"), cachedAnalysis.id);
        assert.equal(filters.get("story_id"), storyContext.story.id);
        return cachedAnalysis;
      }
      return undefined;
    },
    async onRpc(name, params) {
      cachedRpcCalls.push({ name, params });
      if (name === "request_story_analysis_attempt") {
        return { id: "comparison-cache-hit-call", status: "cache_hit", cached_from_analysis_id: cachedAnalysis.id };
      }
      throw new Error(`Cache hit must not call RPC ${name}`);
    },
    async onInsert(table, payload) {
      if (table === "editorial_decisions") return payload;
      throw new Error(`Cache hit must not insert into ${table}`);
    },
  });

  const cached = await queueStorySourceComparison({
    supabase: cachedSupabase,
    config,
    storyId: storyContext.story.id,
    identity,
    providerOverride: provider,
  });

  assert.equal(cached.status, "cached");
  assert.equal(cached.callAttemptId, "comparison-cache-hit-call");
  assert.equal(cached.dispatchRequired, false);
  assert.equal(cached.analysis, cachedAnalysis);
  assert.deepEqual(cachedRpcCalls.map(({ name }) => name), ["request_story_analysis_attempt"]);
  assert.equal(cachedQueries.filter((table) => table === "story_analyses").length, 1);
  assert.equal(providerCalls, 0);
});

test("production enrichment releases a claim when context validation fails before the provider call", async () => {
  const storyContext = context();
  const rpcCalls = [];
  let providerCalls = 0;
  const supabase = fakeStorySupabase({
    contexts: { [storyContext.story.id]: storyContext },
    async onRpc(name, params) {
      rpcCalls.push({ name, params });
      if (name === "release_story_ai_enrichment_claim") return true;
      throw new Error(`Unexpected RPC ${name}`);
    },
    async onInsert(table) {
      throw new Error(`Pre-provider failure must not insert into ${table}`);
    },
  });
  const claim = {
    story_id: storyContext.story.id,
    lease_token: "lease-before-provider",
    claimed_input_fingerprint: "f".repeat(64),
  };

  const result = await processStoryAiClaim({
    supabase,
    provider: { async enrichStory() { providerCalls += 1; return { output: validEnrichment }; } },
    claim,
  });

  assert.equal(result.status, "failed");
  assert.equal(result.callAttemptId, null);
  assert.match(result.error, /changed before AI processing began/i);
  assert.equal(providerCalls, 0);
  assert.deepEqual(rpcCalls.map(({ name }) => name), ["release_story_ai_enrichment_claim"]);
  assert.equal(rpcCalls[0].params.p_story_id, storyContext.story.id);
  assert.equal(rpcCalls[0].params.p_lease_token, claim.lease_token);
});

test("production enrichment releases a claim queued for another AI configuration before provider use", async () => {
  const storyContext = context();
  const rpcCalls = [];
  let providerCalls = 0;
  const supabase = fakeStorySupabase({
    contexts: { [storyContext.story.id]: storyContext },
    async onRpc(name, params) {
      rpcCalls.push({ name, params });
      if (name === "release_story_ai_enrichment_claim") return true;
      throw new Error(`Unexpected RPC ${name}`);
    },
  });
  const claim = {
    story_id: storyContext.story.id,
    lease_token: "lease-old-configuration",
    enrichment_version: "1",
    schema_version: "1",
    prompt_version: "enrich-story-v1",
    provider: "fixture",
    model: "retired-fixture-model",
    claimed_input_fingerprint: storyInputFingerprint(storyContext),
  };

  const result = await processStoryAiClaim({
    supabase,
    provider: { async enrichStory() { providerCalls += 1; return { output: validEnrichment }; } },
    claim,
    config: productionAiConfig(),
  });

  assert.equal(result.status, "failed");
  assert.match(result.error, /configuration changed/i);
  assert.equal(providerCalls, 0);
  assert.deepEqual(rpcCalls.map(({ name }) => name), ["release_story_ai_enrichment_claim"]);
});

test("a lost provider-begin response is reconciled before exactly one provider call", async () => {
  const storyContext = context();
  const rpcCalls = [];
  let beginAttempts = 0;
  let providerCalls = 0;
  const supabase = fakeStorySupabase({
    contexts: { [storyContext.story.id]: storyContext },
    async onRpc(name, params) {
      rpcCalls.push({ name, params });
      if (name === "create_story_ai_call_attempt") return { id: "begin-reconcile-call", story_id: params.p_story_id };
      if (name === "begin_story_ai_provider_call") {
        beginAttempts += 1;
        if (beginAttempts === 1) throw new Error("Committed response was lost");
        return true;
      }
      if (name === "complete_story_ai_enrichment") return true;
      throw new Error(`Unexpected RPC ${name}`);
    },
  });
  const claim = {
    story_id: storyContext.story.id,
    lease_token: "begin-reconcile-lease",
    claimed_input_fingerprint: storyInputFingerprint(storyContext),
  };

  const result = await processStoryAiClaim({
    supabase,
    provider: {
      model: "fixture-model",
      async enrichStory() {
        providerCalls += 1;
        return { output: validEnrichment };
      },
    },
    claim,
  });

  assert.equal(result.status, "succeeded");
  assert.equal(beginAttempts, 2);
  assert.equal(providerCalls, 1);
  assert.deepEqual(rpcCalls.map(({ name }) => name), [
    "create_story_ai_call_attempt",
    "begin_story_ai_provider_call",
    "begin_story_ai_provider_call",
    "complete_story_ai_enrichment",
  ]);
});

test("production enrichment rejects malformed provider output and records full response metadata", async () => {
  const storyContext = context();
  const rpcCalls = [];
  let providerCalls = 0;
  const providerResponse = {
    modelVersion: "fixture-model-20260822",
    requestId: "enrichment-provider-rejected-1",
    usage: { input_tokens: 31, output_tokens: 17, total_tokens: 48, details: { fixture: "malformed" } },
    output: { invented: true },
  };
  const supabase = fakeStorySupabase({
    contexts: { [storyContext.story.id]: storyContext },
    async onRpc(name, params) {
      rpcCalls.push({ name, params });
      if (name === "create_story_ai_call_attempt") return { id: "rejected-enrichment-call", story_id: params.p_story_id };
      if (name === "begin_story_ai_provider_call") return true;
      if (name === "fail_story_ai_enrichment") return true;
      if (name === "complete_story_ai_enrichment") throw new Error("Malformed enrichment must never be completed");
      throw new Error(`Unexpected RPC ${name}`);
    },
    async onInsert(table) {
      throw new Error(`Basic enrichment must not insert directly into ${table}`);
    },
  });
  const claim = {
    story_id: storyContext.story.id,
    lease_token: "rejected-enrichment-lease",
    claimed_generation: 4,
    claimed_evidence_revision: 9,
    claimed_input_fingerprint: storyInputFingerprint(storyContext),
    current_cache_key: "d".repeat(64),
    provider: "fixture",
    model: "fixture-model",
    enrichment_version: "1",
    schema_version: "1",
    prompt_version: "enrich-story-v1",
    requested_by: "system:test",
    request_reason: "material_change",
  };

  const result = await processStoryAiClaim({
    supabase,
    provider: {
      model: "fixture-model",
      async enrichStory() {
        providerCalls += 1;
        return providerResponse;
      },
    },
    claim,
  });

  assert.equal(result.status, "rejected");
  assert.equal(result.callAttemptId, "rejected-enrichment-call");
  assert.match(result.error, /invalid input|expected/i);
  assert.equal(providerCalls, 1);
  assert.deepEqual(rpcCalls.map(({ name }) => name), [
    "create_story_ai_call_attempt",
    "begin_story_ai_provider_call",
    "fail_story_ai_enrichment",
  ]);
  const failure = rpcCalls[2].params;
  assert.equal(failure.p_story_id, storyContext.story.id);
  assert.equal(failure.p_lease_token, claim.lease_token);
  assert.equal(failure.p_call_attempt_id, "rejected-enrichment-call");
  assert.equal(failure.p_outcome, "rejected");
  assert.equal(failure.p_error_code, "ZodError");
  assert.match(failure.p_error_message, /invalid input|expected/i);
  assert.equal(failure.p_model_version, providerResponse.modelVersion);
  assert.equal(failure.p_provider_request_id, providerResponse.requestId);
  assert.equal(failure.p_input_tokens, 31);
  assert.equal(failure.p_output_tokens, 17);
  assert.equal(failure.p_total_tokens, 48);
  assert.deepEqual(failure.p_usage_metadata, { fixture: "malformed" });
  assert.ok(failure.p_latency_ms >= 0);
  assert.ok(failure.p_provider_latency_ms >= 0);
});

test("production null completions become superseded after lease-checked provider sequences", async () => {
  const enrichmentContext = context();
  const enrichmentRpcCalls = [];
  let createdCallAttemptId = null;
  let enrichmentProviderCalls = 0;
  const enrichmentSupabase = fakeStorySupabase({
    contexts: { [enrichmentContext.story.id]: enrichmentContext },
    async onRpc(name, params) {
      enrichmentRpcCalls.push({ name, params });
      if (name === "create_story_ai_call_attempt") {
        createdCallAttemptId = params.p_call_attempt_id;
        return { id: createdCallAttemptId, story_id: params.p_story_id };
      }
      if (name === "begin_story_ai_provider_call") return true;
      if (name === "complete_story_ai_enrichment") return null;
      throw new Error(`Unexpected RPC ${name}`);
    },
    async onInsert(table) {
      throw new Error(`Basic enrichment must not insert directly into ${table}`);
    },
  });
  const enrichmentClaim = {
    story_id: enrichmentContext.story.id,
    lease_token: "enrichment-null-lease",
    claimed_generation: 3,
    claimed_evidence_revision: 8,
    claimed_input_fingerprint: storyInputFingerprint(enrichmentContext),
    current_cache_key: "c".repeat(64),
    provider: "fixture",
    model: "fixture-model",
    schema_version: "1",
    prompt_version: "enrich-story-v1",
    requested_by: "system:test",
    request_reason: "material_change",
  };
  const enrichmentResult = await processStoryAiClaim({
    supabase: enrichmentSupabase,
    provider: {
      model: "fixture-model",
      async enrichStory() {
        enrichmentProviderCalls += 1;
        return { output: validEnrichment };
      },
    },
    claim: enrichmentClaim,
  });

  assert.equal(enrichmentResult.status, "superseded");
  assert.equal(enrichmentResult.callAttemptId, createdCallAttemptId);
  assert.equal(enrichmentProviderCalls, 1);
  assert.deepEqual(enrichmentRpcCalls.map(({ name }) => name), [
    "create_story_ai_call_attempt",
    "begin_story_ai_provider_call",
    "complete_story_ai_enrichment",
  ]);
  assert.equal(enrichmentRpcCalls[0].params.p_story_id, enrichmentContext.story.id);
  assert.equal(enrichmentRpcCalls[0].params.p_lease_token, enrichmentClaim.lease_token);
  assert.equal(enrichmentRpcCalls[1].params.p_call_attempt_id, createdCallAttemptId);
  assert.equal(enrichmentRpcCalls[1].params.p_story_id, enrichmentContext.story.id);
  assert.equal(enrichmentRpcCalls[1].params.p_lease_token, enrichmentClaim.lease_token);

  const secondSource = {
    id: "22222222-2222-4222-8222-222222222222",
    source_id: "source-b",
    content_hash: "b".repeat(64),
    normalized_headline: "council advances housing rule",
    headline: "Council advances housing rule",
    description: "A second account of the proposal",
    publisher: "Second Fixture",
    canonical_url: "https://fixture.example/b",
    published_at: "2026-08-22T01:00:00Z",
  };
  const analysisContext = context([...context().sourceItems, secondSource]);
  const analysisRpcCalls = [];
  const analysisSupabase = fakeStorySupabase({
    contexts: { [analysisContext.story.id]: analysisContext },
    async onRpc(name, params) {
      analysisRpcCalls.push({ name, params });
      if (name === "begin_story_analysis_provider_call") return true;
      if (name === "complete_story_analysis") return null;
      throw new Error(`Unexpected RPC ${name}`);
    },
  });
  const analysisClaim = {
    id: "analysis-null-call",
    story_id: analysisContext.story.id,
    operation_type: AI_OPERATIONS.COMPARE_SOURCES,
    lease_token: "analysis-null-lease",
    input_fingerprint: storyInputFingerprint(analysisContext),
    started_at: "2026-08-22T02:00:00Z",
  };
  const analysisResult = await processStoryAnalysisClaim({
    supabase: analysisSupabase,
    provider: {
      model: "fixture-model",
      async compareStorySources() {
        return {
          output: {
            agreements: [{ claim: "Both sources cover the proposal.", source_item_ids: analysisContext.sourceItems.map(({ id }) => id) }],
            differences: [],
            primary_source_claims: [],
            disputed_claims: [],
            unknowns: ["The final implementation date"],
            development_summary: "A second source independently covered the proposal.",
            confidence: 0.8,
          },
        };
      },
    },
    claim: analysisClaim,
  });

  assert.equal(analysisResult.status, "superseded");
  assert.equal(analysisResult.analysis, null);
  assert.deepEqual(analysisRpcCalls.map(({ name }) => name), ["begin_story_analysis_provider_call", "complete_story_analysis"]);
});

test("production editor analysis drains one queued successor immediately after a superseded completion", async () => {
  const secondSource = {
    id: "22222222-2222-4222-8222-222222222222",
    source_id: "source-b",
    content_hash: "b".repeat(64),
    normalized_headline: "council advances housing rule",
    headline: "Council advances housing rule",
    description: "A second account of the proposal",
    publisher: "Second Fixture",
    canonical_url: "https://fixture.example/b",
    published_at: "2026-08-22T01:00:00Z",
  };
  const storyContext = context([...context().sourceItems, secondSource]);
  const config = productionAiConfig();
  const oldCallAttemptId = "analysis-old-call";
  const successorCallAttemptId = "analysis-successor-call";
  const fingerprint = storyInputFingerprint(storyContext);
  const claim = (id, leaseToken) => ({
    id,
    story_id: storyContext.story.id,
    operation_type: AI_OPERATIONS.COMPARE_SOURCES,
    lease_token: leaseToken,
    input_fingerprint: fingerprint,
    enrichment_version: config.aiEnrichmentVersion,
    provider: config.aiProvider,
    model: config.aiModel,
    schema_version: "1",
    prompt_version: "compare-sources-v1",
    started_at: "2026-08-22T02:00:00Z",
  });
  const claims = new Map([
    [oldCallAttemptId, claim(oldCallAttemptId, "old-analysis-lease")],
    [successorCallAttemptId, claim(successorCallAttemptId, "successor-analysis-lease")],
  ]);
  const events = [];
  const claimRequests = [];
  let successorLoads = 0;
  const successorAnalysis = { id: "successor-analysis-result", story_id: storyContext.story.id };
  const supabase = fakeStorySupabase({
    contexts: { [storyContext.story.id]: storyContext },
    async onQuery(table, filters) {
      if (table === "ai_call_attempts") {
        successorLoads += 1;
        events.push("load-successor");
        assert.equal(filters.get("story_id"), storyContext.story.id);
        assert.equal(filters.get("operation_type"), AI_OPERATIONS.COMPARE_SOURCES);
        assert.equal(filters.get("status"), "queued");
        return { id: successorCallAttemptId };
      }
      return undefined;
    },
    async onRpc(name, params) {
      if (name === "claim_story_analysis_attempt") {
        claimRequests.push({ callAttemptId: params.p_call_attempt_id, worker: params.p_worker });
        events.push(`claim-${params.p_call_attempt_id}`);
        return claims.get(params.p_call_attempt_id) || null;
      }
      if (name === "begin_story_analysis_provider_call") {
        events.push(`begin-${params.p_call_attempt_id}`);
        return true;
      }
      if (name === "complete_story_analysis") {
        events.push(`complete-${params.p_call_attempt_id}`);
        return params.p_call_attempt_id === oldCallAttemptId ? null : successorAnalysis;
      }
      throw new Error(`Unexpected RPC ${name}`);
    },
    async onInsert(table) {
      throw new Error(`Queued analysis processing must not insert directly into ${table}`);
    },
  });
  let providerCalls = 0;
  const provider = {
    name: config.aiProvider,
    model: config.aiModel,
    async compareStorySources() {
      providerCalls += 1;
      events.push(`provider-${providerCalls}`);
      return {
        output: {
          agreements: [{ claim: "Both sources cover the proposal.", source_item_ids: storyContext.sourceItems.map(({ id }) => id) }],
          differences: [],
          primary_source_claims: [],
          disputed_claims: [],
          unknowns: ["The final implementation date"],
          development_summary: "A second source independently covered the proposal.",
          confidence: 0.8,
        },
      };
    },
  };

  const result = await processQueuedStoryAnalysis({
    supabase,
    config,
    callAttemptId: oldCallAttemptId,
    providerOverride: provider,
    worker: "editor-analysis-worker",
    drainSuccessor: true,
  });

  assert.equal(result.status, "superseded");
  assert.equal(result.callAttemptId, oldCallAttemptId);
  assert.equal(result.successor.status, "succeeded");
  assert.equal(result.successor.callAttemptId, successorCallAttemptId);
  assert.equal(result.successor.analysis, successorAnalysis);
  assert.equal(Object.hasOwn(result.successor, "successor"), false);
  assert.equal(providerCalls, 2);
  assert.equal(successorLoads, 1);
  assert.deepEqual(claimRequests, [
    { callAttemptId: oldCallAttemptId, worker: "editor-analysis-worker" },
    { callAttemptId: successorCallAttemptId, worker: "editor-analysis-worker" },
  ]);
  assert.deepEqual(events, [
    `claim-${oldCallAttemptId}`,
    `begin-${oldCallAttemptId}`,
    "provider-1",
    `complete-${oldCallAttemptId}`,
    "load-successor",
    `claim-${successorCallAttemptId}`,
    `begin-${successorCallAttemptId}`,
    "provider-2",
    `complete-${successorCallAttemptId}`,
  ]);
});

test("production source comparison rejects malformed provenance and records the provider outcome without completing", async () => {
  const secondSource = {
    id: "22222222-2222-4222-8222-222222222222",
    source_id: "source-b",
    content_hash: "b".repeat(64),
    normalized_headline: "council advances housing rule",
    headline: "Council advances housing rule",
    description: "A second account of the proposal",
    publisher: "Second Fixture",
    canonical_url: "https://fixture.example/b",
    published_at: "2026-08-22T01:00:00Z",
  };
  const storyContext = context([...context().sourceItems, secondSource]);
  const hallucinatedSourceId = "99999999-9999-4999-8999-999999999999";
  const rpcCalls = [];
  let providerCalls = 0;
  const supabase = fakeStorySupabase({
    contexts: { [storyContext.story.id]: storyContext },
    async onRpc(name, params) {
      rpcCalls.push({ name, params });
      if (name === "begin_story_analysis_provider_call") return true;
      if (name === "fail_story_analysis_attempt") return true;
      if (name === "complete_story_analysis") throw new Error("Hallucinated provenance must never be completed");
      throw new Error(`Unexpected RPC ${name}`);
    },
  });
  const provider = {
    model: "fixture-model",
    async compareStorySources() {
      providerCalls += 1;
      return {
        modelVersion: "fixture-model-20260822",
        requestId: "provider-request-rejected-1",
        usage: { input_tokens: 21, output_tokens: 13, total_tokens: 34, details: { fixture: true } },
        output: {
          agreements: [],
          differences: [{ claim: "An unsupported difference", source_item_ids: [hallucinatedSourceId] }],
          primary_source_claims: [],
          disputed_claims: [],
          unknowns: ["The final ordinance text"],
          development_summary: "The sources differ on implementation details.",
          confidence: 0.5,
        },
      };
    },
  };
  const claim = {
    id: "analysis-call-1",
    story_id: storyContext.story.id,
    operation_type: AI_OPERATIONS.COMPARE_SOURCES,
    lease_token: "analysis-lease",
    input_fingerprint: storyInputFingerprint(storyContext),
    started_at: "2026-08-22T02:00:00Z",
  };

  const result = await processStoryAnalysisClaim({ supabase, provider, claim });

  assert.equal(result.status, "rejected");
  assert.match(result.error, /not attached/i);
  assert.equal(providerCalls, 1);
  assert.deepEqual(rpcCalls.map(({ name }) => name), ["begin_story_analysis_provider_call", "fail_story_analysis_attempt"]);
  assert.equal(rpcCalls[0].params.p_call_attempt_id, claim.id);
  assert.equal(rpcCalls[1].params.p_call_attempt_id, claim.id);
  assert.equal(rpcCalls[1].params.p_lease_token, claim.lease_token);
  assert.equal(rpcCalls[1].params.p_outcome, "rejected");
  assert.equal(rpcCalls[1].params.p_error_code, "AIProvenanceError");
  assert.match(rpcCalls[1].params.p_error_message, /not attached/i);
  assert.equal(rpcCalls[1].params.p_model_version, "fixture-model-20260822");
  assert.equal(rpcCalls[1].params.p_provider_request_id, "provider-request-rejected-1");
  assert.equal(rpcCalls[1].params.p_input_tokens, 21);
  assert.equal(rpcCalls[1].params.p_output_tokens, 13);
  assert.equal(rpcCalls[1].params.p_total_tokens, 34);
  assert.deepEqual(rpcCalls[1].params.p_usage_metadata, { fixture: true });
  assert.ok(rpcCalls[1].params.p_latency_ms >= 0);
  assert.ok(rpcCalls[1].params.p_provider_latency_ms >= 0);
});

test("scheduled configuration reconciliation cannot overwrite AI state changed after the batch began", async () => {
  const storyId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5";
  const firstSource = context().sourceItems[0];
  const reviewedAssessment = (group) => ({
    assessment_status: "reviewed",
    evidence_role: "independent_journalism",
    corroboration_group_key: group,
    verification_tier: 2,
    assessed_at: "2026-08-22T00:00:00Z",
    superseded_at: null,
  });
  const storyContext = withStoryId(context([
    { ...firstSource, sources: { id: "source-a", source_assessments: [reviewedAssessment("newsroom-a")] } },
    {
      ...firstSource,
      id: "22222222-2222-4222-8222-222222222222",
      source_id: "source-b",
      content_hash: "b".repeat(64),
      sources: { id: "source-b", source_assessments: [reviewedAssessment("newsroom-b")] },
    },
  ]), storyId);
  const cutoff = "2026-08-22T02:00:00.000Z";
  const observedUpdatedAt = "2026-08-22T01:59:00.000Z";
  let queueCalls = 0;
  const supabase = fakeStorySupabase({
    contexts: { [storyId]: storyContext },
    async onQuery(table, filters) {
      if (table !== "story_ai_state") return undefined;
      assert.equal(filters.get("updated_at"), cutoff);
      if (!filters.has("enrichment_version")) return [];
      return [{
        story_id: storyId,
        priority: 80,
        requested_at: "2026-08-22T01:00:00.000Z",
        updated_at: observedUpdatedAt,
        enrichment_version: "0",
        schema_version: "1",
        prompt_version: "enrich-story-v1",
        provider: "fixture",
        model: "fixture-model",
      }];
    },
    async onRpc(name, params) {
      if (name === "list_story_ai_revision_mismatches") {
        assert.deepEqual(params, { p_limit: 3, p_updated_before: cutoff });
        return [];
      }
      if (name === "request_story_ai_enrichment") {
        queueCalls += 1;
        assert.equal(params.p_expected_state_updated_at, observedUpdatedAt);
        const error = new Error("Story AI state changed after selection");
        error.code = AI_PRECONDITION_FAILED_CODE;
        throw error;
      }
      throw new Error(`Unexpected RPC ${name}`);
    },
  });

  const result = await queueAiConfigurationChanges({
    supabase,
    config: productionAiConfig(),
    configurationCutoff: cutoff,
  });

  assert.equal(queueCalls, 1);
  assert.deepEqual(result, { considered: 1, queued: 0, skipped: 1, failed: 0 });
});

test("scheduled recovery reserves editor comparison capacity ahead of basic backlog", async () => {
  const deepStoryId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
  const basicStoryId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4";
  const firstSource = context().sourceItems[0];
  const secondSource = {
    ...firstSource,
    id: "22222222-2222-4222-8222-222222222222",
    source_id: "source-b",
    content_hash: "b".repeat(64),
    headline: "Second outlet covers Trenton housing ordinance",
    canonical_url: "https://fixture.example/b",
  };
  const deepContext = withStoryId(context([firstSource, secondSource]), deepStoryId);
  const basicContext = withStoryId(context(), basicStoryId);
  const deepCall = {
    id: "deep-priority-call",
    story_id: deepStoryId,
    operation_type: AI_OPERATIONS.COMPARE_SOURCES,
    lease_token: "deep-priority-lease",
    evidence_revision: 12,
    input_fingerprint: storyInputFingerprint(deepContext),
    enrichment_version: "1",
    provider: "fixture",
    model: "fixture-model",
    schema_version: "1",
    prompt_version: "compare-sources-v1",
    started_at: "2026-08-22T02:00:00Z",
  };
  const basicClaim = {
    story_id: basicStoryId,
    lease_token: "basic-priority-lease",
    claimed_generation: 1,
    claimed_evidence_revision: 12,
    claimed_input_fingerprint: storyInputFingerprint(basicContext),
    enrichment_version: "1",
    provider: "fixture",
    model: "fixture-model",
    schema_version: "1",
    prompt_version: "enrich-story-v1",
  };
  const events = [];
  const supabase = fakeStorySupabase({
    contexts: { [deepStoryId]: deepContext, [basicStoryId]: basicContext },
    async onQuery(table, filters) {
      if (table === "story_ai_state") return [];
      if (table === "ai_call_attempts") {
        assert.equal(filters.get("enrichment_version"), "1");
        assert.equal(filters.get("provider"), "fixture");
        assert.equal(filters.get("model"), "fixture-model");
        assert.equal(filters.get("schema_version"), "1");
        assert.equal(filters.get("prompt_version"), "compare-sources-v1");
        return [{ id: deepCall.id }];
      }
      return undefined;
    },
    async onRpc(name, params) {
      if (["expire_stale_story_ai_enrichments", "expire_stale_story_analysis_attempts"].includes(name)) return 0;
      if (name === "list_story_ai_revision_mismatches") {
        assert.equal(params.p_limit, 2);
        assert.match(params.p_updated_before, /^\d{4}-\d{2}-\d{2}T/);
        return [];
      }
      if (name === "claim_story_analysis_attempt") {
        events.push("claim-deep");
        assert.equal(params.p_enrichment_version, "1");
        assert.equal(params.p_provider, "fixture");
        assert.equal(params.p_model, "fixture-model");
        return deepCall;
      }
      if (name === "begin_story_analysis_provider_call") { events.push("begin-deep"); return true; }
      if (name === "complete_story_analysis") { events.push("complete-deep"); return { id: "deep-analysis-result" }; }
      if (name === "claim_story_ai_enrichments") { events.push("claim-basic"); return [basicClaim]; }
      if (name === "create_story_ai_call_attempt") { events.push("attempt-basic"); return { id: "basic-priority-call" }; }
      if (name === "begin_story_ai_provider_call") { events.push("begin-basic"); return true; }
      if (name === "complete_story_ai_enrichment") { events.push("complete-basic"); return true; }
      throw new Error(`Unexpected RPC ${name}`);
    },
  });
  const provider = {
    name: "fixture",
    model: "fixture-model",
    async compareStorySources() {
      events.push("provider-deep");
      return {
        output: {
          agreements: [{ claim: "Both sources cover the proposal.", source_item_ids: deepContext.sourceItems.map(({ id }) => id) }],
          differences: [], primary_source_claims: [], disputed_claims: [], unknowns: [],
          development_summary: "A second source independently covered the proposal.", confidence: 0.8,
        },
      };
    },
    async enrichStory() { events.push("provider-basic"); return { output: validEnrichment }; },
  };

  const result = await runStoryAiEnrichmentBatch({
    supabase,
    config: productionAiConfig({ aiMaxStoriesPerRun: 2 }),
    providerOverride: provider,
  });

  assert.equal(result.attempted, 2);
  assert.equal(result.analyses[0].status, "succeeded");
  assert.equal(result.results[0].status, "succeeded");
  assert.ok(events.indexOf("provider-deep") < events.indexOf("claim-basic"));
});

test("production scheduled enrichment claims one story just in time before processing the next", async () => {
  const firstStoryId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
  const secondStoryId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
  const firstContext = withStoryId(context(), firstStoryId);
  const secondContext = withStoryId(context(), secondStoryId);
  const claims = [firstContext, secondContext].map((storyContext, index) => ({
    story_id: storyContext.story.id,
    lease_token: `lease-${index + 1}`,
    claimed_generation: index + 1,
    claimed_evidence_revision: index + 10,
    claimed_input_fingerprint: storyInputFingerprint(storyContext),
    current_cache_key: String(index + 1).repeat(64),
    provider: "fixture",
    model: "fixture-model",
    enrichment_version: "1",
    schema_version: "1",
    prompt_version: "enrich-story-v1",
    requested_by: "system:test",
    request_reason: "material_change",
  }));
  const events = [];
  const claimLimits = [];
  const revisionMismatchLimits = [];
  let nextClaim = 0;
  const supabase = fakeStorySupabase({
    contexts: { [firstStoryId]: firstContext, [secondStoryId]: secondContext },
    async onQuery(table) {
      if (table === "story_ai_state") return [];
      if (table === "ai_call_attempts") return [];
      return undefined;
    },
    async onRpc(name, params) {
      if (name === "expire_stale_story_ai_enrichments") return 0;
      if (name === "expire_stale_story_analysis_attempts") return 0;
      if (name === "list_story_ai_revision_mismatches") {
        revisionMismatchLimits.push(params.p_limit);
        assert.match(params.p_updated_before, /^\d{4}-\d{2}-\d{2}T/);
        return [];
      }
      if (name === "claim_story_ai_enrichments") {
        assert.equal(params.p_enrichment_version, "1");
        assert.equal(params.p_schema_version, "1");
        assert.equal(params.p_prompt_version, "enrich-story-v1");
        assert.equal(params.p_provider, "fixture");
        assert.equal(params.p_model, "fixture-model");
        claimLimits.push(params.p_limit);
        const claim = claims[nextClaim];
        if (nextClaim > 0) assert.ok(events.includes(`complete-${firstStoryId}`), "second Story was claimed before the first completed");
        nextClaim += 1;
        events.push(`claim-${claim.story_id}`);
        return [claim];
      }
      if (name === "create_story_ai_call_attempt") {
        events.push(`attempt-${params.p_story_id}`);
        return { id: params.p_call_attempt_id, story_id: params.p_story_id };
      }
      if (name === "begin_story_ai_provider_call") {
        events.push(`begin-${params.p_story_id}`);
        return true;
      }
      if (name === "complete_story_ai_enrichment") {
        events.push(`complete-${params.p_story_id}`);
        return true;
      }
      throw new Error(`Unexpected RPC ${name}`);
    },
    async onInsert(table) {
      throw new Error(`Basic enrichment must not insert directly into ${table}`);
    },
  });
  const provider = {
    name: "fixture",
    model: "fixture-model",
    async enrichStory(storyContext) {
      events.push(`provider-${storyContext.story.id}`);
      return { output: validEnrichment };
    },
  };

  const result = await runStoryAiEnrichmentBatch({
    supabase,
    config: productionAiConfig({ aiMaxStoriesPerRun: 2 }),
    providerOverride: provider,
  });

  assert.equal(result.status, "succeeded");
  assert.equal(result.attempted, 2);
  assert.deepEqual(claimLimits, [1, 1]);
  assert.deepEqual(revisionMismatchLimits, [2]);
  assert.deepEqual(events, [
    `claim-${firstStoryId}`,
    `attempt-${firstStoryId}`,
    `begin-${firstStoryId}`,
    `provider-${firstStoryId}`,
    `complete-${firstStoryId}`,
    `claim-${secondStoryId}`,
    `attempt-${secondStoryId}`,
    `begin-${secondStoryId}`,
    `provider-${secondStoryId}`,
    `complete-${secondStoryId}`,
  ]);
});
