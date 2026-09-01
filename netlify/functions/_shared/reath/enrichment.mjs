import { z } from "zod";
import { namedOrganizations } from "./headline.mjs";
import { assessStorySignal } from "./signal.mjs";

const score = z.number().int().min(0).max(100);
const boundedLabels = z.array(z.string().min(1).max(160)).max(40);
export const enrichmentSchema = z.strictObject({
  nj_relevance: score,
  scope: z.enum(["state", "regional", "county", "municipality", "unknown"]),
  counties: boundedLabels,
  municipalities: boundedLabels,
  topics: boundedLabels,
  people: boundedLabels,
  organizations: boundedLabels,
  event_type: z.string().min(1).max(100),
  event_date: z.iso.date().nullable(),
  public_impact: score,
  civic_utility: score,
  novelty: score,
  human_interest: score,
  emotional_register: z.string().min(1).max(100),
  reath_potential: score,
  satire_potential: score,
  confidence: z.number().min(0).max(1),
});

const scoreReasonsSchema = z.strictObject({
  local_impact: z.string().min(1).max(500),
  civic_utility: z.string().min(1).max(500),
  significance: z.string().min(1).max(500),
  momentum: z.string().min(1).max(500),
  novelty: z.string().min(1).max(500),
  human_interest: z.string().min(1).max(500),
  emotional_resonance: z.string().min(1).max(500),
  reath_potential: z.string().min(1).max(500),
  satire_potential: z.string().min(1).max(500),
  locality: z.string().min(1).max(500),
  confidence: z.string().min(1).max(500),
});

export const scoreSchema = z.strictObject({
  local_impact: score,
  civic_utility: score,
  significance: score,
  momentum: score,
  novelty: score,
  human_interest: score,
  emotional_resonance: score,
  reath_potential: score,
  satire_potential: score,
  locality: score,
  confidence: score,
  reasons: scoreReasonsSchema,
});

export const briefingSchema = z.strictObject({
  summary_internal: z.string().min(1).max(3000),
  why_it_may_matter: z.string().min(1).max(2000),
  disputed_or_different: z.string().min(1).max(3000),
  unknowns: z.string().min(1).max(3000),
});

export const storyEnrichmentResultSchema = z.strictObject({
  enrichment: enrichmentSchema,
  scores: scoreSchema,
  briefing: briefingSchema,
});

const comparisonClaimSchema = z.strictObject({
  claim: z.string().min(1).max(1200),
  source_item_ids: z.array(z.uuid()).min(1).max(30),
});

export const sourceComparisonSchema = z.strictObject({
  agreements: z.array(comparisonClaimSchema).max(30),
  differences: z.array(comparisonClaimSchema).max(30),
  primary_source_claims: z.array(comparisonClaimSchema).max(30),
  disputed_claims: z.array(comparisonClaimSchema).max(30),
  unknowns: z.array(z.string().min(1).max(1200)).max(30),
  development_summary: z.string().min(1).max(3000),
  confidence: z.number().min(0).max(1),
});

const topicRules = new Map([
  ["government", /\b(governor|legislature|senate|assembly|mayor|council|ordinance|budget|agency)\b/i],
  ["courts", /\b(court|judge|lawsuit|indict|attorney general|prosecutor)\b/i],
  ["transportation", /\b(transit|train|bus|traffic|road|bridge|turnpike|parkway|nj transit)\b/i],
  ["environment", /\b(environment|climate|flood|pollution|water|wildfire|drought|storm)\b/i],
  ["education", /\b(school|student|teacher|university|college|education)\b/i],
  ["health", /\b(health|hospital|disease|medical|medicaid|mental health)\b/i],
  ["business", /\b(business|company|jobs|economy|development|real estate)\b/i],
  ["public safety", /\b(police|fire|shooting|crash|emergency|missing|rescue)\b/i],
  ["culture", /\b(art|music|festival|theater|film|food|museum|culture)\b/i],
  ["housing", /\b(housing|rent|tenant|zoning|affordable|homeless)\b/i],
]);
const bizarre = /\b(bizarre|odd|weird|unexpected|mystery|mascot|goat|alligator|ufo|escape[ds]?|naked|giant|record-breaking)\b/i;
const civic = /\b(election|vote|deadline|closure|hearing|meeting|recall|warning|advisory|application|benefit|tax|law|rule)\b/i;
const impact = /\b(statewide|million|billion|thousand|emergency|shutdown|strike|ban|settlement|evacuat|outage)\b/i;
const emotion = /\b(killed|death|grief|hero|rescue|family|child|beloved|celebrat|outrage|fear)\b/i;

const cap = (value) => Math.max(0, Math.min(100, Math.round(value)));
const eventType = (topics) => topics.includes("courts") ? "legal" : topics.includes("public safety") ? "public_safety" : topics.includes("government") ? "government_action" : topics.includes("culture") ? "cultural_event" : topics.includes("business") ? "business" : "other";

export const deterministicEnrichment = ({ story, sourceItems, geography }) => {
  const combined = [story.canonical_title, ...sourceItems.flatMap((item) => [item.headline, item.description])].join(" ");
  const topics = [...topicRules].filter(([, pattern]) => pattern.test(combined)).map(([topic]) => topic);
  const corroboration = assessStorySignal(sourceItems);
  const sourceCount = corroboration.sourceItemCount;
  const locality = geography.municipalities.length ? 100 : geography.counties.length ? 85 : 65;
  const civicUtility = cap(35 + (civic.test(combined) ? 40 : 0) + (topics.includes("government") ? 15 : 0));
  const publicImpact = cap(30 + (impact.test(combined) ? 40 : 0));
  const novelty = cap(35 + (bizarre.test(combined) ? 45 : 0));
  const humanInterest = cap(35 + (emotion.test(combined) ? 40 : 0) + (topics.includes("culture") ? 10 : 0));
  const reathPotential = cap(25 + novelty * 0.55 + locality * 0.2);
  const satirePotential = cap(15 + (bizarre.test(combined) ? 60 : 0) + (topics.includes("government") ? 10 : 0));
  const confidence = Number(Math.min(0.95,
    0.48 + Math.min(corroboration.reputableAccountCount, 4) * 0.08 + (corroboration.priorityEligible ? 0.1 : 0) + (geography.counties.length ? 0.08 : 0),
  ).toFixed(3));
  const momentum = corroboration.priorityEligible
    ? cap(60 + corroboration.qualifiedJournalismCount * 8 + Math.max(0, corroboration.reputableAccountCount - corroboration.qualifiedJournalismCount) * 4)
    : cap(15 + corroboration.reputableAccountCount * 8);
  const scope = geography.municipalities.length ? "municipality" : geography.counties.length === 1 ? "county" : geography.counties.length > 1 ? "regional" : "state";
  const parsed = enrichmentSchema.parse({
    nj_relevance: 100,
    scope,
    counties: geography.counties.map((county) => county.name),
    municipalities: geography.municipalities.map((municipality) => municipality.name),
    topics,
    people: [],
    organizations: namedOrganizations(combined),
    event_type: eventType(topics),
    event_date: story.event_date || null,
    public_impact: publicImpact,
    civic_utility: civicUtility,
    novelty,
    human_interest: humanInterest,
    emotional_register: emotion.test(combined) ? "emotionally charged" : "neutral",
    reath_potential: reathPotential,
    satire_potential: satirePotential,
    confidence,
  });
  const scores = scoreSchema.parse({
    local_impact: cap(locality * 0.7 + publicImpact * 0.3),
    civic_utility: civicUtility,
    significance: publicImpact,
    momentum,
    novelty,
    human_interest: humanInterest,
    emotional_resonance: emotion.test(combined) ? 75 : 35,
    reath_potential: reathPotential,
    satire_potential: satirePotential,
    locality,
    confidence: cap(confidence * 100),
    reasons: {
      local_impact: geography.municipalities.length ? "The available evidence identifies a municipality." : geography.counties.length ? "The available evidence identifies at least one county." : "Only statewide geography is currently available.",
      reath_potential: reathPotential >= 70 ? "Strong local specificity plus an unusual or revealing premise." : "No unusually strong deterministic Reath signal yet.",
      civic_utility: civicUtility >= 70 ? "Contains actionable civic, deadline, rule, or public-service language." : "Limited actionable civic language in current source evidence.",
      significance: publicImpact >= 70 ? "Current evidence contains a strong deterministic public-impact signal." : "Significance still requires editorial assessment.",
      momentum: `${corroboration.reason} ${sourceCount} evidence item${sourceCount === 1 ? "" : "s"} from ${corroboration.distinctSourceCount} distinct source${corroboration.distinctSourceCount === 1 ? "" : "s"}; repeated coverage from one provider does not add corroboration.`,
      novelty: bizarre.test(combined) ? "Current evidence contains an unusual or unexpected premise." : "No strong deterministic novelty signal yet.",
      human_interest: emotion.test(combined) ? "Current evidence contains a strong human-impact signal." : "Human-interest value remains uncertain.",
      emotional_resonance: emotion.test(combined) ? "Emotionally charged language appears in the source metadata." : "Source metadata is comparatively neutral.",
      satire_potential: bizarre.test(combined) ? "The premise may support satirical interpretation after editorial review." : "No strong deterministic satire signal yet.",
      locality: geography.municipalities.length ? "Municipal geography is explicit." : geography.counties.length ? "County geography is explicit." : "Statewide geography is the narrowest verified scope.",
      confidence: `Confidence reflects reviewed independent evidence groups and deterministic geography matches. ${corroboration.reason} Corroboration supports prioritization, not automatic factual verification.`,
    },
  });
  return storyEnrichmentResultSchema.parse({
    enrichment: parsed,
    scores,
    briefing: {
      summary_internal: sourceItems[0]?.description || story.canonical_title,
      why_it_may_matter: civicUtility >= 70 ? "The available evidence contains potentially actionable civic information." : publicImpact >= 70 ? "The available evidence suggests material public impact." : "Editorial review is needed to determine the local consequence.",
      disputed_or_different: corroboration.distinctSourceCount > 1 ? "Compare the attached source chronology for differences in framing and facts; confirm that shared ownership or syndication does not create false independence." : "Only one distinct source is attached; independent comparison is not yet available.",
      unknowns: "Verify material claims, affected places, timing, and unresolved questions before publication work.",
    },
  });
};
