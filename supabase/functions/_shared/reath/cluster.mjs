import { geographyOverlap } from "./geography.mjs";
import { explicitDatesCompatible, explicitDateTerms, fatalIncidentMatch, fundingProjectMatch, liveVenueSubjectsConflict, localEventMatch, namedEventMatch, namedOrganizations, properNounPhrases, stripExplicitDates, tokenSimilarity } from "./headline.mjs";

export const STORY_CLUSTER_WINDOW_HOURS = 72;

const overlap = (left = [], right = []) => {
  const a = new Set(left.map((value) => value.toLowerCase()));
  const b = new Set(right.map((value) => value.toLowerCase()));
  if (!a.size || !b.size) return 0;
  return [...a].some((value) => b.has(value)) ? 1 : 0;
};
const municipalityOverlap = (left = {}, right = {}) => {
  const a = new Set(left.municipalityIds || []);
  const b = new Set(right.municipalityIds || []);
  if (!a.size || !b.size) return 0;
  return [...a].some((value) => b.has(value)) ? 1 : 0;
};
const timeProximity = (left, right, windowHours = STORY_CLUSTER_WINDOW_HOURS) => {
  const delta = Math.abs(new Date(left).getTime() - new Date(right).getTime()) / 3_600_000;
  return Number.isFinite(delta) ? Math.max(0, 1 - delta / windowHours) : 0;
};

export const scoreStoryCandidate = (item, candidate) => {
  const activeEvidence = candidate.evidenceItems || [];
  const evidenceComparisons = activeEvidence.map((evidence) => ({
    headline: evidence.headline || evidence.normalizedHeadline,
    description: evidence.description || "",
    activityAt: evidence.publishedAt || evidence.discoveredAt || candidate.last_activity_at,
    sourceItemId: evidence.sourceItemId || null,
  })).filter((evidence) => evidence.headline);
  evidenceComparisons.push({
    headline: candidate.canonical_title,
    description: "",
    activityAt: candidate.last_activity_at,
    sourceItemId: null,
  });
  const itemHeadlineDates = explicitDateTerms(item.headline);
  const sameSource = Boolean(item.sourceId) && (candidate.sourceIds || []).includes(item.sourceId);
  const sameSourceEvidence = sameSource
    ? activeEvidence.filter((evidence) => evidence.sourceId === item.sourceId && (evidence.headline || evidence.normalizedHeadline))
    : [];
  const conflictsWithSameSourceEdition = sameSourceEvidence.some((evidence) => {
    const evidenceHeadline = evidence.headline || evidence.normalizedHeadline;
    const evidenceDates = explicitDateTerms(evidenceHeadline);
    return itemHeadlineDates.length > 0
      && evidenceDates.length > 0
      && !explicitDatesCompatible(itemHeadlineDates, evidenceDates)
      && tokenSimilarity(stripExplicitDates(item.headline), stripExplicitDates(evidenceHeadline)) >= 0.9;
  });
  const conflictsWithSameSourceLiveSubject = sameSourceEvidence.some((evidence) => liveVenueSubjectsConflict(
    item.headline,
    evidence.headline || evidence.normalizedHeadline,
  ));

  const scoreComparison = (comparison) => {
    const itemText = `${item.headline} ${item.description || ""}`;
    const comparisonText = `${comparison.headline} ${comparison.description || ""}`;
    const headline = tokenSimilarity(item.headline, comparison.headline);
    const organizations = overlap(namedOrganizations(itemText), candidate.organizations || []);
    const properNouns = overlap(properNounPhrases(itemText), properNounPhrases(comparison.headline));
    const geography = geographyOverlap(item.geography, candidate.geography);
    const explicitDates = Number(explicitDatesCompatible(explicitDateTerms(`${item.headline} ${item.description}`), explicitDateTerms(comparison.headline)));
    const candidateHeadlineDates = explicitDateTerms(comparison.headline);
    const dateStrippedSimilarity = tokenSimilarity(stripExplicitDates(item.headline), stripExplicitDates(comparison.headline));
    const municipality = municipalityOverlap(item.geography, candidate.geography);
    const dateEditionConflict = Number(conflictsWithSameSourceEdition || (sameSource
      && itemHeadlineDates.length > 0
      && candidateHeadlineDates.length > 0
      && !explicitDatesCompatible(itemHeadlineDates, candidateHeadlineDates)
      && dateStrippedSimilarity >= 0.9));
    const liveVenueSubjectConflict = Number(conflictsWithSameSourceLiveSubject
      || (sameSource && liveVenueSubjectsConflict(item.headline, comparison.headline)));
    const time = timeProximity(item.publishedAt || item.discoveredAt, comparison.activityAt);
    const sourceGroupKey = item.sourceGroupKey || (item.sourceId ? `source:${item.sourceId}` : null);
    const candidateGroupKeys = candidate.sourceGroupKeys?.length
      ? candidate.sourceGroupKeys
      : (candidate.sourceIds || []).map((sourceId) => `source:${sourceId}`);
    const sourceDiversity = sourceGroupKey && candidateGroupKeys.length
      ? Number(!candidateGroupKeys.includes(sourceGroupKey))
      : 0;
    const fatalIncident = fatalIncidentMatch(item.headline, comparison.headline);
    // Matching fatal-incident facts are a stronger semantic headline signal than
    // surface wording, but only inside the same municipality and a tight time span.
    // This lets independently worded reports meet without making generic fires,
    // crashes, or deaths interchangeable.
    const fatalIncidentAlignment = Number(fatalIncident.aligned && municipality === 1 && time >= 0.5);
    const namedEvent = namedEventMatch(itemText, comparisonText);
    // Only an enacted-law event is inherently statewide. Missing municipality
    // inference is not treated as statewide for arrests or other local events.
    const statewideContext = Number(["civil_settlement", "law_enactment"].includes(namedEvent.action));
    const independentlyNamedPerson = Number(namedEvent.anchorType === "person" && sourceDiversity === 1);
    const independentlyNamedCourtSubject = Number(namedEvent.action === "court_ruling"
      && namedEvent.anchorType === "organization"
      && sourceDiversity === 1);
    const namedEventDates = explicitDateTerms(itemText);
    const comparisonEventDates = explicitDateTerms(comparisonText);
    const namedEventDateConflict = Number(namedEventDates.length > 0
      && comparisonEventDates.length > 0
      && !explicitDatesCompatible(namedEventDates, comparisonEventDates));
    // Independently worded reports can join on a named subject plus two stable
    // event facts, but only within 36 hours and a compatible locality/statewide
    // context. The ordinary global threshold remains unchanged.
    const namedEventAlignment = Number(namedEvent.aligned
      && time >= 0.5
      && (municipality === 1 || statewideContext === 1 || independentlyNamedPerson === 1 || independentlyNamedCourtSubject === 1)
      && !namedEventDateConflict);
    const fundingProject = fundingProjectMatch(itemText, comparisonText);
    // A matching monetary decision is a strong event anchor only when the
    // reports also share a two-token project phrase, municipality, funding
    // language, and the normal 72-hour candidate window.
    const fundingProjectAlignment = Number(fundingProject.aligned && municipality === 1 && time > 0);
    const localEvent = localEventMatch(item.headline, comparison.headline);
    // Three distinctive shared headline anchors can bridge independently
    // worded local reports, but only for different editorial-control groups,
    // the exact same municipality, and a 36-hour window. Numeric conflicts
    // fail closed inside localEventMatch.
    const localEventAlignment = Number(localEvent.aligned
      && sourceDiversity === 1
      && municipality === 1
      && time >= 0.5);
    const semanticHeadline = Math.max(headline, fatalIncidentAlignment ? 0.72 : 0, namedEventAlignment ? 0.84 : 0, fundingProjectAlignment ? 0.86 : 0, localEventAlignment ? 0.75 : 0);
    const namedEventCorroboration = namedEventAlignment ? 0.11 : 0;
    const fundingProjectCorroboration = fundingProjectAlignment ? 0.11 : 0;
    const localEventCorroboration = localEventAlignment ? 0.06 : 0;
    const corroboration = semanticHeadline >= 0.5 ? properNouns * 0.04 + explicitDates * 0.04 + sourceDiversity * 0.02 : 0;
    const score = dateEditionConflict || liveVenueSubjectConflict ? 0 : Math.min(1, semanticHeadline * 0.62 + organizations * 0.13 + geography * 0.15 + time * 0.10 + corroboration + namedEventCorroboration + fundingProjectCorroboration + localEventCorroboration);
    return {
      score: Number(score.toFixed(3)),
      signals: {
        headline,
        semanticHeadline,
        organizations,
        properNouns,
        geography,
        municipality,
        explicitDates,
        dateEditionConflict,
        dateStrippedSimilarity,
        liveVenueSubjectConflict,
        time,
        fatalIncidentAlignment,
        fatalIncidentType: fatalIncident.incidentType,
        fatalIncidentParticipant: fatalIncident.participant,
        fatalIncidentParticipantCount: fatalIncident.participantCount,
        fatalIncidentCountConflict: Number(fatalIncident.countConflict),
        namedEventAlignment,
        namedEventAction: namedEvent.action,
        namedEventAnchor: namedEvent.anchor,
        namedEventAnchorType: namedEvent.anchorType,
        namedEventTopics: namedEvent.topics,
        namedEventPersonConflict: Number(namedEvent.personConflict),
        namedEventStatewideContext: statewideContext,
        namedEventIndependentPersonContext: independentlyNamedPerson,
        namedEventIndependentCourtSubjectContext: independentlyNamedCourtSubject,
        namedEventDateConflict,
        namedEventCorroboration,
        fundingProjectAlignment,
        fundingProjectAmount: fundingProject.amount,
        fundingProjectAnchor: fundingProject.anchor,
        fundingProjectCorroboration,
        localEventAlignment,
        localEventSharedTokens: localEvent.sharedTokens,
        localEventNumberConflict: Number(localEvent.numberConflict),
        localEventTypeConflict: Number(localEvent.eventTypeConflict),
        localEventCorroboration,
        sourceDiversity,
        matchedSourceItemId: comparison.sourceItemId,
      },
    };
  };

  return evidenceComparisons
    .map(scoreComparison)
    .sort((left, right) => right.score - left.score
      || Number(Boolean(right.signals.matchedSourceItemId)) - Number(Boolean(left.signals.matchedSourceItemId))
      || String(left.signals.matchedSourceItemId || "").localeCompare(String(right.signals.matchedSourceItemId || "")))[0];
};

export const chooseStory = (item, candidates, { threshold = 0.68, ambiguityMargin = 0.08 } = {}) => {
  const ranked = candidates.map((candidate) => ({ candidate, ...scoreStoryCandidate(item, candidate) })).sort((a, b) => b.score - a.score);
  const best = ranked[0];
  if (!best || best.score < threshold) {
    const reason = best?.signals.dateEditionConflict
      ? "conflicting_headline_dates"
      : best?.signals.liveVenueSubjectConflict ? "conflicting_live_venue_subjects" : "no_confident_match";
    return { action: "create", reason, ranked };
  }
  const second = ranked[1];
  if (second && best.score < 0.82 && best.score - second.score < ambiguityMargin) {
    return { action: "create", reason: "ambiguous_matches", ranked };
  }
  return { action: "attach", story: best.candidate, confidence: best.score, signals: best.signals, ranked };
};

export const planStoryMerge = ({ targetStoryId, sourceStoryId, sourceItemIds = [] }) => {
  if (!targetStoryId || !sourceStoryId || targetStoryId === sourceStoryId) throw new Error("Merge requires distinct source and target stories");
  return { targetStoryId, sourceStoryId, sourceItemIds: [...new Set(sourceItemIds)] };
};

export const planDetach = ({ storyId, sourceItemId, reason }) => {
  if (!storyId || !sourceItemId) throw new Error("Detach requires story and source item IDs");
  if (String(reason || "").trim().length < 3) throw new Error("Detach requires a reason");
  return { storyId, sourceItemId, reason: String(reason).trim() };
};
