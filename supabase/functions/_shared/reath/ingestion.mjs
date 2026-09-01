import { randomUUID } from "node:crypto";

import { chooseStory, STORY_CLUSTER_WINDOW_HOURS } from "./cluster.mjs";
import { deterministicEnrichment } from "./enrichment.mjs";
import { matchGeography } from "./geography.mjs";
import { headlineTokens, normalizeHeadline } from "./headline.mjs";
import { parseSourcePayload } from "./source-adapters.mjs";
import { assessStorySignal, evidenceOriginKeyFor } from "./signal.mjs";
import { requireData } from "./supabase.mjs";

const now = () => new Date().toISOString();
const uniqueViolation = (error) => error?.code === "23505" || /duplicate key|unique constraint/i.test(error?.message || "");
const elapsed = (started) => Math.max(0, Date.now() - started);
const SOURCE_ITEM_STALE_MS = 20 * 60_000;
const INGESTION_RUN_STALE_MS = 16 * 60_000;
export const INGESTION_CORE_WALL_BUDGET_MS = 10 * 60_000;
export const INGESTION_INVOCATION_WALL_BUDGET_MS = 13 * 60_000;
export const INGESTION_MAX_ITEMS_PER_RUN = 100;
export const INGESTION_BACKLOG_MAX_ITEMS_PER_RUN = 50;
export const MANUAL_INGESTION_RETENTION_DAYS = 30;
const ASSESSMENT_FIELDS = "id,assessment_status,evidence_role,corroboration_group_key,verification_tier,methodology_version,rationale,assessed_at,superseded_at";
const SOURCE_WITH_ASSESSMENTS = `sources(*,source_assessments(${ASSESSMENT_FIELDS}))`;
const STORY_CANDIDATE_SELECT = `id,canonical_title,last_activity_at,story_counties(county_id),story_municipalities(municipality_id),story_enrichments(organizations,is_current,analysis_kind),story_sources(detached_at,source_items(id,source_id,headline,normalized_headline,description,author,published_at,discovered_at,${SOURCE_WITH_ASSESSMENTS}))`;
export const EXACT_HEADLINE_CANDIDATE_LIMIT = 25;
export const EVIDENCE_HEADLINE_CANDIDATE_LIMIT = 500;
export const withinIngestionLookback = (item, {
  at = Date.now(),
  days = MANUAL_INGESTION_RETENTION_DAYS,
} = {}) => {
  const publishedAt = Date.parse(item?.publishedAt || item?.published_at || "");
  if (!Number.isFinite(publishedAt)) return true;
  return publishedAt >= at - Math.max(1, Number(days) || MANUAL_INGESTION_RETENTION_DAYS) * 86_400_000;
};

export const candidateRecallTokens = (value, maximum = 8) => [...new Set(headlineTokens(value))]
  .filter((token) => token.length >= 4)
  .sort((left, right) => right.length - left.length || left.localeCompare(right))
  .slice(0, maximum);
const sourceGroupKey = (sourceItem) => {
  const source = sourceItem?.sources || sourceItem?.source || sourceItem || {};
  const assessedGroup = (source.source_assessments || [])
    .find((assessment) => !assessment.superseded_at)?.corroboration_group_key;
  if (assessedGroup) return evidenceOriginKeyFor(sourceItem, assessedGroup);
  return source.id ? `source:${source.id}` : null;
};

export const storyCandidateWindow = ({ publishedAt, discoveredAt, fallbackAt = Date.now() } = {}) => {
  const anchor = [publishedAt, discoveredAt, fallbackAt]
    .map((value) => {
      if (value instanceof Date) return value.getTime();
      if (typeof value === "number") return value;
      return typeof value === "string" && value.trim() ? Date.parse(value) : Number.NaN;
    })
    .find(Number.isFinite);
  const windowMs = STORY_CLUSTER_WINDOW_HOURS * 3_600_000;
  return {
    since: new Date(anchor - windowMs).toISOString(),
    until: new Date(anchor + windowMs).toISOString(),
  };
};

export const createIngestionWorkBudget = ({
  startedAt = Date.now(),
  maximumItems = INGESTION_MAX_ITEMS_PER_RUN,
  wallBudgetMs = INGESTION_CORE_WALL_BUDGET_MS,
} = {}) => {
  const deadlineAt = startedAt + Math.max(0, wallBudgetMs);
  let consumed = 0;
  return {
    deadlineAt,
    maximumItems: Math.max(0, maximumItems),
    take() {
      if (Date.now() >= deadlineAt || consumed >= this.maximumItems) return false;
      consumed += 1;
      return true;
    },
    exhausted() {
      return Date.now() >= deadlineAt || consumed >= this.maximumItems;
    },
    get consumed() { return consumed; },
  };
};

const sourceItemPayload = (source, item) => ({
  source_id: source.id,
  external_guid: item.externalGuid,
  url: item.url,
  canonical_url: item.canonicalUrl,
  headline: item.headline,
  normalized_headline: item.normalizedHeadline,
  description: item.description,
  author: item.author,
  publisher: item.publisher,
  published_at: item.publishedAt,
  raw_metadata: item.rawMetadata,
  content_hash: item.contentHash,
});

const loadExistingSourceItem = async (supabase, source, item) => {
  const byUrl = requireData(await supabase.from("source_items")
    .select(`*,${SOURCE_WITH_ASSESSMENTS}`).eq("canonical_url", item.canonicalUrl).maybeSingle(), "Reconcile source item URL");
  if (byUrl) return byUrl;
  const byHash = requireData(await supabase.from("source_items")
    .select(`*,${SOURCE_WITH_ASSESSMENTS}`).eq("source_id", source.id).eq("content_hash", item.contentHash).maybeSingle(), "Reconcile source item hash");
  if (byHash) return byHash;
  if (String(item.externalGuid || "").trim()) {
    return requireData(await supabase.from("source_items")
      .select(`*,${SOURCE_WITH_ASSESSMENTS}`).eq("source_id", source.id).eq("external_guid", item.externalGuid).maybeSingle(), "Reconcile source item GUID");
  }
  return null;
};

export const registerSourceItem = async (supabase, source, item) => {
  const inserted = requireData(await supabase.from("source_items")
    .upsert(sourceItemPayload(source, item), { ignoreDuplicates: true })
    .select(`*,${SOURCE_WITH_ASSESSMENTS}`).maybeSingle(), "Register source item");
  if (inserted) return { sourceItem: inserted, inserted: true };
  const existing = await loadExistingSourceItem(supabase, source, item);
  if (!existing) throw new Error("Duplicate source item could not be reconciled");
  return { sourceItem: existing, inserted: false };
};

export const claimSourceItem = async (supabase, sourceItem, at = Date.now()) => {
  const processingToken = randomUUID();
  const processingStartedAt = new Date(at).toISOString();
  let claim = supabase.from("source_items")
    .update({
      processing_status: "processing",
      processing_error: null,
      processing_token: processingToken,
      processing_started_at: processingStartedAt,
    })
    .eq("id", sourceItem.id);
  claim = sourceItem.processing_status === "processing"
    ? claim.eq("processing_status", "processing").lt("processing_started_at", new Date(at - SOURCE_ITEM_STALE_MS).toISOString())
    : claim.in("processing_status", ["pending", "error"]);
  return requireData(await claim.select().maybeSingle(), "Claim source item processing");
};

const finishClaimedSourceItem = async (supabase, sourceItem, values, label) => {
  const finished = requireData(await supabase.from("source_items")
    .update({ ...values, processing_token: null, processing_started_at: null })
    .eq("id", sourceItem.id)
    .eq("processing_status", "processing")
    .eq("processing_token", sourceItem.processing_token)
    .select("id")
    .maybeSingle(), label);
  if (!finished) {
    const error = new Error(`${label}: source-item processing claim is no longer current`);
    error.code = "PT412";
    throw error;
  }
  return finished;
};

export const expireStaleIngestionRuns = async (supabase, at = Date.now()) => requireData(await supabase.from("ingestion_runs")
  .update({
    status: "failed",
    errors: 1,
    error_summary: "Worker exceeded the Netlify background execution window before recording completion",
    completed_at: new Date(at).toISOString(),
  })
  .eq("status", "running")
  .lt("started_at", new Date(at - INGESTION_RUN_STALE_MS).toISOString())
  .select("id"), "Expire stale ingestion runs");

const readBoundedBody = async (response, maximumBytes) => {
  const declared = Number.parseInt(response.headers.get("content-length") || "0", 10);
  if (declared > maximumBytes) throw new Error(`Feed exceeds ${maximumBytes} byte limit`);
  if (!response.body?.getReader) {
    const buffer = new Uint8Array(await response.arrayBuffer());
    if (buffer.byteLength > maximumBytes) throw new Error(`Feed exceeds ${maximumBytes} byte limit`);
    return new TextDecoder().decode(buffer);
  }
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maximumBytes) {
      await reader.cancel();
      throw new Error(`Feed exceeds ${maximumBytes} byte limit`);
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
};

export const fetchFeed = async (source, config, fetchImpl = globalThis.fetch) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.fetchTimeoutMs);
  try {
    const response = await fetchImpl(source.feed_url, {
      headers: { "User-Agent": config.userAgent, Accept: source.ingestion_method === "api" ? "application/json" : "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9" },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Feed returned HTTP ${response.status}`);
    return readBoundedBody(response, config.maxFeedBytes);
  } catch (error) {
    if (error?.name === "AbortError") throw new Error(`Feed timed out after ${config.fetchTimeoutMs}ms`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
};

const sourceLastCheckedAt = (source) => {
  if (!source?.last_checked_at) return Number.NEGATIVE_INFINITY;
  const parsed = new Date(source.last_checked_at).getTime();
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
};

export const selectDueSources = (sources, at = Date.now()) => sources.filter((source) => {
  if (!source.active || source.ingestion_method === "html") return false;
  const lastCheckedAt = sourceLastCheckedAt(source);
  if (!Number.isFinite(lastCheckedAt)) return true;
  return at - lastCheckedAt >= source.poll_interval_minutes * 60_000;
}).sort((left, right) => {
  const leftCheckedAt = sourceLastCheckedAt(left);
  const rightCheckedAt = sourceLastCheckedAt(right);
  if (leftCheckedAt !== rightCheckedAt) return leftCheckedAt < rightCheckedAt ? -1 : 1;
  const priorityDifference = Number(right.priority || 0) - Number(left.priority || 0);
  if (priorityDifference) return priorityDifference;
  return String(left.name || left.id || "").localeCompare(String(right.name || right.id || ""));
});

export const runIsolatedSources = async (sources, handler, concurrency = 6) => {
  const results = new Array(sources.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < sources.length) {
      const index = cursor++;
      try {
        results[index] = await handler(sources[index]);
      } catch (error) {
        results[index] = { sourceId: sources[index].id, status: "failed", error: error.message };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, sources.length) }, worker));
  return results;
};

const loadGeography = async (supabase) => {
  const [counties, municipalities] = await Promise.all([
    requireData(await supabase.from("counties").select("id,name,slug"), "Load counties"),
    requireData(await supabase.from("municipalities").select("id,county_id,name,slug,aliases").eq("active", true), "Load municipalities"),
  ]);
  return { counties, municipalities };
};

export const loadStoryCandidates = async (supabase, sourceItem = {}) => {
  const { since, until } = storyCandidateWindow({
    publishedAt: sourceItem.published_at,
    discoveredAt: sourceItem.discovered_at,
  });
  const rows = requireData(await supabase.from("stories")
    .select(STORY_CANDIDATE_SELECT)
    .eq("status", "developing")
    .gte("last_activity_at", since)
    .lte("last_activity_at", until)
    .order("last_activity_at", { ascending: false })
    .limit(150), "Load story candidates");
  const normalizedHeadline = sourceItem.normalized_headline || normalizeHeadline(sourceItem.headline);
  const linkedStories = (links) => links
    .flatMap((link) => Array.isArray(link.stories) ? link.stories : [link.stories])
    .filter(Boolean);
  const storyHasExactHeadline = (story) => normalizeHeadline(story.canonical_title) === normalizedHeadline
    || (story.story_sources || []).some((link) => !link.detached_at
      && link.source_items?.normalized_headline === normalizedHeadline);
  let exactRows = [];
  let exactOverflow = false;
  if (normalizedHeadline && !rows.some(storyHasExactHeadline)) {
    const exactLinks = requireData(await supabase.from("story_sources")
      .select(`story_id,source_items!inner(id,normalized_headline,published_at,discovered_at),stories!inner(${STORY_CANDIDATE_SELECT})`)
      .is("detached_at", null)
      .eq("source_items.normalized_headline", normalizedHeadline)
      .or(`and(published_at.gte.${since},published_at.lte.${until}),and(published_at.is.null,discovered_at.gte.${since},discovered_at.lte.${until})`, { referencedTable: "source_items" })
      .eq("stories.status", "developing")
      .limit(EXACT_HEADLINE_CANDIDATE_LIMIT + 1), "Load exact-headline Story candidates");
    // A high-frequency exact title may be a recurring template. Fail closed instead of broadening the candidate set.
    if (exactLinks.length <= EXACT_HEADLINE_CANDIDATE_LIMIT) {
      exactRows = linkedStories(exactLinks);
    } else {
      exactOverflow = true;
    }
  }
  let evidenceRows = [];
  const recallTokens = candidateRecallTokens(normalizedHeadline);
  if (normalizedHeadline && !rows.some(storyHasExactHeadline) && exactRows.length === 0 && !exactOverflow && recallTokens.length) {
    const tokenFilter = recallTokens.map((token) => `normalized_headline.ilike.%${token}%`).join(",");
    const evidenceLinks = requireData(await supabase.from("story_sources")
      .select(`story_id,source_items!inner(id,normalized_headline,published_at,discovered_at),stories!inner(${STORY_CANDIDATE_SELECT})`)
      .is("detached_at", null)
      .or(`and(published_at.gte.${since},published_at.lte.${until}),and(published_at.is.null,discovered_at.gte.${since},discovered_at.lte.${until})`, { referencedTable: "source_items" })
      .or(tokenFilter, { referencedTable: "source_items" })
      .eq("stories.status", "developing")
      .limit(EVIDENCE_HEADLINE_CANDIDATE_LIMIT + 1), "Load evidence-headline Story candidates");
    // Broad/common headline terms can overflow this bounded recall query. In
    // that case the ordinary conservative candidates remain authoritative.
    if (evidenceLinks.length <= EVIDENCE_HEADLINE_CANDIDATE_LIMIT) evidenceRows = linkedStories(evidenceLinks);
  }
  const mergedRows = [...new Map([...rows, ...exactRows, ...evidenceRows].map((story) => [story.id, story])).values()];
  return mergedRows.map((story) => ({
    ...story,
    geography: {
      countyIds: (story.story_counties || []).map((link) => link.county_id),
      municipalityIds: (story.story_municipalities || []).map((link) => link.municipality_id),
    },
    organizations: (story.story_enrichments || []).find((row) => row.is_current && (row.analysis_kind || "deterministic") === "deterministic")?.organizations || [],
    sourceIds: [...new Set((story.story_sources || []).filter((link) => !link.detached_at).map((link) => link.source_items?.source_id).filter(Boolean))],
    sourceGroupKeys: [...new Set((story.story_sources || []).filter((link) => !link.detached_at)
      .map((link) => sourceGroupKey(link.source_items)).filter(Boolean))],
    evidenceItems: (story.story_sources || []).filter((link) => !link.detached_at && link.source_items?.id)
      .map((link) => ({
        sourceItemId: link.source_items.id,
        sourceId: link.source_items.source_id,
        headline: link.source_items.headline,
        normalizedHeadline: link.source_items.normalized_headline,
        description: link.source_items.description,
        publishedAt: link.source_items.published_at,
        discoveredAt: link.source_items.discovered_at,
      }))
      .sort((left, right) => String(left.sourceItemId).localeCompare(String(right.sourceItemId))),
  }));
};

const upsertStoryGeography = async (supabase, storyId, geography) => {
  if (geography.counties.length) requireData(await supabase.from("story_counties").upsert(
    geography.counties.map((county) => ({ story_id: storyId, county_id: county.id, confidence: 0.85, source: "deterministic" })),
    { onConflict: "story_id,county_id" },
  ), "Attach story counties");
  if (geography.municipalities.length) requireData(await supabase.from("story_municipalities").upsert(
    geography.municipalities.map((municipality) => ({ story_id: storyId, municipality_id: municipality.id, confidence: 0.85, source: "deterministic" })),
    { onConflict: "story_id,municipality_id" },
  ), "Attach story municipalities");
};

const replaceCurrent = async (supabase, table, storyId, row) => {
  const analysisKind = row.analysis_kind || "deterministic";
  requireData(await supabase.from(table).update({ is_current: false }).eq("story_id", storyId).eq("analysis_kind", analysisKind).eq("is_current", true), `Archive current ${table}`);
  try {
    return requireData(await supabase.from(table).insert({ ...row, story_id: storyId, is_current: true }).select().single(), `Write ${table}`);
  } catch (error) {
    const previous = requireData(await supabase.from(table)
      .select("id")
      .eq("story_id", storyId)
      .eq("analysis_kind", analysisKind)
      .eq("is_current", false)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(), `Find previous ${table}`);
    if (previous?.id) {
      requireData(await supabase.from(table).update({ is_current: true }).eq("id", previous.id), `Restore previous ${table}`);
    }
    throw error;
  }
};

export const refreshStoryAnalysis = async (supabase, storyId, geographyReference, config) => {
  const reference = geographyReference || await loadGeography(supabase);
  const [story, links, countyLinks, municipalityLinks] = await Promise.all([
    requireData(await supabase.from("stories").select("*").eq("id", storyId).single(), "Load story for enrichment"),
    requireData(await supabase.from("story_sources")
      .select("attached_at,source_items(id,source_id,headline,normalized_headline,description,author,publisher,canonical_url,published_at,content_hash,sources(id,name,source_type,source_assessments(id,assessment_status,evidence_role,corroboration_group_key,verification_tier,methodology_version,rationale,assessed_at,superseded_at)))")
      .eq("story_id", storyId).is("detached_at", null), "Load story evidence"),
    requireData(await supabase.from("story_counties").select("county_id").eq("story_id", storyId), "Load story counties"),
    requireData(await supabase.from("story_municipalities").select("municipality_id").eq("story_id", storyId), "Load story municipalities"),
  ]);
  const sourceItems = links.map((link) => link.source_items ? { ...link.source_items, attached_at: link.attached_at } : null).filter(Boolean);
  const countyIds = new Set(countyLinks.map((link) => link.county_id));
  const municipalityIds = new Set(municipalityLinks.map((link) => link.municipality_id));
  const geography = {
    counties: reference.counties.filter((county) => countyIds.has(county.id)),
    municipalities: reference.municipalities.filter((municipality) => municipalityIds.has(municipality.id)),
  };
  const { enrichment, scores, briefing } = deterministicEnrichment({ story, sourceItems, geography });
  const aiContext = { story, sourceItems, geography, organizations: enrichment.organizations };
  const corroboration = assessStorySignal(sourceItems);
  const priority = corroboration.priorityEligible
    ? (Date.now() - new Date(story.last_activity_at).getTime() <= 12 * 3_600_000 ? 75 : 65)
    : 5;
  await Promise.all([
    replaceCurrent(supabase, "story_enrichments", storyId, {
      ...enrichment,
      provider: "deterministic",
      model: "reath-rules",
      model_version: "1.0.0",
      schema_version: "1",
      raw_output: enrichment,
      analysis_kind: "deterministic",
      operation_type: "enrich_story",
      prompt_version: "deterministic-v1",
      briefing,
    }),
    replaceCurrent(supabase, "story_scores", storyId, { ...scores, provider: "deterministic", model_version: "1.0.0", analysis_kind: "deterministic" }),
  ]);
  requireData(await supabase.from("stories").update({ ...briefing, scope: enrichment.scope, confidence: enrichment.confidence }).eq("id", storyId), "Update story briefing");
  let aiQueue = { status: "not_requested", reason: config?.aiEnabled ? "insufficient_corroboration" : "ai_disabled" };
  if (config?.aiEnabled && corroboration.priorityEligible) {
    const queueStoryAiEnrichment = config?.queueStoryAiEnrichment;
    if (typeof queueStoryAiEnrichment !== "function") {
      return {
        ...aiContext,
        enrichment,
        scores,
        briefing,
        corroboration,
        aiQueue: { status: "not_requested", reason: "ai_queue_unavailable" },
      };
    }
    try {
      const currentStory = requireData(await supabase.from("stories").select("*").eq("id", storyId).single(), "Reload Story after deterministic enrichment");
      const queued = await queueStoryAiEnrichment({
        supabase,
        config,
        context: { ...aiContext, story: currentStory },
        reason: "source_evidence_changed",
        priority,
      });
      aiQueue = { status: "queued", fingerprint: queued.fingerprint };
    } catch (error) {
      aiQueue = { status: "failed", error: error.message };
      console.error(JSON.stringify({ event: "reath_ai_queue_failed", storyId, message: error.message }));
    }
  }
  return { ...aiContext, enrichment, scores, briefing, corroboration, aiQueue };
};

const processSourceItem = async ({ supabase, config, source, sourceItem, geographyReference, recovering = false }) => {
  const text = `${sourceItem.headline} ${sourceItem.description}`;
  const geography = matchGeography(text, geographyReference.counties, geographyReference.municipalities, source);
  if (recovering) {
    const existingLinks = requireData(await supabase.from("story_sources")
      .select("story_id,detached_at").eq("source_item_id", sourceItem.id).order("attached_at", { ascending: false }), "Find existing Story evidence links");
    const existingLink = existingLinks.find((link) => !link.detached_at);
    if (existingLink?.story_id) {
      await upsertStoryGeography(supabase, existingLink.story_id, geography);
      requireData(await supabase.from("editorial_queue").upsert({ story_id: existingLink.story_id }, { onConflict: "story_id", ignoreDuplicates: true }), "Restore editorial queue row");
      await refreshStoryAnalysis(supabase, existingLink.story_id, geographyReference, config);
      await finishClaimedSourceItem(supabase, sourceItem, { processing_status: "processed", processing_error: null }, "Complete recovered source item");
      return { storyId: existingLink.story_id, action: "recovered", geography };
    }
    if (existingLinks.length) {
      await finishClaimedSourceItem(supabase, sourceItem, { processing_status: "processed", processing_error: null }, "Honor detached source evidence");
      return { storyId: null, action: "detached", geography };
    }
  }
  const candidates = await loadStoryCandidates(supabase, sourceItem);
  const decision = chooseStory({
    headline: sourceItem.headline,
    description: sourceItem.description,
    publishedAt: sourceItem.published_at,
    discoveredAt: sourceItem.discovered_at,
    sourceId: sourceItem.source_id,
    sourceGroupKey: sourceGroupKey({ ...sourceItem, sources: sourceItem.sources || source }),
    geography: { countyIds: geography.counties.map((county) => county.id), municipalityIds: geography.municipalities.map((municipality) => municipality.id) },
  }, candidates);
  const firstSeen = sourceItem.published_at || sourceItem.discovered_at;
  const lastActivity = decision.action === "attach"
    ? [decision.story.last_activity_at, sourceItem.published_at, sourceItem.discovered_at].filter(Boolean).sort().at(-1)
    : firstSeen;
  const story = requireData(await supabase.rpc("assign_source_item_to_story", {
    p_source_item_id: sourceItem.id,
    p_processing_token: sourceItem.processing_token,
    p_story_id: decision.action === "attach" ? decision.story.id : null,
    p_canonical_title: sourceItem.headline,
    p_first_seen_at: firstSeen,
    p_last_activity_at: lastActivity,
    p_scope: geography.municipalities.length ? "municipality" : geography.counties.length === 1 ? "county" : "state",
    p_link_method: decision.action === "attach" ? "deterministic" : "created",
    p_confidence: decision.action === "attach" ? decision.confidence : 1,
    p_signals: decision.action === "attach" ? decision.signals : { reason: decision.reason },
  }), "Assign source evidence to Story");
  await upsertStoryGeography(supabase, story.id, geography);
  requireData(await supabase.from("editorial_queue").upsert({ story_id: story.id }, { onConflict: "story_id", ignoreDuplicates: true }), "Ensure editorial queue row");
  await refreshStoryAnalysis(supabase, story.id, geographyReference, config);
  await finishClaimedSourceItem(supabase, sourceItem, { processing_status: "processed", processing_error: null }, "Complete source item processing");
  return { storyId: story.id, action: decision.action, geography };
};

export const recoverSourceItemBacklog = async ({
  supabase, config, geographyReference, processSerialized, workBudget, at = Date.now(), limit = INGESTION_BACKLOG_MAX_ITEMS_PER_RUN,
}) => {
  const boundedLimit = Math.min(250, Math.max(0, limit));
  if (boundedLimit === 0) return { attempted: 0, recovered: 0, errors: 0, deferred: 0 };
  const [waiting, stale] = await Promise.all([
    requireData(await supabase.from("source_items")
      .select(`*,${SOURCE_WITH_ASSESSMENTS}`)
      .in("processing_status", ["pending", "error"])
      .order("discovered_at", { ascending: true })
      .limit(boundedLimit), "Load waiting source-item backlog"),
    requireData(await supabase.from("source_items")
      .select(`*,${SOURCE_WITH_ASSESSMENTS}`)
      .eq("processing_status", "processing")
      .lt("updated_at", new Date(at - SOURCE_ITEM_STALE_MS).toISOString())
      .order("updated_at", { ascending: true })
      .limit(boundedLimit), "Load stale source-item backlog"),
  ]);
  const backlog = [...new Map([...waiting, ...stale].map((item) => [item.id, item])).values()].slice(0, boundedLimit);
  let recovered = 0;
  let errors = 0;
  let attempted = 0;
  for (const item of backlog) {
    if (workBudget && !workBudget.take()) break;
    attempted += 1;
    let claimed;
    try {
      claimed = await claimSourceItem(supabase, item, at);
      if (!claimed) continue;
      const source = item.sources;
      if (!source) throw new Error("Backlog Source is unavailable");
      await processSerialized(() => processSourceItem({
        supabase,
        config,
        source,
        sourceItem: claimed,
        geographyReference,
        recovering: true,
      }));
      recovered += 1;
    } catch (error) {
      errors += 1;
      if (claimed?.id) {
        try {
          await finishClaimedSourceItem(supabase, claimed, {
            processing_status: "error",
            processing_error: error.message.slice(0, 2000),
          }, "Record backlog processing error");
        } catch (updateError) {
          console.error(JSON.stringify({ event: "source_item_backlog_error_update_failed", sourceItemId: claimed.id, message: updateError.message }));
        }
      }
      console.error(JSON.stringify({ event: "source_item_backlog_error", sourceItemId: item.id, message: error.message }));
    }
  }
  return { attempted, recovered, errors, deferred: Math.max(0, backlog.length - attempted) };
};

const ingestSource = async ({
  supabase, config, source, runId, geographyReference, fetchImpl, processSerialized, workBudget,
  lookbackDays = null, ingestionStartedAt = Date.now(),
}) => {
  const started = Date.now();
  const checkedAt = now();
  let fetched = 0;
  let inserted = 0;
  let duplicates = 0;
  let errors = 0;
  let deferred = 0;
  let agedOut = 0;
  try {
    if (workBudget?.exhausted()) {
      const result = { sourceId: source.id, source: source.name, status: "partial", fetched, inserted, duplicates, errors, deferred: 1, durationMs: elapsed(started) };
      requireData(await supabase.from("source_run_results").insert({
        ingestion_run_id: runId, source_id: source.id, status: "partial", items_fetched: 0,
        items_inserted: 0, duplicates: 0, errors: 0, items_deferred: 1,
        error_message: "Source fetch deferred by the ingestion worker budget", duration_ms: result.durationMs,
      }), "Write deferred source run result");
      return result;
    }
    const xml = await fetchFeed(source, config, fetchImpl);
    const parsedItems = parseSourcePayload(source, xml).slice(0, 100);
    fetched = parsedItems.length;
    const items = lookbackDays == null
      ? parsedItems
      : parsedItems.filter((item) => withinIngestionLookback(item, { at: ingestionStartedAt, days: lookbackDays }));
    agedOut = parsedItems.length - items.length;
    for (const item of items) {
      let registration;
      try {
        registration = await registerSourceItem(supabase, source, item);
        if (registration.inserted) inserted += 1;
        else duplicates += 1;
      } catch (error) {
        if (uniqueViolation(error)) {
          duplicates += 1;
          const existing = await loadExistingSourceItem(supabase, source, item);
          if (existing) registration = { sourceItem: existing, inserted: false };
        }
        if (!registration) {
          errors += 1;
          console.error(JSON.stringify({ event: "source_item_insert_error", source: source.name, message: error.message }));
          continue;
        }
      }
      if (["pending", "error", "processing"].includes(registration.sourceItem.processing_status) && workBudget && !workBudget.take()) {
        deferred += 1;
        continue;
      }
      let sourceItem;
      try {
        sourceItem = await claimSourceItem(supabase, registration.sourceItem);
      } catch (error) {
        errors += 1;
        console.error(JSON.stringify({ event: "source_item_claim_error", source: source.name, sourceItemId: registration.sourceItem.id, message: error.message }));
        continue;
      }
      if (!sourceItem) continue;
      const effectiveSource = registration.sourceItem.sources || source;
      try {
        await processSerialized(() => processSourceItem({
          supabase,
          config,
          source: effectiveSource,
          sourceItem,
          geographyReference,
          recovering: !registration.inserted,
        }));
      } catch (error) {
        errors += 1;
        await finishClaimedSourceItem(supabase, sourceItem, {
          processing_status: "error",
          processing_error: error.message.slice(0, 2000),
        }, "Record source item processing error");
        console.error(JSON.stringify({ event: "source_item_processing_error", source: source.name, sourceItemId: sourceItem.id, message: error.message }));
      }
    }
    requireData(await supabase.from("sources").update({
      last_checked_at: checkedAt,
      last_success_at: checkedAt,
      last_error: null,
      failure_streak: 0,
      recent_item_count: inserted,
    }).eq("id", source.id), "Update source success");
    const status = errors > 0 || deferred > 0 ? "partial" : "succeeded";
    const errorMessage = [
      errors > 0 ? `${errors} source item(s) failed processing` : null,
      deferred > 0 ? `${deferred} source item(s) deferred by the ingestion worker budget` : null,
    ].filter(Boolean).join("; ") || null;
    const result = { sourceId: source.id, source: source.name, status, fetched, inserted, duplicates, errors, deferred, agedOut, durationMs: elapsed(started) };
    requireData(await supabase.from("source_run_results").insert({
      ingestion_run_id: runId, source_id: source.id, status, items_fetched: fetched,
      items_inserted: inserted, duplicates, errors, items_deferred: deferred,
      error_message: errorMessage, duration_ms: result.durationMs,
    }), "Write source run result");
    console.log(JSON.stringify({ event: "reath_source_ingested", ...result }));
    return result;
  } catch (error) {
    const durationMs = elapsed(started);
    await supabase.from("sources").update({
      last_checked_at: checkedAt,
      last_error_at: checkedAt,
      last_error: error.message.slice(0, 2000),
      failure_streak: (source.failure_streak || 0) + 1,
    }).eq("id", source.id);
    await supabase.from("source_run_results").insert({
      ingestion_run_id: runId, source_id: source.id, status: "failed", items_fetched: fetched,
      items_inserted: inserted, duplicates, errors: errors + 1, items_deferred: deferred,
      error_message: error.message.slice(0, 2000), duration_ms: durationMs,
    });
    const result = { sourceId: source.id, source: source.name, status: "failed", fetched, inserted, duplicates, errors: errors + 1, deferred, durationMs, error: error.message };
    console.error(JSON.stringify({ event: "reath_source_failed", ...result }));
    return result;
  }
};

export const ingestDueSources = async ({
  supabase,
  config,
  triggerType = "scheduled",
  triggeredBy = null,
  sourceIds = null,
  forceSourceRefresh = false,
  lookbackDays = null,
  dueSourceLimit = null,
  maximumItems = INGESTION_MAX_ITEMS_PER_RUN,
  backlogLimit = INGESTION_BACKLOG_MAX_ITEMS_PER_RUN,
  coreWallBudgetMs = INGESTION_CORE_WALL_BUDGET_MS,
  invocationWallBudgetMs = INGESTION_INVOCATION_WALL_BUDGET_MS,
  staleAfterMs = INGESTION_RUN_STALE_MS,
  fetchImpl = globalThis.fetch,
}) => {
  const started = Date.now();
  const invocationDeadlineAt = started + Math.max(1_000, Number(invocationWallBudgetMs) || INGESTION_INVOCATION_WALL_BUDGET_MS);
  const workBudget = createIngestionWorkBudget({
    startedAt: started,
    maximumItems: Math.min(INGESTION_MAX_ITEMS_PER_RUN, Math.max(0, Number(maximumItems) || 0)),
    wallBudgetMs: Math.max(1_000, Number(coreWallBudgetMs) || INGESTION_CORE_WALL_BUDGET_MS),
  });
  const admission = requireData(await supabase.rpc("start_ingestion_run", {
    p_trigger_type: triggerType,
    p_triggered_by: triggeredBy,
    p_stale_after_seconds: Math.ceil(Math.max(60_000, Number(staleAfterMs) || INGESTION_RUN_STALE_MS) / 1000),
  }), "Start ingestion run");
  const run = admission?.run || null;
  if (!admission?.admitted) {
    return {
      runId: run?.id || null,
      admissionReason: admission?.reason || "already_running",
      maintenance: admission?.maintenance || null,
      startedAt: run?.started_at || null,
      deadlineAt: new Date(invocationDeadlineAt).toISOString(),
      status: "already_running",
      skipped: true,
      sourcesAttempted: 0,
      fetched: 0,
      inserted: 0,
      duplicates: 0,
      errors: 0,
      failed: 0,
      deferred: 0,
      recovered: 0,
      results: [],
      durationMs: elapsed(started),
    };
  }
  if (!run?.id) throw new Error("Start ingestion run returned no admitted run");
  try {
    let query = supabase.from("sources").select(`*,source_assessments(${ASSESSMENT_FIELDS})`).eq("active", true).order("priority", { ascending: false });
    if (sourceIds?.length) query = query.in("id", sourceIds);
    const registered = requireData(await query, "Load source registry");
    const dueSources = sourceIds?.length || forceSourceRefresh ? registered : selectDueSources(registered);
    const boundedSourceLimit = dueSourceLimit == null
      ? dueSources.length
      : Math.min(50, Math.max(0, Number(dueSourceLimit) || 0));
    const sources = dueSources.slice(0, boundedSourceLimit);
    const geographyReference = await loadGeography(supabase);
    // Fetch and exact-deduplicate sources concurrently, but serialize clustering
    // inside one run so two simultaneous source items cannot both create a story
    // before either sees the other. False separation remains preferable to a
    // wrong merge, but this avoids an unnecessary race in the common path.
    let clusteringTail = Promise.resolve();
    const processSerialized = (task) => {
      const result = clusteringTail.then(task, task);
      clusteringTail = result.catch(() => undefined);
      return result;
    };
    const recovery = await recoverSourceItemBacklog({
      supabase,
      config,
      geographyReference,
      processSerialized,
      workBudget,
      at: started,
      limit: Math.min(INGESTION_BACKLOG_MAX_ITEMS_PER_RUN, Math.max(0, Number(backlogLimit) || 0)),
    });
    const results = await runIsolatedSources(sources, (source) => ingestSource({
      supabase, config, source, runId: run.id, geographyReference, fetchImpl, processSerialized, workBudget,
      lookbackDays, ingestionStartedAt: started,
    }), 6);
    const totals = results.reduce((total, result) => ({
      fetched: total.fetched + (result.fetched || 0),
      inserted: total.inserted + (result.inserted || 0),
      duplicates: total.duplicates + (result.duplicates || 0),
      errors: total.errors + (result.errors || 0),
      failed: total.failed + (result.status === "failed" ? 1 : 0),
      deferred: total.deferred + (result.deferred || 0),
      agedOut: total.agedOut + (result.agedOut || 0),
    }), { fetched: 0, inserted: 0, duplicates: 0, errors: recovery.errors, failed: 0, deferred: recovery.deferred, agedOut: 0 });
    const status = totals.failed === sources.length && sources.length > 0 && recovery.recovered === 0
      ? "failed"
      : totals.failed > 0 || totals.errors > 0 || totals.deferred > 0 ? "partial" : "succeeded";
    const sourceErrors = results.filter((result) => result.error).map((result) => `${result.source}: ${result.error}`);
    if (recovery.errors) sourceErrors.unshift(`Backlog recovery: ${recovery.errors} item error(s)`);
    for (const result of results) {
      if (result.errors && !result.error) sourceErrors.push(`${result.source}: ${result.errors} source-item error(s)`);
      if (result.deferred) sourceErrors.push(`${result.source}: ${result.deferred} item(s) deferred`);
    }
    if (recovery.deferred) sourceErrors.unshift(`Backlog recovery: ${recovery.deferred} item(s) deferred`);
    const durationMs = elapsed(started);
    const finished = requireData(await supabase.rpc("finish_ingestion_run", {
      p_run_id: run.id,
      p_status: status,
      p_sources_attempted: sources.length,
      p_items_fetched: totals.fetched,
      p_items_inserted: totals.inserted,
      p_duplicates: totals.duplicates,
      p_errors: totals.errors,
      p_error_summary: sourceErrors.join(" | "),
      p_duration_ms: durationMs,
    }), "Complete ingestion run");
    const finalStatus = finished ? status : "superseded";
    return {
      runId: run.id,
      startedAt: run.started_at,
      deadlineAt: new Date(invocationDeadlineAt).toISOString(),
      status: finalStatus,
      maintenance: admission?.maintenance || null,
      sourcesAttempted: sources.length,
      ...totals,
      recovered: recovery.recovered,
      results,
      durationMs,
    };
  } catch (error) {
    await supabase.rpc("finish_ingestion_run", {
      p_run_id: run.id,
      p_status: "failed",
      p_sources_attempted: 0,
      p_items_fetched: 0,
      p_items_inserted: 0,
      p_duplicates: 0,
      p_errors: 1,
      p_error_summary: error.message.slice(0, 5000),
      p_duration_ms: elapsed(started),
    });
    throw error;
  }
};
