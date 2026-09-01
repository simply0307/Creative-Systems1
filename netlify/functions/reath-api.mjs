import { planDetach, planStoryMerge } from "./_shared/reath/cluster.mjs";
import { aiCapability, aiStateMatchesConfiguration, loadAiActivity, loadStoryAiContext, queueStoryAiEnrichment, queueStorySourceComparison, requestStoryAiEnrichment, selectActiveAnalysis } from "./_shared/reath/ai-orchestrator.mjs";
import { requireIdentity, requireSameOrigin } from "./_shared/reath/auth.mjs";
import { envValue } from "./_shared/reath/config.mjs";
import { validateEditorialChange } from "./_shared/reath/editorial.mjs";
import { refreshStoryAnalysis } from "./_shared/reath/ingestion.mjs";
import { assessStorySignal } from "./_shared/reath/signal.mjs";
import { getReathSupabase, requireData } from "./_shared/reath/supabase.mjs";

const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers });
const parseBody = async (request) => {
  try {
    return await request.json();
  } catch {
    const error = new Error("Request body must be valid JSON.");
    error.status = 400;
    throw error;
  }
};

const dispatchAiBackground = async (request, payload) => {
  const token = envValue("REATH_SCHEDULE_TOKEN");
  if (!token) return { accepted: false, reason: "background_dispatch_not_configured" };
  try {
    const endpoint = new URL("/.netlify/functions/reath-ai-background", request.url);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", "x-reath-schedule-token": token },
      body: JSON.stringify(payload),
    });
    return response.ok ? { accepted: true } : { accepted: false, reason: `background_http_${response.status}` };
  } catch (error) {
    console.error(JSON.stringify({ event: "reath_ai_background_dispatch_failed", message: error.message }));
    return { accepted: false, reason: "background_dispatch_failed" };
  }
};

export const dispatchIngestionBackground = async (request, payload, fetchImpl = globalThis.fetch) => {
  const token = envValue("REATH_SCHEDULE_TOKEN");
  if (!token) return { accepted: false, reason: "background_dispatch_not_configured" };
  try {
    const endpoint = new URL("/.netlify/functions/reath-ingest-background", request.url);
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", "x-reath-schedule-token": token },
      body: JSON.stringify(payload),
    });
    return response.ok ? { accepted: true } : { accepted: false, reason: `background_http_${response.status}` };
  } catch (error) {
    console.error(JSON.stringify({ event: "reath_ingestion_background_dispatch_failed", message: error.message }));
    return { accepted: false, reason: "background_dispatch_failed" };
  }
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const normalizeSourceIds = (value) => {
  if (value == null) return null;
  if (!Array.isArray(value) || value.length > 50) {
    const error = new Error("sourceIds must be an array of at most 50 Source UUIDs.");
    error.status = 400;
    throw error;
  }
  const normalized = [...new Set(value.map((item) => String(item || "").trim().toLowerCase()))];
  if (normalized.some((item) => !UUID_PATTERN.test(item))) {
    const error = new Error("Every sourceIds value must be a valid Source UUID.");
    error.status = 400;
    throw error;
  }
  return normalized;
};

const aiState = (story) => Array.isArray(story.story_ai_state) ? story.story_ai_state[0] : story.story_ai_state;
const scores = (story, config) => story.active_scores || selectActiveAnalysis(story.story_scores, aiState(story), config, story.evidence_revision);
const enrichment = (story, config) => story.active_enrichment || selectActiveAnalysis(story.story_enrichments, aiState(story), config, story.evidence_revision);
const scoreValue = (story, key) => scores(story, story._config)?.[key] ?? null;
const queue = (story) => story.editorial_queue?.[0] || story.editorial_queue || { status: "new", route: null };
const activeSources = (story) => (story.story_sources || []).filter((link) => !link.detached_at);
const storySignal = (story) => assessStorySignal(activeSources(story).map((link) => link.source_items).filter(Boolean));

export const deskSection = (story) => {
  const editorial = queue(story);
  if (editorial.status === "watch") return "Watch";
  if (editorial.status === "keep") return "Kept";
  if (editorial.status === "ignore") return "Ignored";
  const corroboration = story.corroboration || storySignal(story);
  if (!corroboration.priorityEligible) return "Low Signal";
  if (!scores(story, story._config)) return "Needs Classification";
  if ((scoreValue(story, "reath_potential") ?? -1) >= 70) return "Reath Bait";
  if ((scoreValue(story, "momentum") ?? -1) >= 60) return "Developing";
  if ((scoreValue(story, "significance") ?? -1) >= 60 || (scoreValue(story, "civic_utility") ?? -1) >= 60) return "Worth a Look";
  return "Corroborated";
};

const projectAiStatus = (story, config) => {
  const capability = aiCapability(config);
  const state = aiState(story);
  if (capability.status !== "available") return { ...capability, enrichmentStatus: capability.status };
  if (!state) return { ...capability, enrichmentStatus: "pending" };
  if (String(state.current_evidence_revision) !== String(story.evidence_revision) || !aiStateMatchesConfiguration(state, config)) {
    return {
      ...capability,
      enrichmentStatus: "stale",
      storedProvider: state.provider,
      storedModel: state.model,
      requestedAt: state.requested_at,
    };
  }
  return {
    ...capability,
    enrichmentStatus: state.enrichment_status === "succeeded" ? "current" : state.enrichment_status,
    lastEnrichedAt: state.last_enriched_at,
    error: state.enrichment_error_code ? "AI enrichment failed; see AI Activity for details." : null,
    requestedAt: state.requested_at,
  };
};

const projectStory = (story, config) => ({
  ...story,
  _config: config,
  active_enrichment: enrichment(story, config),
  active_scores: scores(story, config),
  corroboration: storySignal(story),
  ai: projectAiStatus(story, config),
});

const storySelect = `
  *,
  editorial_queue(*),
  story_ai_state(enrichment_status,last_enriched_at,enrichment_error_code,requested_at,last_successful_fingerprint,current_evidence_revision,current_input_fingerprint,enrichment_version,schema_version,prompt_version,provider,model),
  story_scores(id,local_impact,civic_utility,significance,momentum,novelty,human_interest,emotional_resonance,reath_potential,satire_potential,locality,confidence,reasons,provider,model_version,is_current,analysis_kind,input_fingerprint,created_at),
  story_enrichments(id,nj_relevance,scope,counties,municipalities,topics,people,organizations,event_type,event_date,public_impact,civic_utility,novelty,human_interest,emotional_register,reath_potential,satire_potential,confidence,provider,model,model_version,schema_version,is_current,analysis_kind,input_fingerprint,prompt_version,briefing,created_at),
  story_counties(county_id,counties(id,name,slug)),
  story_municipalities(municipality_id,municipalities(id,name,slug,county_id)),
  story_sources(source_item_id,link_method,confidence,signals,attached_at,attached_by,detached_at,detached_by,detach_reason,
    source_items(id,headline,description,author,publisher,url,canonical_url,published_at,discovered_at,raw_metadata,source_id,sources(id,name,source_type,source_assessments(id,assessment_status,evidence_role,corroboration_group_key,verification_tier,methodology_version,rationale,assessed_at,superseded_at))))
`;

const sectionRank = new Map([
  ["Kept", 0], ["Watch", 1], ["Reath Bait", 2], ["Developing", 3], ["Worth a Look", 4],
  ["Corroborated", 5], ["Needs Classification", 6], ["Low Signal", 7], ["Ignored", 8],
]);

const filterStories = (stories, search) => {
  const county = search.get("county");
  const municipality = search.get("municipality");
  const topic = search.get("topic")?.toLowerCase();
  const source = search.get("source");
  const status = search.get("status");
  const section = search.get("section");
  const includeLowSignal = search.get("include_low_signal") === "true";
  const hours = Number.parseInt(search.get("hours") || "0", 10);
  const minimumReath = Number.parseInt(search.get("min_reath") || "0", 10);
  return stories.filter((story) => {
    if (county && !(story.story_counties || []).some((link) => String(link.county_id) === county || link.counties?.slug === county)) return false;
    if (municipality && !(story.story_municipalities || []).some((link) => link.municipality_id === municipality || link.municipalities?.slug === municipality)) return false;
    if (topic && !(enrichment(story, story._config)?.topics || []).some((value) => value.toLowerCase() === topic)) return false;
    if (source && !activeSources(story).some((link) => link.source_items?.source_id === source)) return false;
    if (status && queue(story).status !== status) return false;
    if (section && deskSection(story).toLowerCase().replaceAll(" ", "_") !== section.toLowerCase().replaceAll(" ", "_")) return false;
    if (!includeLowSignal && !section && deskSection(story) === "Low Signal") return false;
    if (hours > 0 && Date.now() - new Date(story.last_activity_at).getTime() > hours * 3_600_000) return false;
    if (minimumReath > 0 && (scoreValue(story, "reath_potential") ?? -1) < minimumReath) return false;
    return true;
  }).map((story) => {
    const projected = { ...story };
    delete projected._config;
    const sourceIds = new Set(activeSources(story).map((link) => link.source_items?.source_id).filter(Boolean));
    return { ...projected, desk_section: deskSection(story), source_count: sourceIds.size, source_item_count: activeSources(story).length };
  }).sort((a, b) => (sectionRank.get(a.desk_section) ?? 99) - (sectionRank.get(b.desk_section) ?? 99)
    || new Date(b.last_activity_at) - new Date(a.last_activity_at)
    || String(a.id).localeCompare(String(b.id)));
};

const listStories = async (supabase, url, config) => {
  const stories = [];
  const pageSize = 250;
  for (let start = 0; start < 5_000; start += pageSize) {
    const page = requireData(await supabase.from("stories").select(storySelect).neq("status", "merged")
      .order("last_activity_at", { ascending: false }).range(start, start + pageSize - 1), "Load Reath Wire stories");
    stories.push(...page);
    if (page.length < pageSize) break;
  }
  return filterStories(stories.map((story) => projectStory(story, config)), url.searchParams).slice(0, 250);
};

const getStory = async (supabase, storyId, config) => {
  const story = projectStory(requireData(await supabase.from("stories").select(`${storySelect},editorial_decisions(*),story_analyses(*),ai_call_attempts(id,request_sequence,operation_type,status,evidence_revision,input_fingerprint,enrichment_version,provider,model,schema_version,prompt_version,cache_hit,started_at,completed_at,error_code)`).eq("id", storyId).single(), "Load Reath story"), config);
  const projected = { ...story };
  delete projected._config;
  const sourceIds = new Set(activeSources(story).map((link) => link.source_items?.source_id).filter(Boolean));
  return { ...projected, desk_section: deskSection(story), source_count: sourceIds.size, source_item_count: activeSources(story).length };
};

const sourceHealth = async (supabase) => {
  const [sources, recentResults] = await Promise.all([
    requireData(await supabase.from("sources").select("*,counties(name),municipalities(name),source_assessments(id,assessment_status,evidence_role,corroboration_group_key,verification_tier,methodology_version,rationale,assessed_at,superseded_at)").order("active", { ascending: false }).order("priority", { ascending: false }), "Load source health"),
    requireData(await supabase.from("source_run_results").select("*,ingestion_runs(started_at,trigger_type)").order("created_at", { ascending: false }).limit(250), "Load recent source results"),
  ]);
  return sources.map((source) => ({ ...source, recent_runs: recentResults.filter((result) => result.source_id === source.id).slice(0, 5) }));
};

const routes = {
  stories: /^\/api\/reath\/stories\/?$/,
  story: /^\/api\/reath\/stories\/([0-9a-f-]{36})\/?$/i,
  editorial: /^\/api\/reath\/stories\/([0-9a-f-]{36})\/editorial\/?$/i,
  enrich: /^\/api\/reath\/stories\/([0-9a-f-]{36})\/ai\/enrich\/?$/i,
  analyze: /^\/api\/reath\/stories\/([0-9a-f-]{36})\/ai\/analyze\/?$/i,
  detach: /^\/api\/reath\/stories\/([0-9a-f-]{36})\/sources\/([0-9a-f-]{36})\/detach\/?$/i,
};

export default async (request) => {
  try {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method.toUpperCase();
    const { client: supabase, config: baseConfig } = getReathSupabase();
    const config = { ...baseConfig, queueStoryAiEnrichment };

    if (path === "/api/reath/me" && method === "GET") return json({ user: await requireIdentity("viewer") });

    if (routes.stories.test(path) && method === "GET") {
      await requireIdentity("viewer");
      return json({ stories: await listStories(supabase, url, config), ai: aiCapability(config) });
    }
    const storyMatch = path.match(routes.story);
    if (storyMatch && method === "GET") {
      await requireIdentity("viewer");
      return json({ story: await getStory(supabase, storyMatch[1], config) });
    }
    if (path === "/api/reath/sources/health" && method === "GET") {
      await requireIdentity("viewer");
      return json({ sources: await sourceHealth(supabase) });
    }
    if (path === "/api/reath/runs" && method === "GET") {
      await requireIdentity("viewer");
      const runs = requireData(await supabase.from("ingestion_runs").select("*").order("started_at", { ascending: false }).limit(50), "Load ingestion runs");
      return json({ runs });
    }
    if (path === "/api/reath/ai/capability" && method === "GET") {
      await requireIdentity("viewer");
      return json({ ai: aiCapability(config) });
    }
    if (path === "/api/reath/ai/activity" && method === "GET") {
      await requireIdentity("viewer");
      return json({ ai: aiCapability(config), ...await loadAiActivity(supabase) });
    }
    if (path === "/api/reath/ingest" && method === "POST") {
      requireSameOrigin(request);
      const identity = await requireIdentity("admin");
      const body = await parseBody(request);
      const sourceIds = normalizeSourceIds(body.sourceIds);
      const dispatch = await dispatchIngestionBackground(request, {
        triggerType: "manual",
        triggeredBy: identity.id,
        sourceIds,
      });
      return json({ accepted: dispatch.accepted, dispatch, sourceIds }, dispatch.accepted ? 202 : 503);
    }
    const editorialMatch = path.match(routes.editorial);
    if (editorialMatch && method === "PATCH") {
      requireSameOrigin(request);
      const identity = await requireIdentity("editor");
      const change = validateEditorialChange(await parseBody(request));
      const result = requireData(await supabase.rpc("set_editorial_state", {
        p_story_id: editorialMatch[1], p_status: change.status, p_route: change.route, p_notes: change.notes,
        p_actor_id: identity.id, p_actor_email: identity.email, p_actor_role: identity.role, p_reason: change.reason,
      }), "Update editorial state");
      if (change.status === "keep" || change.route) {
        try {
          const context = await loadStoryAiContext(supabase, editorialMatch[1]);
          await queueStoryAiEnrichment({ supabase, config, context, reason: change.status === "keep" ? "editor_keep" : "editor_route", requestedBy: identity.id, priority: change.status === "keep" ? 90 : 85 });
        } catch (error) {
          console.error(JSON.stringify({ event: "reath_ai_priority_update_failed", storyId: editorialMatch[1], message: error.message }));
        }
      }
      return json({ editorial: result });
    }
    const enrichMatch = path.match(routes.enrich);
    if (enrichMatch && method === "POST") {
      requireSameOrigin(request);
      const identity = await requireIdentity("editor");
      const result = await requestStoryAiEnrichment({ supabase, config, storyId: enrichMatch[1], identity });
      if (!result.dispatchRequired) {
        const status = result.status === "cached" ? 200 : 202;
        return json({ result: { ...result, dispatch: { accepted: false, reason: result.status === "cached" ? "cache_hit" : "already_running" } } }, status);
      }
      const dispatch = await dispatchAiBackground(request, { operation: "enrich_story", storyId: enrichMatch[1] });
      return json({ result: { ...result, dispatch } }, 202);
    }
    const analyzeMatch = path.match(routes.analyze);
    if (analyzeMatch && method === "POST") {
      requireSameOrigin(request);
      const identity = await requireIdentity("editor");
      const body = await parseBody(request);
      if (body.operation !== "compare_sources") {
        const error = new Error("Only the explicit compare_sources operation is available in V1.");
        error.status = 400;
        throw error;
      }
      const result = await queueStorySourceComparison({ supabase, config, storyId: analyzeMatch[1], identity });
      if (result.status === "cached") return json({ analysis: result });
      const dispatch = result.callAttemptId && result.dispatchRequired !== false
        ? await dispatchAiBackground(request, { operation: "compare_sources", callAttemptId: result.callAttemptId })
        : { accepted: false, reason: result.status === "running" ? "already_running" : "already_active" };
      return json({ analysis: { ...result, dispatch } }, 202);
    }
    if (path === "/api/reath/stories/merge" && method === "POST") {
      requireSameOrigin(request);
      const identity = await requireIdentity("admin");
      const body = await parseBody(request);
      const plan = planStoryMerge({ targetStoryId: body.targetStoryId, sourceStoryId: body.sourceStoryId });
      const result = requireData(await supabase.rpc("merge_stories", {
        p_target_story_id: plan.targetStoryId, p_source_story_id: plan.sourceStoryId,
        p_actor_id: identity.id, p_actor_email: identity.email, p_actor_role: identity.role, p_reason: String(body.reason || ""),
      }), "Merge stories");
      let analysisRefreshError = null;
      try { await refreshStoryAnalysis(supabase, plan.targetStoryId, null, config); }
      catch (error) { analysisRefreshError = error.message; console.error(JSON.stringify({ event: "reath_merge_analysis_refresh_failed", storyId: plan.targetStoryId, message: error.message })); }
      return json({ ...result, analysis_refresh_error: analysisRefreshError });
    }
    const detachMatch = path.match(routes.detach);
    if (detachMatch && method === "POST") {
      requireSameOrigin(request);
      const identity = await requireIdentity("admin");
      const body = await parseBody(request);
      const plan = planDetach({ storyId: detachMatch[1], sourceItemId: detachMatch[2], reason: body.reason });
      const result = requireData(await supabase.rpc("detach_story_source", {
        p_story_id: plan.storyId, p_source_item_id: plan.sourceItemId,
        p_actor_id: identity.id, p_actor_email: identity.email, p_actor_role: identity.role, p_reason: plan.reason,
      }), "Detach story source");
      let analysisRefreshError = null;
      try { await refreshStoryAnalysis(supabase, plan.storyId, null, config); }
      catch (error) { analysisRefreshError = error.message; console.error(JSON.stringify({ event: "reath_detach_analysis_refresh_failed", storyId: plan.storyId, message: error.message })); }
      return json({ ...result, analysis_refresh_error: analysisRefreshError });
    }
    return json({ error: "Not found" }, 404);
  } catch (error) {
    const status = error.status || (/not found/i.test(error.message) ? 404 : 500);
    if (status >= 500) console.error(JSON.stringify({ event: "reath_api_error", message: error.message, code: error.code || null }));
    return json({ error: error.message }, status);
  }
};

export const config = {
  path: [
    "/api/reath/me",
    "/api/reath/stories",
    "/api/reath/stories/:id",
    "/api/reath/stories/:id/editorial",
    "/api/reath/stories/:id/ai/enrich",
    "/api/reath/stories/:id/ai/analyze",
    "/api/reath/stories/:id/sources/:sourceItemId/detach",
    "/api/reath/stories/merge",
    "/api/reath/sources/health",
    "/api/reath/runs",
    "/api/reath/ai/capability",
    "/api/reath/ai/activity",
    "/api/reath/ingest",
  ],
};
