import { scoreStoryCandidate, STORY_CLUSTER_WINDOW_HOURS } from "./cluster.mjs";
import { refreshStoryAnalysis } from "./ingestion.mjs";
import { assessmentForSourceItem, evidenceOriginKeyFor } from "./signal.mjs";
import { requireData } from "./supabase.mjs";

export const STORY_RECONCILIATION_ALGORITHM_VERSION = "deterministic-evidence-anchor-v3";
export const STORY_RECONCILIATION_SCAN_LIMIT = 1_000;
export const STORY_RECONCILIATION_MERGE_LIMIT = 50;
export const STORY_RECONCILIATION_MAX_ITEMS = 12;
export const STORY_RECONCILIATION_MIN_CONFIDENCE = 0.70;
export const STORY_RECONCILIATION_AMBIGUITY_MARGIN = 0.10;

const MACHINE_LINK_METHODS = new Set(["created", "deterministic", "semantic", "reconciliation"]);
const MACHINE_LINK_ACTORS = new Set(["system", "system:story-reconciliation"]);
const array = (value) => Array.isArray(value) ? value : value ? [value] : [];
const normalized = (value) => String(value ?? "").trim().toLowerCase();
const instant = (value) => {
  const parsed = new Date(value || 0).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
};
const activeLinks = (story) => array(story.story_sources).filter((link) => !link.detached_at);
const queueFor = (story) => array(story.editorial_queue)[0] || null;
const reconciliationOnlyDecision = (decision) => decision?.action_type === "reconciliation_merge"
  && decision?.actor_id === "system:story-reconciliation"
  && decision?.actor_role === "system";

const currentDeterministicOrganizations = (story) => array(story.story_enrichments)
  .filter((row) => row?.is_current && row?.analysis_kind === "deterministic")
  .sort((left, right) => instant(right.created_at) - instant(left.created_at))[0]?.organizations || [];

const qualifyingItem = (link) => {
  const item = link?.source_items;
  const source = item?.sources;
  const assessment = assessmentForSourceItem(item);
  if (!item?.id || !item?.source_id || !item?.headline || item.processing_status !== "processed" || !source?.active || !assessment) return null;
  if (normalized(assessment.assessment_status) !== "reviewed"
    || normalized(assessment.evidence_role) !== "independent_journalism"
    || Number(assessment.verification_tier) < 2) return null;
  const groupKey = normalized(assessment.corroboration_group_key);
  if (!groupKey) return null;
  return {
    link,
    item,
    assessment,
    originKey: evidenceOriginKeyFor(item, groupKey),
  };
};

export const isUntouchedReconciliationStory = (story, { maxItems = STORY_RECONCILIATION_MAX_ITEMS } = {}) => {
  if (!story?.id || story.status !== "developing" || story.merged_into_story_id) return false;
  if (!Number.isFinite(Number(story.evidence_revision)) || Number(story.evidence_revision) < 1) return false;
  const queue = queueFor(story);
  if (!queue || queue.status !== "new" || queue.route || String(queue.notes || "").trim()
    || queue.decided_by || queue.decided_at || queue.routed_by || queue.routed_at) return false;
  if (array(story.editorial_decisions).some((decision) => !reconciliationOnlyDecision(decision))) return false;
  if (array(story.story_ai_state).length || array(story.ai_call_attempts).length || array(story.story_analyses).length) return false;
  const links = array(story.story_sources);
  if (!links.length || links.length > maxItems || links.some((link) => link.detached_at)) return false;
  if (links.some((link) => !MACHINE_LINK_METHODS.has(link.link_method) || !MACHINE_LINK_ACTORS.has(link.attached_by))) return false;
  return links.every((link) => Boolean(qualifyingItem(link)));
};

const storyEvidence = (story) => activeLinks(story).map(qualifyingItem).filter(Boolean);
const storyGeography = (story) => ({
  countyIds: array(story.story_counties).map((row) => row.county_id).filter((value) => value !== null && value !== undefined),
  municipalityIds: array(story.story_municipalities).map((row) => row.municipality_id).filter(Boolean),
});
const canonicalBefore = (target, source) => instant(target.first_seen_at) < instant(source.first_seen_at)
  || (instant(target.first_seen_at) === instant(source.first_seen_at) && String(target.id).localeCompare(String(source.id)) < 0);
const pairKey = (targetId, sourceId) => `${targetId}:${sourceId}`;

const candidateFor = (story) => {
  const evidence = storyEvidence(story);
  return {
    id: story.id,
    canonical_title: story.canonical_title,
    last_activity_at: story.last_activity_at,
    organizations: currentDeterministicOrganizations(story),
    geography: storyGeography(story),
    sourceIds: [...new Set(evidence.map(({ item }) => item.source_id))],
    sourceGroupKeys: [...new Set(evidence.map(({ originKey }) => originKey))],
    evidenceItems: evidence.map(({ item, originKey }) => ({
      sourceItemId: item.id,
      sourceId: item.source_id,
      sourceGroupKey: originKey,
      headline: item.headline,
      normalizedHeadline: item.normalized_headline,
      description: item.description || "",
      publishedAt: item.published_at,
      discoveredAt: item.discovered_at,
    })),
  };
};

const incomingFor = (story, evidence) => ({
  headline: evidence.item.headline,
  description: evidence.item.description || "",
  publishedAt: evidence.item.published_at,
  discoveredAt: evidence.item.discovered_at,
  sourceId: evidence.item.source_id,
  sourceGroupKey: evidence.originKey,
  geography: storyGeography(story),
});

const anchorTimeWithinWindow = (sourceItem, targetEvidence) => {
  const sourceAt = instant(sourceItem.published_at || sourceItem.discovered_at);
  const targetAt = instant(targetEvidence.publishedAt || targetEvidence.discoveredAt);
  return sourceAt > 0 && targetAt > 0
    && Math.abs(sourceAt - targetAt) <= STORY_CLUSTER_WINDOW_HOURS * 3_600_000;
};

export const scoreReconciliationPair = (sourceStory, targetStory) => {
  const targetCandidate = candidateFor(targetStory);
  const targetByItemId = new Map(targetCandidate.evidenceItems.map((item) => [item.sourceItemId, item]));
  const anchors = storyEvidence(sourceStory).map((sourceEvidence) => {
    const scored = scoreStoryCandidate(incomingFor(sourceStory, sourceEvidence), targetCandidate);
    const matched = targetByItemId.get(scored.signals.matchedSourceItemId);
    return {
      sourceItemId: sourceEvidence.item.id,
      matchedSourceItemId: scored.signals.matchedSourceItemId,
      score: scored.score,
      withinWindow: Boolean(matched && anchorTimeWithinWindow(sourceEvidence.item, matched)),
      strongAnchor: scored.score >= 0.78
        || scored.signals.fatalIncidentAlignment === 1
        || scored.signals.namedEventAlignment === 1
        || scored.signals.fundingProjectAlignment === 1
        || scored.signals.headline >= 0.8,
      signals: scored.signals,
    };
  });
  const confidence = anchors.length ? Math.min(...anchors.map((anchor) => anchor.score)) : 0;
  return { confidence: Number(confidence.toFixed(3)), anchors };
};

export const planStoryReconciliationPairs = (stories, {
  limit = STORY_RECONCILIATION_MERGE_LIMIT,
  maxItems = STORY_RECONCILIATION_MAX_ITEMS,
  minimumConfidence = STORY_RECONCILIATION_MIN_CONFIDENCE,
  ambiguityMargin = STORY_RECONCILIATION_AMBIGUITY_MARGIN,
  excludedPairs = new Set(),
} = {}) => {
  const boundedLimit = Math.min(50, Math.max(0, Number(limit) || 0));
  const eligible = array(stories).filter((story) => isUntouchedReconciliationStory(story, { maxItems }));
  const plans = [];

  for (const sourceStory of eligible) {
    const sourceEvidence = storyEvidence(sourceStory);
    const sourceOrigins = new Set(sourceEvidence.map(({ originKey }) => originKey));
    const contenders = eligible
      .filter((targetStory) => targetStory.id !== sourceStory.id
        && canonicalBefore(targetStory, sourceStory)
        && activeLinks(targetStory).length + activeLinks(sourceStory).length <= maxItems)
      .map((targetStory) => ({ targetStory, ...scoreReconciliationPair(sourceStory, targetStory) }))
      .filter(({ anchors }) => anchors.length === sourceEvidence.length
        && anchors.every((anchor) => anchor.matchedSourceItemId && anchor.withinWindow && anchor.strongAnchor))
      .sort((left, right) => right.confidence - left.confidence
        || String(left.targetStory.id).localeCompare(String(right.targetStory.id)));
    const best = contenders[0];
    if (!best || best.confidence < minimumConfidence) continue;
    const runnerUpConfidence = contenders[1]?.confidence ?? null;
    if (runnerUpConfidence !== null && best.confidence - runnerUpConfidence < ambiguityMargin) continue;
    const targetOrigins = new Set(storyEvidence(best.targetStory).map(({ originKey }) => originKey));
    if (![...sourceOrigins].some((origin) => !targetOrigins.has(origin))) continue;
    if (excludedPairs.has(pairKey(best.targetStory.id, sourceStory.id))) continue;
    plans.push({
      targetStoryId: best.targetStory.id,
      sourceStoryId: sourceStory.id,
      expectedTargetEvidenceRevision: best.targetStory.evidence_revision,
      expectedSourceEvidenceRevision: sourceStory.evidence_revision,
      expectedTargetSourceItemIds: activeLinks(best.targetStory).map((link) => link.source_item_id).sort(),
      expectedSourceSourceItemIds: activeLinks(sourceStory).map((link) => link.source_item_id).sort(),
      confidence: best.confidence,
      runnerUpConfidence,
      signals: {
        algorithmVersion: STORY_RECONCILIATION_ALGORITHM_VERSION,
        anchors: best.anchors.map(({ withinWindow: _withinWindow, strongAnchor: _strongAnchor, ...anchor }) => anchor),
      },
    });
  }

  return plans.sort((left, right) => right.confidence - left.confidence
    || String(left.targetStoryId).localeCompare(String(right.targetStoryId))
    || String(left.sourceStoryId).localeCompare(String(right.sourceStoryId))).slice(0, boundedLimit);
};

const STORY_RECONCILIATION_SELECT = `
  id,canonical_title,status,merged_into_story_id,first_seen_at,last_activity_at,evidence_revision,
  editorial_queue(status,route,notes,decided_by,decided_at,routed_by,routed_at),
  editorial_decisions(action_type,actor_id,actor_role),
  story_ai_state(story_id),ai_call_attempts(id),story_analyses(id),
  story_counties(county_id),story_municipalities(municipality_id),
  story_enrichments(organizations,is_current,analysis_kind,created_at),
  story_sources(source_item_id,link_method,confidence,signals,attached_at,attached_by,detached_at,detached_by,detach_reason,
    source_items(id,source_id,headline,normalized_headline,description,author,published_at,discovered_at,processing_status,
      sources(id,active,source_assessments(id,assessment_status,evidence_role,verification_tier,corroboration_group_key,assessed_at,superseded_at))))
`;

export const loadReconciliationStories = async (supabase, { scanLimit = STORY_RECONCILIATION_SCAN_LIMIT } = {}) => {
  const bounded = Math.min(2_000, Math.max(2, Number(scanLimit) || STORY_RECONCILIATION_SCAN_LIMIT));
  const stories = [];
  const pageSize = 250;
  for (let start = 0; start < bounded; start += pageSize) {
    const end = Math.min(bounded, start + pageSize) - 1;
    const page = requireData(await supabase.from("stories").select(STORY_RECONCILIATION_SELECT)
      .eq("status", "developing")
      .order("last_activity_at", { ascending: false })
      .range(start, end), "Load reconciliation Story candidates");
    stories.push(...page);
    if (page.length < end - start + 1) break;
  }
  return stories;
};

export const runStoryReconciliation = async ({
  supabase,
  config = null,
  apply = false,
  triggeredBy,
  scanLimit = STORY_RECONCILIATION_SCAN_LIMIT,
  mergeLimit = STORY_RECONCILIATION_MERGE_LIMIT,
  maxItems = STORY_RECONCILIATION_MAX_ITEMS,
  minimumConfidence = STORY_RECONCILIATION_MIN_CONFIDENCE,
  ambiguityMargin = STORY_RECONCILIATION_AMBIGUITY_MARGIN,
  deadlineAt = null,
  loadStories = loadReconciliationStories,
  refreshAnalysis = refreshStoryAnalysis,
} = {}) => {
  if (!supabase) throw new Error("Story reconciliation requires a Supabase client");
  if (!String(triggeredBy || "").trim()) throw new Error("Story reconciliation requires an explicit actor");
  const boundedMergeLimit = Math.min(50, Math.max(1, Number(mergeLimit) || STORY_RECONCILIATION_MERGE_LIMIT));
  const run = requireData(await supabase.rpc("start_story_reconciliation_run", {
    p_mode: apply ? "apply" : "dry_run",
    p_algorithm_version: STORY_RECONCILIATION_ALGORITHM_VERSION,
    p_scan_limit: Math.min(2_000, Math.max(2, Number(scanLimit) || STORY_RECONCILIATION_SCAN_LIMIT)),
    p_merge_limit: boundedMergeLimit,
    p_max_items_per_story: Math.min(20, Math.max(2, Number(maxItems) || STORY_RECONCILIATION_MAX_ITEMS)),
    p_minimum_confidence: minimumConfidence,
    p_ambiguity_margin: ambiguityMargin,
    p_triggered_by: String(triggeredBy).trim(),
  }), "Start Story reconciliation run");

  let stories = [];
  const excludedPairs = new Set();
  const results = [];
  const errors = [];
  const touchedTargetIds = new Set();
  let candidatesEvaluated = 0;
  let appliedCount = 0;
  let deadlineReached = false;
  const deadlineMs = instant(deadlineAt);

  try {
    stories = await loadStories(supabase, { scanLimit });
    candidatesEvaluated = stories.length;
    while (results.length < boundedMergeLimit) {
      if (deadlineMs && Date.now() + 30_000 >= deadlineMs) {
        deadlineReached = true;
        break;
      }
      const plans = planStoryReconciliationPairs(stories, {
        limit: apply ? 1 : boundedMergeLimit - results.length,
        maxItems,
        minimumConfidence,
        ambiguityMargin,
        excludedPairs,
      });
      if (!plans.length) break;
      for (const plan of plans) {
        if (results.length >= boundedMergeLimit) break;
        let result;
        try {
          result = requireData(await supabase.rpc("reconcile_story_pair", {
            p_run_id: run.id,
            p_target_story_id: plan.targetStoryId,
            p_source_story_id: plan.sourceStoryId,
            p_expected_target_evidence_revision: plan.expectedTargetEvidenceRevision,
            p_expected_source_evidence_revision: plan.expectedSourceEvidenceRevision,
            p_expected_target_source_item_ids: plan.expectedTargetSourceItemIds,
            p_expected_source_source_item_ids: plan.expectedSourceSourceItemIds,
            p_confidence: plan.confidence,
            p_runner_up_confidence: plan.runnerUpConfidence,
            p_signals: plan.signals,
          }), "Reconcile Story pair");
          results.push(result);
          excludedPairs.add(pairKey(plan.targetStoryId, plan.sourceStoryId));
          if (result.outcome === "applied") {
            appliedCount += 1;
            touchedTargetIds.add(plan.targetStoryId);
            try {
              // Keep the target eligible for the remainder of this bounded
              // convergence pass. AI may be queued once the final evidence set
              // is stable, never between pairwise repairs.
              await refreshAnalysis(supabase, plan.targetStoryId, null, { ...(config || {}), aiEnabled: false });
              if (!result.recovery_source_item_id) throw new Error("Applied reconciliation returned no durable recovery SourceItem");
              const recoveryCleared = requireData(await supabase.rpc("complete_story_reconciliation_refresh", {
                p_run_id: run.id,
                p_story_id: plan.targetStoryId,
                p_source_item_id: result.recovery_source_item_id,
              }), "Complete Story reconciliation refresh");
              if (!recoveryCleared) {
                errors.push(`Durable analysis recovery remains queued for ${plan.targetStoryId}`);
              }
            } catch (error) {
              // The merge RPC already committed one SourceItem as `error` in
              // the same transaction as the evidence move. Leaving it alone is
              // the crash-safe handoff to normal ingestion backlog recovery.
              errors.push(`Analysis refresh ${plan.targetStoryId}: ${error.message}`);
            }
            stories = await loadStories(supabase, { scanLimit });
            candidatesEvaluated += stories.length;
            break;
          }
        } catch (error) {
          excludedPairs.add(pairKey(plan.targetStoryId, plan.sourceStoryId));
          errors.push(`${plan.sourceStoryId} -> ${plan.targetStoryId}: ${error.message}`);
        }
      }
      if (!apply) break;
    }

    if (apply && config?.aiEnabled && (!deadlineMs || Date.now() + 30_000 < deadlineMs)) {
      for (const storyId of touchedTargetIds) {
        try {
          await refreshAnalysis(supabase, storyId, null, config);
        } catch (error) {
          errors.push(`Final analysis refresh ${storyId}: ${error.message}`);
        }
      }
    }
  } catch (error) {
    errors.push(`Reconciliation run: ${error.message}`);
    throw error;
  } finally {
    const skipped = results.filter((result) => result.outcome === "skipped").length;
    const status = errors.length
      ? (appliedCount || results.length ? "partial" : "failed")
      : deadlineReached ? "partial" : "succeeded";
    requireData(await supabase.rpc("finish_story_reconciliation_run", {
      p_run_id: run.id,
      p_status: status,
      p_candidates_evaluated: candidatesEvaluated,
      p_merges_applied: appliedCount,
      p_pairs_skipped: skipped,
      p_errors: errors.length,
      p_error_summary: errors.join(" | "),
    }), "Finish Story reconciliation run");
  }

  return { runId: run.id, mode: apply ? "apply" : "dry_run", applied: appliedCount, deferred: deadlineReached, results, errors };
};
