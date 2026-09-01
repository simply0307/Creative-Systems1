import { randomUUID } from "node:crypto";

import { AI_OPERATIONS, aiCacheKey, needsAiConfigurationRefresh, storyInputFingerprint, validateProviderResult, validateSourceComparisonProvenance } from "./ai-core.mjs";
import { createStoryEnrichmentProvider } from "./ai-provider.mjs";
import { assessStorySignal } from "./signal.mjs";
import { requireData } from "./supabase.mjs";

export const AI_SCHEMA_VERSION = "1";
export const AI_ENRICH_PROMPT_VERSION = "enrich-story-v1";
export const AI_COMPARE_PROMPT_VERSION = "compare-sources-v1";
export const AI_PRECONDITION_FAILED_CODE = "PT412";
export const AI_BATCH_WALL_BUDGET_MS = 13 * 60_000;
export const AI_EDITOR_REFRESH_COOLDOWN_MS = 60_000;
const AI_CONTEXT_SNAPSHOT_ATTEMPTS = 3;

const elapsed = (started) => Math.max(0, Date.now() - started);
const currentKind = (rows, kind) => (rows || []).find((row) => row.is_current && (row.analysis_kind || "deterministic") === kind) || null;

export const loadStoryAiContext = async (supabase, storyId) => {
  for (let attempt = 0; attempt < AI_CONTEXT_SNAPSHOT_ATTEMPTS; attempt += 1) {
    const story = requireData(await supabase.from("stories").select("*").eq("id", storyId).neq("status", "merged").single(), "Load story for AI");
    const [links, countyLinks, municipalityLinks, deterministic] = await Promise.all([
      requireData(await supabase.from("story_sources")
        .select("source_item_id,attached_at,source_items(id,source_id,headline,normalized_headline,description,author,publisher,canonical_url,published_at,content_hash,sources(id,name,source_type,source_assessments(id,assessment_status,evidence_role,corroboration_group_key,verification_tier,methodology_version,rationale,assessed_at,superseded_at)))")
        .eq("story_id", storyId).is("detached_at", null), "Load story evidence for AI"),
      requireData(await supabase.from("story_counties").select("county_id,counties(id,name,slug)").eq("story_id", storyId), "Load story counties for AI"),
      requireData(await supabase.from("story_municipalities").select("municipality_id,municipalities(id,county_id,name,slug)").eq("story_id", storyId), "Load story municipalities for AI"),
      requireData(await supabase.from("story_enrichments").select("organizations,analysis_kind,is_current").eq("story_id", storyId).eq("analysis_kind", "deterministic").eq("is_current", true).maybeSingle(), "Load deterministic entities for AI"),
    ]);
    const revisionCheck = requireData(await supabase.from("stories")
      .select("id,evidence_revision")
      .eq("id", storyId)
      .neq("status", "merged")
      .single(), "Verify story evidence snapshot");
    if (String(revisionCheck.evidence_revision) !== String(story.evidence_revision)) continue;
    const sourceItems = links.map((link) => ({ ...link.source_items, attached_at: link.attached_at })).filter((item) => item.id);
    return {
      story,
      sourceItems,
      geography: {
        counties: countyLinks.map((link) => link.counties).filter(Boolean),
        municipalities: municipalityLinks.map((link) => link.municipalities).filter(Boolean),
      },
      organizations: deterministic?.organizations || [],
    };
  }
  const error = new Error("Story evidence changed repeatedly while AI input was prepared");
  error.code = AI_PRECONDITION_FAILED_CODE;
  throw error;
};

const contextIdentity = (context, config, operation, promptVersion) => {
  const fingerprint = storyInputFingerprint(context);
  return {
    fingerprint,
    cacheKey: aiCacheKey({
      operation,
      fingerprint,
      enrichmentVersion: config.aiEnrichmentVersion,
      schemaVersion: AI_SCHEMA_VERSION,
      promptVersion,
      provider: config.aiProvider,
      model: config.aiModel,
    }),
  };
};

export const queueStoryAiEnrichment = async ({
  supabase, config, context, reason = "material_change", requestedBy = "system", force = false, priority = 25,
  expectedStateUpdatedAt = null,
}) => {
  let preparedContext = context;
  let lastError = null;
  for (let attempt = 0; attempt < AI_CONTEXT_SNAPSHOT_ATTEMPTS; attempt += 1) {
    const identity = contextIdentity(preparedContext, config, AI_OPERATIONS.ENRICH_STORY, AI_ENRICH_PROMPT_VERSION);
    try {
      const state = requireData(await supabase.rpc("request_story_ai_enrichment", {
        p_story_id: preparedContext.story.id,
        p_evidence_revision: preparedContext.story.evidence_revision,
        p_input_fingerprint: identity.fingerprint,
        p_cache_key: identity.cacheKey,
        p_enrichment_version: config.aiEnrichmentVersion,
        p_schema_version: AI_SCHEMA_VERSION,
        p_prompt_version: AI_ENRICH_PROMPT_VERSION,
        p_provider: config.aiProvider,
        p_model: config.aiModel,
        p_priority: priority,
        p_request_reason: reason,
        p_requested_by: requestedBy,
        p_force: force,
        p_expected_state_updated_at: expectedStateUpdatedAt,
      }), "Queue story AI enrichment");
      return { state, ...identity };
    } catch (error) {
      if (error?.code !== AI_PRECONDITION_FAILED_CODE || expectedStateUpdatedAt) throw error;
      lastError = error;
      preparedContext = await loadStoryAiContext(supabase, preparedContext.story.id);
    }
  }
  throw lastError || new Error("Story evidence could not be stabilized for AI enrichment");
};

const createCallAttempt = async ({ supabase, claim, ingestionRunId = null }) => {
  const callAttemptId = randomUUID();
  try {
    return requireData(await supabase.rpc("create_story_ai_call_attempt", {
      p_call_attempt_id: callAttemptId,
      p_story_id: claim.story_id,
      p_lease_token: claim.lease_token,
      p_ingestion_run_id: ingestionRunId,
    }), "Record AI call attempt");
  } catch (error) {
    try {
      const reconciled = requireData(await supabase.from("ai_call_attempts")
        .select("*")
        .eq("id", callAttemptId)
        .maybeSingle(), "Reconcile AI call attempt");
      if (reconciled) return reconciled;
    } catch (reconciliationError) {
      console.error(JSON.stringify({
        event: "reath_ai_call_attempt_reconciliation_failed",
        storyId: claim.story_id,
        callAttemptId,
        message: reconciliationError.message,
      }));
    }
    throw error;
  }
};

const beginProviderCall = async ({ supabase, rpcName, params, label }) => {
  let firstError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return requireData(await supabase.rpc(rpcName, params), label);
    } catch (error) {
      if (attempt === 1) throw error;
      firstError = error;
    }
  }
  throw firstError || new Error(`${label} could not be reconciled`);
};

const failClaim = async ({ supabase, claim, call, error, started, providerStarted, providerResponse, providerValidated }) => {
  try {
    if (!providerStarted) {
      requireData(await supabase.rpc("release_story_ai_enrichment_claim", {
        p_story_id: claim.story_id,
        p_lease_token: claim.lease_token,
        p_error_code: error?.name || "worker_error",
        p_error_message: String(error?.message || "AI worker failed before the provider call").slice(0, 4000),
      }), "Release AI enrichment claim");
      return;
    }
    requireData(await supabase.rpc("fail_story_ai_enrichment", {
      p_story_id: claim.story_id,
      p_lease_token: claim.lease_token,
      p_call_attempt_id: call.id,
      p_outcome: providerResponse && !providerValidated ? "rejected" : "failed",
      p_error_code: error?.name || "provider_error",
      p_error_message: String(error?.message || "AI provider failed").slice(0, 4000),
      p_latency_ms: elapsed(started),
      p_provider_latency_ms: providerStarted ? elapsed(providerStarted) : null,
      p_model_version: providerResponse?.modelVersion || null,
      p_provider_request_id: providerResponse?.requestId || null,
      p_input_tokens: providerResponse?.usage?.input_tokens ?? null,
      p_output_tokens: providerResponse?.usage?.output_tokens ?? null,
      p_total_tokens: providerResponse?.usage?.total_tokens ?? null,
      p_usage_metadata: providerResponse?.usage?.details || {},
    }), "Record AI enrichment failure");
  } catch (recordingError) {
    console.error(JSON.stringify({ event: "reath_ai_failure_record_error", storyId: claim.story_id, message: recordingError.message }));
  }
};

export const processStoryAiClaim = async ({ supabase, provider, claim, ingestionRunId = null, config = null }) => {
  const started = Date.now();
  let providerStarted = null;
  let call = null;
  let providerResponse = null;
  let providerValidated = false;
  try {
    if (config && (
      claim.enrichment_version !== config.aiEnrichmentVersion ||
      claim.schema_version !== AI_SCHEMA_VERSION || claim.prompt_version !== AI_ENRICH_PROMPT_VERSION ||
      claim.provider !== config.aiProvider || claim.model !== config.aiModel
    )) throw new Error("AI enrichment configuration changed before processing began");
    const context = await loadStoryAiContext(supabase, claim.story_id);
    const liveFingerprint = storyInputFingerprint(context);
    if (liveFingerprint !== claim.claimed_input_fingerprint) throw new Error("Story changed before AI processing began");
    call = await createCallAttempt({ supabase, claim, ingestionRunId });
    const providerCallStarted = await beginProviderCall({
      supabase,
      rpcName: "begin_story_ai_provider_call",
      params: {
        p_call_attempt_id: call.id,
        p_story_id: claim.story_id,
        p_lease_token: claim.lease_token,
      },
      label: "Begin AI enrichment provider call",
    });
    if (!providerCallStarted) throw new Error("AI enrichment provider lease is no longer valid");
    providerStarted = Date.now();
    providerResponse = await provider.enrichStory(context);
    const response = validateProviderResult(AI_OPERATIONS.ENRICH_STORY, providerResponse);
    providerValidated = true;
    const applied = requireData(await supabase.rpc("complete_story_ai_enrichment", {
      p_story_id: claim.story_id,
      p_lease_token: claim.lease_token,
      p_call_attempt_id: call.id,
      p_output: response.output,
      p_model_version: response.modelVersion || provider.model,
      p_provider_request_id: response.requestId || null,
      p_latency_ms: elapsed(started),
      p_provider_latency_ms: elapsed(providerStarted),
      p_input_tokens: response.usage?.input_tokens ?? null,
      p_output_tokens: response.usage?.output_tokens ?? null,
      p_total_tokens: response.usage?.total_tokens ?? null,
      p_usage_metadata: response.usage?.details || {},
    }), "Complete AI story enrichment");
    return { storyId: claim.story_id, status: applied ? "succeeded" : "superseded", callAttemptId: call.id };
  } catch (error) {
    await failClaim({ supabase, claim, call, error, started, providerStarted, providerResponse, providerValidated });
    return {
      storyId: claim.story_id,
      status: providerResponse && !providerValidated ? "rejected" : "failed",
      error: error.message,
      callAttemptId: call?.id || null,
    };
  }
};

export const queueAiConfigurationChanges = async ({ supabase, config, configurationCutoff = new Date().toISOString() }) => {
  const limit = config.aiMaxStoriesPerRun;
  if (limit <= 0) return { considered: 0, queued: 0, skipped: 0, failed: 0 };
  const fields = "story_id,priority,requested_at,updated_at,enrichment_version,schema_version,prompt_version,provider,model,stories!inner(status)";
  const mismatches = [
    ["enrichment_version", config.aiEnrichmentVersion],
    ["schema_version", AI_SCHEMA_VERSION],
    ["prompt_version", AI_ENRICH_PROMPT_VERSION],
    ["provider", config.aiProvider],
    ["model", config.aiModel],
  ];
  const [revisionMismatches, ...pages] = await Promise.all([
    requireData(await supabase.rpc("list_story_ai_revision_mismatches", {
      p_limit: limit,
      p_updated_before: configurationCutoff,
    }), "Load AI evidence revision changes"),
    ...mismatches.map(async ([column, value]) => requireData(await supabase
    .from("story_ai_state")
    .select(fields)
    .neq(column, value)
    .neq("stories.status", "merged")
    .lte("updated_at", configurationCutoff)
    .order("priority", { ascending: false })
    .order("requested_at", { ascending: true })
    .limit(limit), `Load AI ${column} changes`)),
  ]);
  const candidatesByStory = new Map();
  for (const state of pages.flat()) {
    candidatesByStory.set(state.story_id, { ...candidatesByStory.get(state.story_id), ...state, configurationChanged: true });
  }
  for (const state of revisionMismatches || []) {
    candidatesByStory.set(state.story_id, { ...candidatesByStory.get(state.story_id), ...state, revisionChanged: true });
  }
  const candidates = [...candidatesByStory.values()]
    .filter((candidate) => candidate.revisionChanged || needsAiConfigurationRefresh({
      state: candidate,
      config,
      schemaVersion: AI_SCHEMA_VERSION,
      promptVersion: AI_ENRICH_PROMPT_VERSION,
    }))
    .sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0) || new Date(a.requested_at) - new Date(b.requested_at))
    .slice(0, limit);
  let queued = 0;
  let skipped = 0;
  let failed = 0;
  for (const candidate of candidates) {
    try {
      const context = await loadStoryAiContext(supabase, candidate.story_id);
      if (!assessStorySignal(context.sourceItems).priorityEligible && Number(candidate.priority || 0) < 85) {
        skipped += 1;
        continue;
      }
      await queueStoryAiEnrichment({
        supabase,
        config,
        context,
        reason: candidate.revisionChanged ? "evidence_revision_change" : "configuration_change",
        requestedBy: candidate.revisionChanged ? "system:evidence-revision" : "system:configuration",
        priority: candidate.priority,
        expectedStateUpdatedAt: candidate.updated_at,
      });
      queued += 1;
    } catch (error) {
      if (error?.code === AI_PRECONDITION_FAILED_CODE) {
        skipped += 1;
        continue;
      }
      failed += 1;
      console.error(JSON.stringify({ event: "reath_ai_configuration_queue_failed", storyId: candidate.story_id, message: error.message }));
    }
  }
  return { considered: candidates.length, queued, skipped, failed };
};

const expireStaleStoryAnalysisAttempts = async (supabase) => {
  try {
    const expired = requireData(await supabase.rpc("expire_stale_story_analysis_attempts", { p_limit: 100 }), "Expire stale story-analysis leases");
    return { expired: Number(expired || 0), failed: false };
  } catch (error) {
    console.error(JSON.stringify({ event: "reath_analysis_lease_cleanup_failed", message: error.message }));
    return { expired: 0, failed: true };
  }
};

const expireStaleStoryAiEnrichments = async (supabase) => {
  try {
    const expired = requireData(await supabase.rpc("expire_stale_story_ai_enrichments", { p_limit: 100 }), "Expire stale story-enrichment leases");
    return { expired: Number(expired || 0), failed: false };
  } catch (error) {
    console.error(JSON.stringify({ event: "reath_enrichment_lease_cleanup_failed", message: error.message }));
    return { expired: 0, failed: true };
  }
};

export const runStoryAiHousekeeping = async ({ supabase }) => {
  const [staleEnrichmentCleanup, staleAnalysisCleanup] = await Promise.all([
    expireStaleStoryAiEnrichments(supabase),
    expireStaleStoryAnalysisAttempts(supabase),
  ]);
  return { staleEnrichmentCleanup, staleAnalysisCleanup };
};

export const runStoryAiEnrichmentBatch = async ({
  supabase, config, ingestionRunId = null, providerOverride = null, housekeeping = null,
  configurationCutoff = new Date().toISOString(), deadlineAt = null,
}) => {
  const batchStarted = Date.now();
  const requestedDeadline = new Date(deadlineAt || 0).getTime();
  const effectiveDeadlineAt = Math.min(
    batchStarted + AI_BATCH_WALL_BUDGET_MS,
    Number.isFinite(requestedDeadline) && requestedDeadline > 0 ? requestedDeadline : Number.POSITIVE_INFINITY,
  );
  const { staleEnrichmentCleanup, staleAnalysisCleanup } = housekeeping || await runStoryAiHousekeeping({ supabase });
  const resolved = providerOverride
    ? { provider: providerOverride, capability: { status: "available", provider: providerOverride.name, model: providerOverride.model } }
    : createStoryEnrichmentProvider(config);
  if (!resolved.provider) return {
    status: resolved.capability.status,
    attempted: 0,
    capability: resolved.capability,
    staleEnrichmentCleanup,
    staleAnalysisCleanup,
    results: [],
  };
  const configurationRefresh = await queueAiConfigurationChanges({ supabase, config, configurationCutoff });
  const analysisResults = await runQueuedStoryAnalysisBatch({
    supabase,
    config,
    providerOverride: resolved.provider,
    maximum: Math.min(3, config.aiMaxStoriesPerRun),
    batchStarted,
    deadlineAt: effectiveDeadlineAt,
  });
  const worker = `reath-ai-${randomUUID()}`;
  const results = [];
  let stoppedReason = null;
  const basicLimit = Math.max(0, config.aiMaxStoriesPerRun - analysisResults.length);
  while (results.length < basicLimit) {
    if (Date.now() + config.aiTimeoutMs + 15_000 > effectiveDeadlineAt) {
      stoppedReason = "wall_budget";
      break;
    }
    const claims = requireData(await supabase.rpc("claim_story_ai_enrichments", {
      p_limit: 1,
      p_worker: worker,
      p_enrichment_version: config.aiEnrichmentVersion,
      p_schema_version: AI_SCHEMA_VERSION,
      p_prompt_version: AI_ENRICH_PROMPT_VERSION,
      p_provider: config.aiProvider,
      p_model: config.aiModel,
      p_lease_seconds: Math.ceil(config.aiTimeoutMs / 1000) + 120,
    }), "Claim eligible story enrichment") || [];
    if (!claims.length) {
      stoppedReason = "queue_empty";
      break;
    }
    results.push(await processStoryAiClaim({ supabase, provider: resolved.provider, claim: claims[0], ingestionRunId, config }));
  }
  return {
    status: [...results, ...analysisResults].some((result) => ["failed", "rejected"].includes(result.status)) || configurationRefresh.failed || staleEnrichmentCleanup.failed || staleAnalysisCleanup.failed ? "partial" : "succeeded",
    attempted: results.length + analysisResults.length,
    capability: resolved.capability,
    staleEnrichmentCleanup,
    staleAnalysisCleanup,
    configurationRefresh,
    stoppedReason,
    results,
    analyses: analysisResults,
  };
};

const requireProvider = (config, providerOverride, label) => {
  const resolved = providerOverride
    ? { provider: providerOverride, capability: { status: "available" } }
    : createStoryEnrichmentProvider(config);
  if (resolved.provider) return resolved;
  const error = new Error(resolved.capability.status === "disabled"
    ? `AI ${label} is disabled; deterministic Reath remains available.`
    : `AI ${label} is unavailable because server-side provider credentials are not configured.`);
  error.status = 409;
  throw error;
};

const compareSourcesEvidenceError = () => {
  const error = new Error("Compare Sources requires at least two distinct active sources.");
  error.status = 422;
  return error;
};
export const distinctActiveSourceCount = (context) => new Set((context.sourceItems || []).map((item) => item.source_id).filter(Boolean)).size;

const recordEditorialAiRequest = async ({ supabase, storyId, identity, actionType, toValue, reason }) => {
  try {
    requireData(await supabase.from("editorial_decisions").insert({
      story_id: storyId,
      actor_id: identity.id,
      actor_email: identity.email,
      actor_role: identity.role,
      action_type: actionType,
      to_value: toValue,
      reason,
    }), "Audit editor AI request");
    return true;
  } catch (error) {
    console.error(JSON.stringify({ event: "reath_ai_request_audit_failed", storyId, actionType, message: error.message }));
    return false;
  }
};

const loadStoryAiState = async (supabase, storyId) => requireData(await supabase
  .from("story_ai_state")
  .select("enrichment_status,requested_generation,successful_generation,current_evidence_revision,current_input_fingerprint,current_cache_key,last_enriched_at")
  .eq("story_id", storyId)
  .maybeSingle(), "Load story AI request state");

const recordEnrichmentCacheHit = async ({ supabase, storyId, identity, state, identityKey }) => {
  return requireData(await supabase.rpc("record_story_ai_enrichment_cache_hit", {
    p_story_id: storyId,
    p_evidence_revision: state.current_evidence_revision,
    p_input_fingerprint: identityKey.fingerprint,
    p_cache_key: identityKey.cacheKey,
    p_requested_by: identity.id,
  }), "Record AI enrichment cache hit");
};

export const requestStoryAiEnrichment = async ({ supabase, config, storyId, identity, providerOverride = null }) => {
  requireProvider(config, providerOverride, "enrichment");
  const context = await loadStoryAiContext(supabase, storyId);
  const identityKey = contextIdentity(context, config, AI_OPERATIONS.ENRICH_STORY, AI_ENRICH_PROMPT_VERSION);
  const previous = await loadStoryAiState(supabase, storyId);
  const sameInput = String(previous?.current_evidence_revision) === String(context.story.evidence_revision) &&
    previous?.current_input_fingerprint === identityKey.fingerprint && previous?.current_cache_key === identityKey.cacheKey;
  const activeStatus = sameInput && ["pending", "running"].includes(previous?.enrichment_status)
    ? previous.enrichment_status
    : null;
  const lastEnrichedAt = new Date(previous?.last_enriched_at || 0).getTime();
  const cooldownRemainingMs = sameInput && previous?.enrichment_status === "succeeded" && Number.isFinite(lastEnrichedAt)
    ? Math.max(0, AI_EDITOR_REFRESH_COOLDOWN_MS - (Date.now() - lastEnrichedAt))
    : 0;

  if (cooldownRemainingMs > 0) {
    let cacheHit = null;
    try {
      cacheHit = await recordEnrichmentCacheHit({ supabase, storyId, identity, state: previous, identityKey });
    } catch (error) {
      if (error?.code !== AI_PRECONDITION_FAILED_CODE) {
        console.error(JSON.stringify({ event: "reath_ai_cache_hit_record_failed", storyId, message: error.message }));
      }
    }
    if (cacheHit) {
      const auditRecorded = await recordEditorialAiRequest({
        supabase,
        storyId,
        identity,
        actionType: "ai_refresh",
        toValue: { status: "cache_hit", call_attempt_id: cacheHit.id },
        reason: "Editor refresh reused a just-completed matching enrichment",
      });
      return {
        storyId,
        status: "cached",
        generation: previous.successful_generation,
        callAttemptId: cacheHit.id,
        retryAfterSeconds: Math.max(1, Math.ceil(cooldownRemainingMs / 1000)),
        dispatchRequired: false,
        auditRecorded,
      };
    }
  }

  const queued = await queueStoryAiEnrichment({
    supabase,
    config,
    context,
    reason: "editor_request",
    requestedBy: identity.id,
    force: !activeStatus,
    priority: 100,
  });
  const status = queued.state.enrichment_status === "running" ? "running" : "queued";
  const auditRecorded = await recordEditorialAiRequest({
    supabase,
    storyId,
    identity,
    actionType: "ai_refresh",
    toValue: { status, generation: queued.state.requested_generation, coalesced: Boolean(activeStatus) },
    reason: activeStatus ? "Editor reused an active AI refresh request" : "Editor requested AI refresh",
  });
  return {
    storyId,
    status,
    generation: queued.state.requested_generation,
    coalesced: Boolean(activeStatus),
    dispatchRequired: status !== "running",
    auditRecorded,
  };
};

export const processRequestedStoryAiEnrichment = async ({ supabase, config, storyId, providerOverride = null, worker = null }) => {
  const resolved = requireProvider(config, providerOverride, "enrichment");
  const claim = requireData(await supabase.rpc("claim_story_ai_enrichment", {
    p_story_id: storyId,
    p_worker: worker || `reath-editor-${randomUUID()}`,
    p_enrichment_version: config.aiEnrichmentVersion,
    p_schema_version: AI_SCHEMA_VERSION,
    p_prompt_version: AI_ENRICH_PROMPT_VERSION,
    p_provider: config.aiProvider,
    p_model: config.aiModel,
    p_lease_seconds: Math.ceil(config.aiTimeoutMs / 1000) + 120,
  }), "Claim requested story enrichment");
  if (!claim) return { storyId, status: "not_claimed" };
  const result = await processStoryAiClaim({ supabase, provider: resolved.provider, claim, config });
  return result;
};

export const queueStorySourceComparison = async ({ supabase, config, storyId, identity, providerOverride = null }) => {
  const resolved = requireProvider(config, providerOverride, "analysis");
  let context = await loadStoryAiContext(supabase, storyId);
  if (distinctActiveSourceCount(context) < 2) {
    throw compareSourcesEvidenceError();
  }
  let identityKey;
  let call;
  let lastError = null;
  for (let attempt = 0; attempt < AI_CONTEXT_SNAPSHOT_ATTEMPTS; attempt += 1) {
    identityKey = contextIdentity(context, config, AI_OPERATIONS.COMPARE_SOURCES, AI_COMPARE_PROMPT_VERSION);
    try {
      call = requireData(await supabase.rpc("request_story_analysis_attempt", {
        p_story_id: storyId,
        p_evidence_revision: context.story.evidence_revision,
        p_operation_type: AI_OPERATIONS.COMPARE_SOURCES,
        p_input_fingerprint: identityKey.fingerprint,
        p_cache_key: identityKey.cacheKey,
        p_enrichment_version: config.aiEnrichmentVersion,
        p_provider: resolved.provider.name,
        p_model: resolved.provider.model,
        p_schema_version: AI_SCHEMA_VERSION,
        p_prompt_version: AI_COMPARE_PROMPT_VERSION,
        p_requested_by: identity.id,
        p_request_reason: "editor_request",
      }), "Request source-comparison attempt");
      break;
    } catch (error) {
      if (error?.code !== AI_PRECONDITION_FAILED_CODE) throw error;
      lastError = error;
      context = await loadStoryAiContext(supabase, storyId);
      if (distinctActiveSourceCount(context) < 2) throw compareSourcesEvidenceError();
    }
  }
  if (!call && lastError) throw lastError;
  if (!call) throw new Error("The source-comparison request could not be queued.");
  if (call.status === "cache_hit") {
    const cached = requireData(await supabase.from("story_analyses")
      .select("*")
      .eq("id", call.cached_from_analysis_id)
      .eq("story_id", storyId)
      .single(), "Load cached source comparison");
    const auditRecorded = await recordEditorialAiRequest({
      supabase, storyId, identity, actionType: "deep_analysis",
      toValue: { operation_type: AI_OPERATIONS.COMPARE_SOURCES, status: "cache_hit", analysis_id: cached.id, call_attempt_id: call.id },
      reason: "Editor reused the current source comparison",
    });
    return { status: "cached", analysis: cached, callAttemptId: call.id, dispatchRequired: false, auditRecorded };
  }
  if (!["queued", "running"].includes(call.status)) throw new Error(`Unexpected source-comparison request status: ${call.status}`);
  const coalesced = call.status === "running";
  const auditRecorded = await recordEditorialAiRequest({
    supabase, storyId, identity, actionType: "deep_analysis",
    toValue: { operation_type: AI_OPERATIONS.COMPARE_SOURCES, status: call.status, call_attempt_id: call.id, coalesced },
    reason: coalesced ? "Editor reused an active source-comparison request" : "Editor requested source comparison",
  });
  return {
    status: call.status,
    callAttemptId: call.id,
    ...(coalesced ? { coalesced: true } : {}),
    dispatchRequired: call.status === "queued",
    auditRecorded,
  };
};

export const processStoryAnalysisClaim = async ({ supabase, provider, claim, config = null }) => {
  const started = Number.isFinite(new Date(claim.started_at).getTime()) ? new Date(claim.started_at).getTime() : Date.now();
  let providerStarted = null;
  let providerResponse = null;
  let providerValidated = false;
  try {
    if (claim.operation_type !== AI_OPERATIONS.COMPARE_SOURCES) throw new Error("Unsupported queued AI analysis operation");
    if (config && (
      claim.enrichment_version !== config.aiEnrichmentVersion ||
      claim.provider !== config.aiProvider || claim.model !== config.aiModel ||
      claim.schema_version !== AI_SCHEMA_VERSION || claim.prompt_version !== AI_COMPARE_PROMPT_VERSION
    )) throw new Error("AI analysis configuration changed before processing began");
    const context = await loadStoryAiContext(supabase, claim.story_id);
    if (storyInputFingerprint(context) !== claim.input_fingerprint) throw new Error("Story changed before source comparison began");
    if (distinctActiveSourceCount(context) < 2) throw compareSourcesEvidenceError();
    const providerCallStarted = await beginProviderCall({
      supabase,
      rpcName: "begin_story_analysis_provider_call",
      params: {
        p_call_attempt_id: claim.id,
        p_lease_token: claim.lease_token,
      },
      label: "Begin source-comparison provider call",
    });
    if (!providerCallStarted) throw new Error("Source-comparison provider lease is no longer valid");
    providerStarted = Date.now();
    providerResponse = await provider.compareStorySources(context);
    const response = validateProviderResult(AI_OPERATIONS.COMPARE_SOURCES, providerResponse);
    validateSourceComparisonProvenance(context, response.output);
    providerValidated = true;
    const analysis = requireData(await supabase.rpc("complete_story_analysis", {
      p_story_id: claim.story_id,
      p_operation_type: claim.operation_type,
      p_call_attempt_id: claim.id,
      p_lease_token: claim.lease_token,
      p_input_fingerprint: claim.input_fingerprint,
      p_result: response.output,
      p_model_version: response.modelVersion || provider.model,
      p_provider_request_id: response.requestId || null,
      p_latency_ms: elapsed(started),
      p_provider_latency_ms: elapsed(providerStarted),
      p_input_tokens: response.usage?.input_tokens ?? null,
      p_output_tokens: response.usage?.output_tokens ?? null,
      p_total_tokens: response.usage?.total_tokens ?? null,
      p_usage_metadata: response.usage?.details || {},
    }), "Complete source comparison");
    return { storyId: claim.story_id, status: analysis ? "succeeded" : "superseded", callAttemptId: claim.id, analysis };
  } catch (error) {
    try {
      requireData(await supabase.rpc("fail_story_analysis_attempt", {
        p_call_attempt_id: claim.id,
        p_lease_token: claim.lease_token,
        p_outcome: providerResponse && !providerValidated ? "rejected" : "failed",
        p_error_code: error.name || "provider_error",
        p_error_message: String(error.message || "AI analysis provider failed").slice(0, 4000),
        p_latency_ms: elapsed(started),
        p_provider_latency_ms: providerStarted ? elapsed(providerStarted) : null,
        p_model_version: providerResponse?.modelVersion || null,
        p_provider_request_id: providerResponse?.requestId || null,
        p_input_tokens: providerResponse?.usage?.input_tokens ?? null,
        p_output_tokens: providerResponse?.usage?.output_tokens ?? null,
        p_total_tokens: providerResponse?.usage?.total_tokens ?? null,
        p_usage_metadata: providerResponse?.usage?.details || {},
      }), "Record source-comparison failure");
    } catch (recordingError) {
      console.error(JSON.stringify({ event: "reath_analysis_failure_record_error", storyId: claim.story_id, message: recordingError.message }));
    }
    return {
      storyId: claim.story_id,
      status: providerResponse && !providerValidated ? "rejected" : "failed",
      callAttemptId: claim.id,
      error: error.message,
    };
  }
};

export const processQueuedStoryAnalysis = async ({
  supabase, config, callAttemptId, providerOverride = null, worker = null, drainSuccessor = false,
}) => {
  const resolved = requireProvider(config, providerOverride, "analysis");
  const claim = requireData(await supabase.rpc("claim_story_analysis_attempt", {
    p_call_attempt_id: callAttemptId,
    p_worker: worker || `reath-analysis-${randomUUID()}`,
    p_enrichment_version: config.aiEnrichmentVersion,
    p_provider: config.aiProvider,
    p_model: config.aiModel,
    p_schema_version: AI_SCHEMA_VERSION,
    p_prompt_version: AI_COMPARE_PROMPT_VERSION,
    p_lease_seconds: Math.ceil(config.aiTimeoutMs / 1000) + 120,
  }), "Claim queued story analysis");
  if (!claim) return { status: "not_claimed", callAttemptId };
  const result = await processStoryAnalysisClaim({ supabase, provider: resolved.provider, claim, config });
  if (drainSuccessor && result.status === "superseded") {
    const successor = requireData(await supabase.from("ai_call_attempts")
      .select("id")
      .eq("story_id", claim.story_id)
      .eq("operation_type", claim.operation_type)
      .eq("status", "queued")
      .order("request_sequence", { ascending: false })
      .limit(1)
      .maybeSingle(), "Load queued analysis successor");
    if (successor) {
      return {
        ...result,
        successor: await processQueuedStoryAnalysis({
          supabase,
          config,
          callAttemptId: successor.id,
          providerOverride: resolved.provider,
          worker: worker || `reath-analysis-successor-${randomUUID()}`,
          drainSuccessor: false,
        }),
      };
    }
  }
  return result;
};

export const runQueuedStoryAnalysisBatch = async ({
  supabase, config, providerOverride = null, maximum = 3, batchStarted = Date.now(),
  deadlineAt = batchStarted + AI_BATCH_WALL_BUDGET_MS,
}) => {
  if (maximum <= 0) return [];
  const queued = requireData(await supabase.from("ai_call_attempts")
    .select("id")
    .eq("operation_type", AI_OPERATIONS.COMPARE_SOURCES)
    .eq("status", "queued")
    .eq("enrichment_version", config.aiEnrichmentVersion)
    .eq("provider", config.aiProvider)
    .eq("model", config.aiModel)
    .eq("schema_version", AI_SCHEMA_VERSION)
    .eq("prompt_version", AI_COMPARE_PROMPT_VERSION)
    .order("started_at", { ascending: true })
    .limit(maximum), "Load queued story analyses");
  const results = [];
  for (const call of queued) {
    if (Date.now() + config.aiTimeoutMs + 15_000 > deadlineAt) break;
    results.push(await processQueuedStoryAnalysis({
      supabase,
      config,
      callAttemptId: call.id,
      providerOverride,
      worker: `reath-analysis-batch-${randomUUID()}`,
    }));
  }
  return results;
};

export const aiCapability = (config) => ({
  status: !config.aiEnabled ? "disabled" : config.aiAvailable ? "available" : "unavailable",
  reason: config.aiUnavailableReason,
  provider: config.aiProvider,
  model: config.aiModel,
  maxStoriesPerRun: config.aiMaxStoriesPerRun,
  enrichmentVersion: config.aiEnrichmentVersion,
});

export const aiStateMatchesConfiguration = (state, config) => Boolean(
  state && config && config.aiEnabled && config.aiAvailable &&
  state.enrichment_version === config.aiEnrichmentVersion &&
  state.schema_version === AI_SCHEMA_VERSION &&
  state.prompt_version === AI_ENRICH_PROMPT_VERSION &&
  state.provider === config.aiProvider &&
  state.model === config.aiModel
);

export const loadAiActivity = async (supabase) => {
  const calls = requireData(await supabase.from("ai_call_attempts")
    .select("id,story_id,operation_type,status,evidence_revision,input_fingerprint,cache_key,enrichment_version,provider,model,model_version,provider_request_id,provider_called,cache_hit,cached_from_enrichment_id,cached_from_analysis_id,started_at,completed_at,latency_ms,provider_latency_ms,input_tokens,output_tokens,total_tokens,usage_metadata,error_code,error_message")
    .order("started_at", { ascending: false }).limit(100), "Load AI activity");
  return {
    calls,
    summary: calls.reduce((summary, call) => ({
      ...summary,
      total: summary.total + 1,
      succeeded: summary.succeeded + (call.status === "succeeded" ? 1 : 0),
      failed: summary.failed + (["failed","rejected"].includes(call.status) ? 1 : 0),
      cacheHits: summary.cacheHits + (call.cache_hit ? 1 : 0),
      providerCalls: summary.providerCalls + (call.provider_called ? 1 : 0),
      inputTokens: summary.inputTokens + Number(call.input_tokens || 0),
      outputTokens: summary.outputTokens + Number(call.output_tokens || 0),
    }), { window: "latest_100", rowLimit: 100, total: 0, succeeded: 0, failed: 0, cacheHits: 0, providerCalls: 0, inputTokens: 0, outputTokens: 0 }),
  };
};

export const selectActiveAnalysis = (rows, state, config, evidenceRevision = null) => {
  const ai = currentKind(rows, "ai");
  const evidenceCurrent = evidenceRevision === null || evidenceRevision === undefined ||
    String(state?.current_evidence_revision) === String(evidenceRevision);
  if (ai && evidenceCurrent && aiStateMatchesConfiguration(state, config) && state.enrichment_status === "succeeded" && ai.input_fingerprint === state.last_successful_fingerprint) return ai;
  return currentKind(rows, "deterministic");
};
