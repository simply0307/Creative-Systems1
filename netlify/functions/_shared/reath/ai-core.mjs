import { createHash } from "node:crypto";

import { sourceComparisonSchema, storyEnrichmentResultSchema } from "./enrichment.mjs";

export const AI_OPERATIONS = Object.freeze({
  ENRICH_STORY: "enrich_story",
  COMPARE_SOURCES: "compare_sources",
});

const stable = (value) => {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
};

export const MAX_STORY_SOURCE_ITEMS = 25;

const sourceRecency = (item) => {
  const parsed = new Date(item.published_at || item.attached_at || 0).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
};

const inventoryDigest = (sourceItems) => createHash("sha256").update(JSON.stringify(sourceItems
  .map((item) => ({ id: item.id, source_id: item.source_id, content_hash: item.content_hash }))
  .sort((a, b) => String(a.id).localeCompare(String(b.id))))).digest("hex");

export const storyProviderInput = ({ story, sourceItems = [], geography = {}, organizations = [] }) => {
  const orderedSources = [...sourceItems].sort((a, b) => sourceRecency(b) - sourceRecency(a) || String(a.id).localeCompare(String(b.id)));
  return {
    story: {
      id: story.id,
      canonical_title: story.canonical_title,
      first_seen_at: story.first_seen_at || null,
      last_activity_at: story.last_activity_at || null,
      event_date: story.event_date || null,
    },
    geography: {
      counties: (geography.counties || []).map(({ id, name }) => ({ id, name })).sort((a, b) => String(a.id).localeCompare(String(b.id))),
      municipalities: (geography.municipalities || []).map(({ id, name, county_id }) => ({ id, name, county_id })).sort((a, b) => String(a.id).localeCompare(String(b.id))),
    },
    organizations: [...new Set(organizations)].sort((a, b) => a.localeCompare(b)),
    source_inventory: {
      count: sourceItems.length,
      digest: inventoryDigest(sourceItems),
    },
    source_items: orderedSources.slice(0, MAX_STORY_SOURCE_ITEMS).map((item) => ({
      id: item.id,
      source_id: item.source_id,
      source_name: item.sources?.name || null,
      source_type: item.sources?.source_type || null,
      content_hash: item.content_hash,
      publisher: item.publisher,
      headline: item.headline,
      description: String(item.description || "").slice(0, 1500),
      published_at: item.published_at || null,
      canonical_url: item.canonical_url,
    })),
  };
};

export const storyInputFingerprint = (context) => createHash("sha256")
  .update(JSON.stringify(stable(storyProviderInput(context))))
  .digest("hex");

export const aiCacheKey = ({ operation, fingerprint, enrichmentVersion, schemaVersion, promptVersion, provider, model }) => createHash("sha256")
  .update([operation, fingerprint, enrichmentVersion, schemaVersion, promptVersion, provider, model].join("\n"))
  .digest("hex");

export const shouldEnrichStory = ({ state, fingerprint, enrichmentVersion, force = false }) => {
  if (force) return { eligible: true, reason: "editor_request" };
  if (!state) return { eligible: true, reason: "new_story" };
  if (state.enrichment_status === "running") return { eligible: false, reason: "already_running" };
  if (state.enrichment_status === "failed") return { eligible: true, reason: "retry_failed" };
  if (state.last_successful_fingerprint !== fingerprint) return { eligible: true, reason: "material_change" };
  if (state.enrichment_version !== enrichmentVersion) return { eligible: true, reason: "version_change" };
  if (state.requested_at && (!state.last_enriched_at || new Date(state.requested_at) > new Date(state.last_enriched_at))) return { eligible: true, reason: "editor_request" };
  return { eligible: false, reason: "cached" };
};

export const needsAiConfigurationRefresh = ({ state, config, schemaVersion, promptVersion }) => Boolean(state) && (
  state.enrichment_version !== config.aiEnrichmentVersion ||
  state.schema_version !== schemaVersion ||
  state.prompt_version !== promptVersion ||
  state.provider !== config.aiProvider ||
  state.model !== config.aiModel
);

export const enrichmentPriority = (candidate, at = Date.now()) => {
  const editorial = Array.isArray(candidate.editorial_queue) ? candidate.editorial_queue[0] : candidate.editorial_queue;
  const priorityEligible = candidate.corroboration?.priorityEligible === true || candidate.priorityEligible === true;
  if (candidate.requested_at && (!candidate.last_enriched_at || new Date(candidate.requested_at) > new Date(candidate.last_enriched_at))) return 100;
  if (editorial?.status === "keep") return 90;
  if (editorial?.route) return 85;
  if (priorityEligible && at - new Date(candidate.last_activity_at).getTime() <= 12 * 3_600_000) return 75;
  if (priorityEligible) return 65;
  return 5;
};

export const rankEnrichmentCandidates = (candidates, at = Date.now()) => [...candidates]
  .map((candidate) => ({ ...candidate, ai_priority: enrichmentPriority(candidate, at) }))
  .sort((a, b) => b.ai_priority - a.ai_priority || new Date(b.last_activity_at) - new Date(a.last_activity_at));

export const validateProviderResult = (operation, response) => {
  if (!response || typeof response !== "object") throw new Error("AI provider returned no structured response");
  const schema = operation === AI_OPERATIONS.COMPARE_SOURCES ? sourceComparisonSchema : storyEnrichmentResultSchema;
  return { ...response, output: schema.parse(response.output) };
};

export const validateSourceComparisonProvenance = (context, output) => {
  const allowed = new Set((context.sourceItems || []).map((item) => item.id));
  const cited = ["agreements", "differences", "primary_source_claims", "disputed_claims"]
    .flatMap((key) => output[key] || [])
    .flatMap((claim) => claim.source_item_ids || []);
  const invalid = [...new Set(cited.filter((id) => !allowed.has(id)))];
  if (invalid.length) {
    const error = new Error("AI source comparison cited evidence that is not attached to this Story");
    error.name = "AIProvenanceError";
    throw error;
  }
  return output;
};

export const runOptionalAiLayer = async ({ enabled, coreResult, runAi, runHousekeeping = null }) => {
  let housekeeping = null;
  try {
    housekeeping = runHousekeeping ? await runHousekeeping() : null;
  } catch (error) {
    housekeeping = { failed: true, error: error.message };
  }
  if (!enabled) return { ...coreResult, ai: { status: "disabled", attempted: 0, housekeeping } };
  try {
    return { ...coreResult, ai: await runAi(housekeeping) };
  } catch (error) {
    return { ...coreResult, ai: { status: "failed", attempted: 0, housekeeping, error: error.message } };
  }
};

export const runBoundedAiBatch = async ({ candidates, maxStories, processStory }) => {
  const selected = rankEnrichmentCandidates(candidates).slice(0, Math.max(0, maxStories));
  const results = [];
  for (const candidate of selected) {
    try {
      results.push(await processStory(candidate));
    } catch (error) {
      results.push({ storyId: candidate.story_id || candidate.id, status: "failed", error: error.message });
    }
  }
  return { status: results.some((item) => item.status === "failed") ? "partial" : "succeeded", attempted: selected.length, results };
};
