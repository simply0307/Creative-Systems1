const REVIEWED_STATUS = "reviewed";
const JOURNALISM_ROLE = "independent_journalism";
const REPUTABLE_ROLES = new Set([
  JOURNALISM_ROLE,
  "official_primary",
  "institutional_primary",
]);
const KNOWN_ROLES = new Set([
  ...REPUTABLE_ROLES,
  "context_only",
  "excluded",
]);

const normalized = (value) => String(value ?? "").trim().toLowerCase();
const numericTier = (value) => value === null || value === undefined || String(value).trim() === ""
  ? Number.NaN
  : Number(value);
const timestamp = (value) => {
  const parsed = new Date(value || 0).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
};

const bylineText = (sourceItem) => {
  const item = sourceItem?.source_items || sourceItem || {};
  const rawByline = item.author ?? item.byline;
  const value = rawByline && typeof rawByline === "object" ? rawByline.name : rawByline;
  return normalized(value)
    .replace(/^by\s+/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
};

/**
 * Recognize exact, well-known syndication bylines and explicit compound
 * credits where the service is the first or final contributor. Broad substring
 * matching would risk collapsing an outlet's own reporting merely because it
 * mentions a wire service. Unrecognized or missing bylines intentionally fall
 * back to the reviewed editorial-control group.
 */
export const evidenceOriginKeyFor = (sourceItem, groupKey) => {
  const byline = bylineText(sourceItem);
  if (/^(?:new jersey|n j|nj) state ?house news(?: service)?(?:$| (?:and|with) )| (?:new jersey|n j|nj) state ?house news(?: service)?$/.test(byline)) {
    return "origin:new-jersey-statehouse-news-service";
  }
  if (/^(?:the )?associated press(?:$| (?:and|with) )| (?:the )?associated press$|^ap$/.test(byline)) return "origin:associated-press";
  if (/^(?:thomson )?reuters(?:$| (?:and|with) )| (?:thomson )?reuters$/.test(byline)) return "origin:reuters";
  return `provider:${normalized(groupKey)}`;
};

const createEvidenceGroups = () => {
  const parents = new Map();
  const ensure = (key) => {
    if (!parents.has(key)) parents.set(key, key);
    return key;
  };
  const find = (key) => {
    ensure(key);
    let root = key;
    while (parents.get(root) !== root) root = parents.get(root);
    let current = key;
    while (parents.get(current) !== current) {
      const next = parents.get(current);
      parents.set(current, root);
      current = next;
    }
    return root;
  };
  const union = (left, right) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parents.set(rightRoot, leftRoot);
  };
  return { find, union };
};

const assessmentCandidates = (sourceItem) => {
  const item = sourceItem?.source_items || sourceItem || {};
  const source = item.sources || item.source || {};
  const candidates = [
    sourceItem?.assessment,
    sourceItem?.source_assessment,
    ...(Array.isArray(sourceItem?.source_assessments) ? sourceItem.source_assessments : []),
    item.assessment,
    item.source_assessment,
    ...(Array.isArray(item.source_assessments) ? item.source_assessments : []),
    source.assessment,
    source.source_assessment,
    ...(Array.isArray(source.source_assessments) ? source.source_assessments : []),
  ].filter((candidate) => candidate && typeof candidate === "object");
  return [...new Set(candidates)];
};

/**
 * Returns the current source assessment attached to a source item.
 * Superseded assessments never participate. If malformed data exposes more
 * than one current row, the newest assessed row wins deterministically.
 */
export const assessmentForSourceItem = (sourceItem) => assessmentCandidates(sourceItem)
  .filter((assessment) => !assessment.superseded_at)
  .sort((left, right) => timestamp(right.assessed_at) - timestamp(left.assessed_at)
    || normalized(right.id).localeCompare(normalized(left.id)))[0] || null;

const sourceKeyFor = (sourceItem, index) => {
  const item = sourceItem?.source_items || sourceItem || {};
  const source = item.sources || item.source || {};
  return normalized(item.source_id || item.sourceId || source.id) || `unknown-source-${index}`;
};

const detached = (sourceItem) => Boolean(sourceItem?.detached_at || sourceItem?.detachedAt);

/**
 * Assess whether a Story has enough reviewed, independent corroboration to be
 * eligible for automated above-low prioritization. This evaluates evidence
 * support only; it does not judge truth and it never overrides an editor.
 */
export const assessStorySignal = (sourceItems = []) => {
  const activeItems = (Array.isArray(sourceItems) ? sourceItems : []).filter((item) => !detached(item));
  const distinctSources = new Set();
  const assessedSources = new Set();
  const qualifyingEvidence = [];

  activeItems.forEach((sourceItem, index) => {
    const sourceKey = sourceKeyFor(sourceItem, index);
    distinctSources.add(sourceKey);
    const assessment = assessmentForSourceItem(sourceItem);
    if (!assessment) return;

    const status = normalized(assessment.assessment_status);
    const role = normalized(assessment.evidence_role);
    const groupKey = normalized(assessment.corroboration_group_key);
    const tier = numericTier(assessment.verification_tier);
    const completeReviewedAssessment = status === REVIEWED_STATUS
      && KNOWN_ROLES.has(role)
      && groupKey
      && Number.isFinite(tier);
    if (!completeReviewedAssessment) return;

    assessedSources.add(sourceKey);
    if (tier < 2 || !REPUTABLE_ROLES.has(role)) return;

    qualifyingEvidence.push({
      sourceKey,
      groupKey,
      originKey: evidenceOriginKeyFor(sourceItem, groupKey),
      role,
    });
  });

  // Model corroboration as connected evidence groups. A reviewed provider can
  // contribute at most once, and separate providers carrying the same
  // recognized wire/byline origin are joined into that same contribution.
  const evidenceGroups = createEvidenceGroups();
  qualifyingEvidence.forEach(({ sourceKey, groupKey, originKey }) => {
    const sourceNode = `source:${sourceKey}`;
    const providerNode = `provider:${groupKey}`;
    evidenceGroups.union(sourceNode, providerNode);
    evidenceGroups.union(providerNode, originKey);
  });
  const independentProviders = new Set();
  const journalismGroups = new Set();
  const reputableAccountGroups = new Set();
  qualifyingEvidence.forEach(({ groupKey, role }) => {
    const evidenceGroup = evidenceGroups.find(`provider:${groupKey}`);
    independentProviders.add(evidenceGroup);
    reputableAccountGroups.add(evidenceGroup);
    if (role === JOURNALISM_ROLE) journalismGroups.add(evidenceGroup);
  });

  const sourceItemCount = activeItems.length;
  const distinctSourceCount = distinctSources.size;
  const independentProviderCount = independentProviders.size;
  const qualifiedJournalismCount = journalismGroups.size;
  const reputableAccountCount = reputableAccountGroups.size;
  const unassessedSourceCount = [...distinctSources].filter((sourceKey) => !assessedSources.has(sourceKey)).length;
  const journalismEligible = qualifiedJournalismCount >= 2;
  const reputableAccountsEligible = reputableAccountCount >= 3 && qualifiedJournalismCount >= 1;
  const priorityEligible = journalismEligible || reputableAccountsEligible;
  const status = journalismEligible
    ? "corroborated_journalism"
    : reputableAccountsEligible ? "corroborated_reputable_accounts" : "insufficient_corroboration";
  const reason = journalismEligible
    ? `Eligible: ${qualifiedJournalismCount} independent reviewed journalism evidence groups meet verification tier 2 or higher.`
    : reputableAccountsEligible
      ? `Eligible: ${reputableAccountCount} independent reviewed reputable evidence groups meet verification tier 2 or higher, including ${qualifiedJournalismCount} journalism group${qualifiedJournalismCount === 1 ? "" : "s"}.`
      : `Not eligible: requires either 2 independent reviewed journalism evidence groups at verification tier 2+ or 3 reviewed reputable evidence groups at tier 2+ including journalism; found ${qualifiedJournalismCount} journalism and ${reputableAccountCount} reputable group${reputableAccountCount === 1 ? "" : "s"} across ${independentProviderCount} reviewed independent evidence group${independentProviderCount === 1 ? "" : "s"}, with ${unassessedSourceCount} unassessed source${unassessedSourceCount === 1 ? "" : "s"}.`;

  return {
    sourceItemCount,
    distinctSourceCount,
    independentProviderCount,
    qualifiedJournalismCount,
    reputableAccountCount,
    unassessedSourceCount,
    status,
    priorityEligible,
    reason,
  };
};
