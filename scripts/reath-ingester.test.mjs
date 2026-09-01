import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { authorizeIdentity, highestRole, normalizeIdentityUser } from "../netlify/functions/_shared/reath/auth.mjs";
import { chooseStory, planDetach, planStoryMerge } from "../netlify/functions/_shared/reath/cluster.mjs";
import { reathConfig } from "../netlify/functions/_shared/reath/config.mjs";
import { deterministicEnrichment, enrichmentSchema, scoreSchema } from "../netlify/functions/_shared/reath/enrichment.mjs";
import { validateEditorialChange } from "../netlify/functions/_shared/reath/editorial.mjs";
import { parseFeed } from "../netlify/functions/_shared/reath/feed-parser.mjs";
import { matchGeography } from "../netlify/functions/_shared/reath/geography.mjs";
import { fatalIncidentMatch, fundingProjectMatch, localEventMatch, monetaryAmounts, namedEventMatch, normalizeHeadline, tokenSimilarity } from "../netlify/functions/_shared/reath/headline.mjs";
import { candidateRecallTokens, claimSourceItem, createIngestionWorkBudget, EVIDENCE_HEADLINE_CANDIDATE_LIMIT, EXACT_HEADLINE_CANDIDATE_LIMIT, INGESTION_BACKLOG_MAX_ITEMS_PER_RUN, INGESTION_MAX_ITEMS_PER_RUN, loadStoryCandidates, MANUAL_INGESTION_RETENTION_DAYS, runIsolatedSources, selectDueSources, storyCandidateWindow, withinIngestionLookback } from "../netlify/functions/_shared/reath/ingestion.mjs";
import { parseSourcePayload } from "../netlify/functions/_shared/reath/source-adapters.mjs";
import { dispatchIngestionBackground, normalizeSourceIds } from "../netlify/functions/reath-api.mjs";
import { normalizeUrl } from "../netlify/functions/_shared/reath/url-normalizer.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFile(path.join(directory, "fixtures/reath", name), "utf8");
const candidateRow = ({ id, title, lastActivity, sourceId }) => ({
  id,
  canonical_title: title,
  last_activity_at: lastActivity,
  story_counties: [],
  story_municipalities: [],
  story_enrichments: [],
  story_sources: [{
    detached_at: null,
    source_items: {
      id: `${sourceId}-item`,
      source_id: sourceId,
      headline: title,
      normalized_headline: normalizeHeadline(title),
      description: "",
      author: null,
      published_at: lastActivity,
      discovered_at: lastActivity,
      sources: { id: sourceId, source_assessments: [] },
    },
  }],
});
const candidateSupabase = (responses, calls) => ({
  from(table) {
    const query = {};
    for (const method of ["select", "eq", "gte", "lte", "or", "order", "in", "is"]) {
      query[method] = (...args) => {
        calls.push({ table, method, args });
        return query;
      };
    }
    query.limit = (value) => {
      calls.push({ table, method: "limit", args: [value] });
      const response = responses[table];
      const data = typeof response === "function"
        ? response(calls.filter((call) => call.table === table && call.method === "limit").length - 1)
        : response;
      return Promise.resolve({ data: data || [], error: null });
    };
    return query;
  },
});

test("RSS parser retains bounded metadata but excludes full publisher content", async () => {
  const items = parseFeed(await fixture("rss.xml"), { feedUrl: "https://fixture.example/feed.xml", publisher: "Fixture" });
  assert.equal(items.length, 2);
  assert.equal(items[0].canonicalUrl, "https://fixture.example/news/transit-pilot");
  assert.equal(items[0].author, "Jamie Reporter");
  assert.match(items[0].description, /six-month late-night bus pilot/);
  assert.doesNotMatch(JSON.stringify(items[0]), /FULL ARTICLE BODY/);
});

test("source registry filters can exclude labeled sponsored or recurring feed items", async () => {
  const body = await fixture("rss.xml");
  const source = {
    name: "Fixture",
    feed_url: "https://fixture.example/feed.xml",
    ingestion_method: "rss",
    adapter_config: { exclude_categories: ["transport"], exclude_title_patterns: ["cooling centers"] },
  };
  assert.deepEqual(parseSourcePayload(source, body), []);
});

test("source registry filters can retain only a reviewed regional-feed category", async () => {
  const body = await fixture("rss.xml");
  const source = {
    name: "Fixture",
    feed_url: "https://fixture.example/feed.xml",
    ingestion_method: "rss",
    adapter_config: { include_categories: ["transport"] },
  };
  const items = parseSourcePayload(source, body);
  assert.equal(items.length, 1);
  assert.equal(items[0].headline, "Newark council approves late-night transit pilot");
});

test("source registry filters can exclude publisher mirror URLs", async () => {
  const body = await fixture("rss.xml");
  const source = {
    name: "Fixture",
    feed_url: "https://fixture.example/feed.xml",
    ingestion_method: "rss",
    adapter_config: { exclude_url_patterns: ["/news/transit-pilot"] },
  };
  const items = parseSourcePayload(source, body);
  assert.equal(items.length, 1);
  assert.equal(items[0].headline, "Camden opens cooling centers during heat emergency");
});

test("source registry filters can retain reviewed bylines and newsroom routes", async () => {
  const body = await fixture("rss.xml");
  const source = {
    name: "Fixture",
    feed_url: "https://fixture.example/feed.xml",
    ingestion_method: "rss",
    adapter_config: {
      include_author_patterns: ["jamie reporter"],
      include_url_patterns: ["/news/"],
    },
  };
  const items = parseSourcePayload(source, body);
  assert.equal(items.length, 1);
  assert.equal(items[0].headline, "Newark council approves late-night transit pilot");
});

test("source registry filters can exclude institutional or syndicated bylines", async () => {
  const body = await fixture("rss.xml");
  const source = {
    name: "Fixture",
    feed_url: "https://fixture.example/feed.xml",
    ingestion_method: "rss",
    adapter_config: { exclude_author_patterns: ["jamie reporter"] },
  };
  const items = parseSourcePayload(source, body);
  assert.equal(items.length, 1);
  assert.equal(items[0].headline, "Camden opens cooling centers during heat emergency");
});

test("Atom parser normalizes entries through the same adapter", async () => {
  const [item] = parseFeed(await fixture("atom.xml"), { feedUrl: "https://second.example/feed", publisher: "Second" });
  assert.equal(item.canonicalUrl, "https://second.example/newark-bus-test");
  assert.equal(item.author, "Alex Editor");
  assert.equal(item.rawMetadata.feedType, "atom");
});

test("canonical URL normalization removes trackers and normalizes host/protocol", () => {
  assert.equal(normalizeUrl("http://WWW.Example.com/a/?utm_source=x&b=2&a=1#top"), "https://example.com/a?a=1&b=2");
  assert.equal(normalizeUrl("javascript:alert(1)"), null);
});

test("headline normalization and similarity support conservative story clustering", () => {
  assert.equal(normalizeHeadline("Breaking: NJ — Newark Council Approves Transit Pilot"), "newark council approve transit pilot");
  assert.ok(tokenSimilarity("Newark council approves late-night transit pilot", "Newark City Council votes for overnight transit pilot") > 0.68);
});

test("matching project, municipality, and monetary award identify one funding event", () => {
  const left = "Asbury Park Convention Hall lands record $75 million state award for restoration";
  const right = "$75 million in tax credits for Convention Hall";
  assert.deepEqual(fundingProjectMatch(left, right), {
    aligned: true,
    amount: 75_000_000,
    anchor: "convention hall",
  });
  assert.equal(fundingProjectMatch(left, "$75 million awarded for Newark Penn Station").aligned, false);
  assert.equal(fundingProjectMatch(left, "$50 million in tax credits for Convention Hall").aligned, false);
});

test("compact dollar suffixes retain exact funding amounts", () => {
  assert.deepEqual(monetaryAmounts("A $277M loan and $18B settlement include $525 million for New Jersey"), [
    277_000_000,
    18_000_000_000,
    525_000_000,
  ]);
  assert.equal(fundingProjectMatch(
    "Newmark arranges $277M construction loan for Urby in Jersey City",
    "Urby secures $277M construction loan for Jersey City tower",
  ).aligned, true);
});

test("distinctive local-event fingerprints join independently worded coverage and fail closed on generic overlap", () => {
  const pairs = [[
    "The Bayonne Bees are eliminated from the Little League World Series",
    "Bayonne, N.J., out of Little League World Series after loss to Ohio",
  ], [
    "Luxury sailboat stolen in Jersey City, suspect dies in Rhode Island shootout",
    "Thief dies in Rhode Island shootout after stealing boat from NJ marina",
  ], [
    "Former NJ wrestling coach accused of assaulting minor",
    "Former Newark Academy wrestling coach charged with assaulting 15-year-old",
  ]];
  for (const [left, right] of pairs) {
    const match = localEventMatch(left, right);
    assert.equal(match.aligned, true, `${left} <> ${right}`);
    assert.ok(match.sharedTokens.length >= 3);
  }
  assert.equal(localEventMatch(
    "Newark council approves school budget",
    "Newark council approves police contract",
  ).aligned, false);
  assert.equal(localEventMatch(
    "Newark approves $20 million school construction plan",
    "Newark approves $35 million school construction plan",
  ).numberConflict, true);
});

test("same-municipality event fingerprints attach only across independent providers and a tight time window", () => {
  const candidate = candidateRow({
    id: "bayonne-little-league",
    title: "Bayonne, N.J., out of Little League World Series after loss to Ohio",
    lastActivity: "2026-08-26T14:00:00Z",
    sourceId: "cbs-new-york",
  });
  candidate.geography = { countyIds: [9], municipalityIds: ["bayonne-city"] };
  candidate.sourceGroupKeys = ["paramount-cbs-owned-stations"];
  candidate.evidenceItems = [{
    sourceItemId: "cbs-bayonne-item",
    sourceId: "cbs-new-york",
    headline: candidate.canonical_title,
    publishedAt: candidate.last_activity_at,
  }];
  const incoming = {
    headline: "The Bayonne Bees are eliminated from the Little League World Series",
    description: "",
    publishedAt: "2026-08-26T15:00:00Z",
    sourceId: "pix11",
    sourceGroupKey: "mission-nexstar-wpix",
    geography: candidate.geography,
  };
  const result = chooseStory(incoming, [candidate]);
  assert.equal(result.action, "attach");
  assert.equal(result.signals.localEventAlignment, 1);
  assert.equal(result.signals.sourceDiversity, 1);

  const sameOwner = chooseStory({ ...incoming, sourceGroupKey: "paramount-cbs-owned-stations" }, [candidate]);
  assert.equal(sameOwner.ranked[0].signals.localEventAlignment, 0);
  const late = chooseStory({ ...incoming, publishedAt: "2026-08-28T03:00:00Z" }, [candidate]);
  assert.equal(late.ranked[0].signals.localEventAlignment, 0);
});

test("same-location funding coverage attaches without relaxing unrelated coverage", () => {
  const item = {
    headline: "Asbury Park Convention Hall lands record $75 million state award for restoration",
    description: "The $130 million restoration secured $75 million in state funding.",
    sourceId: "jersey-digs",
    sourceGroupKey: "provider:jersey-digs",
    publishedAt: "2026-08-26T17:05:20Z",
    geography: { countyIds: [13], municipalityIds: ["asbury-park"] },
  };
  const candidate = candidateRow({
    id: "convention-hall",
    title: "$75 million in tax credits for Convention Hall",
    lastActivity: "2026-08-25T17:56:56Z",
    sourceId: "the-coaster",
  });
  candidate.geography = { countyIds: [13], municipalityIds: ["asbury-park"] };
  candidate.sourceGroupKeys = ["provider:the-coaster"];
  candidate.evidenceItems = [{
    sourceItemId: "coaster-item",
    sourceId: "the-coaster",
    sourceGroupKey: "provider:the-coaster",
    headline: candidate.canonical_title,
    description: "NJEDA approved a $75 million award for the $130 million Convention Hall restoration.",
    publishedAt: candidate.last_activity_at,
  }];
  const matched = chooseStory(item, [candidate]);
  assert.equal(matched.action, "attach");
  assert.equal(matched.signals.fundingProjectAlignment, 1);

  const unrelated = structuredClone(candidate);
  unrelated.id = "newark-station";
  unrelated.canonical_title = "$75 million awarded for Newark Penn Station";
  unrelated.geography = { countyIds: [7], municipalityIds: ["newark"] };
  unrelated.evidenceItems[0].headline = unrelated.canonical_title;
  unrelated.evidenceItems[0].description = "A transit grant will renovate Newark Penn Station.";
  assert.equal(chooseStory(item, [unrelated]).action, "create");
});

test("related coverage attaches while unrelated NJ coverage creates a story", () => {
  const candidates = [{ id:"story-a", canonical_title:"Newark council approves late-night transit pilot", last_activity_at:"2026-08-21T18:00:00Z", organizations:[], geography:{ countyIds:[7], municipalityIds:["newark"] } }];
  const related = chooseStory({ headline:"Newark City Council votes for overnight transit pilot", description:"", publishedAt:"2026-08-21T19:00:00Z", geography:{ countyIds:[7], municipalityIds:["newark"] } }, candidates);
  const unrelated = chooseStory({ headline:"Camden opens cooling centers during heat emergency", description:"", publishedAt:"2026-08-21T19:00:00Z", geography:{ countyIds:[4], municipalityIds:["camden"] } }, candidates);
  assert.equal(related.action, "attach");
  assert.equal(related.story.id, "story-a");
  assert.equal(unrelated.action, "create");
});

test("independently worded reports of one fatal incident cluster on matching event facts", () => {
  const headlines = [
    "2 children killed in fire in Trenton, New Jersey, officials say",
    "Two children, ages 4 and 7, killed in Trenton house fire, officials say",
    "2 young children die in 3-alarm house fire in Trenton, NJ",
    "Two children die after multi-house fire in New Jersey: police",
    "2 children killed in devastating N.J. house fire that displaced 14 people",
    "Two children killed in devastating Trenton row house fire",
  ];
  for (const [anchorIndex, anchorHeadline] of headlines.entries()) {
    const story = {
      id: `trenton-fatal-fire-${anchorIndex}`,
      canonical_title: anchorHeadline,
      last_activity_at: "2026-08-25T14:00:00Z",
      organizations: [],
      sourceIds: [`anchor-source-${anchorIndex}`],
      sourceGroupKeys: [`anchor-group-${anchorIndex}`],
      geography: { countyIds: [11], municipalityIds: ["trenton-city"] },
      evidenceItems: [{
        sourceItemId: `anchor-item-${anchorIndex}`,
        sourceId: `anchor-source-${anchorIndex}`,
        headline: anchorHeadline,
        publishedAt: "2026-08-25T14:00:00Z",
      }],
    };
    for (const [incomingIndex, headline] of headlines.entries()) {
      if (incomingIndex === anchorIndex) continue;
      const result = chooseStory({
        headline,
        description: "",
        publishedAt: "2026-08-25T15:00:00Z",
        sourceId: `incoming-source-${incomingIndex}`,
        sourceGroupKey: `incoming-group-${incomingIndex}`,
        geography: { countyIds: [11], municipalityIds: ["trenton-city"] },
      }, [story]);
      assert.equal(result.action, "attach", `${anchorHeadline} <- ${headline}`);
      assert.equal(result.story.id, story.id);
      assert.equal(result.signals.fatalIncidentAlignment, 1);
      assert.equal(result.signals.fatalIncidentType, "fire");
      assert.equal(result.signals.fatalIncidentParticipant, "child");
      assert.equal(result.signals.fatalIncidentParticipantCount, 2);
      assert.equal(result.signals.sourceDiversity, 1);
    }
  }
});

test("fatal-incident semantics do not merge unrelated fires or relax source independence", () => {
  const headline = "2 children killed in fire in Trenton, New Jersey, officials say";
  assert.deepEqual(fatalIncidentMatch(
    headline,
    "Two children die after multi-house fire in New Jersey: police",
  ), {
    aligned: true,
    incidentType: "fire",
    participant: "child",
    participantCount: 2,
    countConflict: false,
  });
  assert.equal(fatalIncidentMatch(headline, "Three children killed in a Trenton house fire").aligned, false);
  assert.equal(fatalIncidentMatch(headline, "Two adults killed in a Trenton house fire").aligned, false);
  assert.equal(fatalIncidentMatch(headline, "Two children killed in a Trenton car crash").aligned, false);

  const story = {
    id: "trenton-fatal-fire",
    canonical_title: headline,
    last_activity_at: "2026-08-25T14:00:00Z",
    organizations: [],
    sourceIds: ["cbs-philadelphia"],
    sourceGroupKeys: ["paramount-cbs-owned-stations"],
    geography: { countyIds: [11], municipalityIds: ["trenton-city"] },
  };
  const cases = [{
    headline: "Two children die after multi-house fire in Hamilton: police",
    publishedAt: "2026-08-25T15:00:00Z",
    geography: { countyIds: [11], municipalityIds: ["hamilton-township-mercer"] },
  }, {
    headline: "Two children die after multi-house fire in Trenton: police",
    publishedAt: "2026-08-27T15:00:00Z",
    geography: story.geography,
  }, {
    headline: "Two children killed in a Trenton car crash",
    publishedAt: "2026-08-25T15:00:00Z",
    geography: story.geography,
  }];
  for (const item of cases) {
    const result = chooseStory({
      ...item,
      sourceId: "pix11",
      sourceGroupKey: "mission-nexstar-wpix",
    }, [story]);
    assert.equal(result.action, "create", item.headline);
    assert.equal(result.ranked[0].signals.fatalIncidentAlignment, 0);
  }
  const sameCountyDifferentMunicipality = chooseStory({
    ...cases[0],
    sourceId: "pix11",
    sourceGroupKey: "mission-nexstar-wpix",
  }, [story]);
  assert.equal(sameCountyDifferentMunicipality.ranked[0].signals.geography, 1);
  assert.equal(sameCountyDifferentMunicipality.ranked[0].signals.municipality, 0);

  const sameOwnership = chooseStory({
    headline: "Two children die after multi-house fire in Trenton: police",
    publishedAt: "2026-08-25T15:00:00Z",
    sourceId: "cbs-new-york",
    sourceGroupKey: "paramount-cbs-owned-stations",
    geography: story.geography,
  }, [story]);
  assert.equal(sameOwnership.action, "attach");
  assert.equal(sameOwnership.signals.fatalIncidentAlignment, 1);
  assert.equal(sameOwnership.signals.sourceDiversity, 0);
});

test("named-event semantics cluster independently worded Rutgers charge coverage", () => {
  const firstText = "Rutgers dean accused of secretly recording women in bathrooms. Research dean Joshua Kohut faces invasion of privacy charges.";
  const secondText = "Joshua Kohut charged with invasion of privacy. The Rutgers University dean allegedly filmed women in a restroom.";
  assert.deepEqual(namedEventMatch(firstText, secondText), {
    aligned: true,
    action: "criminal_charge",
    anchor: "joshua kohut",
    anchorType: "person",
    topics: ["covert_recording", "privacy_intrusion"],
    personConflict: false,
  });

  const story = {
    id: "rutgers-dean-charge",
    canonical_title: "Joshua Kohut charged with invasion of privacy",
    last_activity_at: "2026-08-25T14:00:00Z",
    organizations: ["Rutgers University"],
    sourceIds: ["nj-attorney-general"],
    sourceGroupKeys: ["nj-attorney-general"],
    geography: { countyIds: [12], municipalityIds: ["new-brunswick-city"] },
    evidenceItems: [{
      sourceItemId: "nj-attorney-general-item",
      sourceId: "nj-attorney-general",
      headline: "Joshua Kohut charged with invasion of privacy",
      description: "The Rutgers University dean allegedly filmed women in a restroom.",
      publishedAt: "2026-08-25T14:00:00Z",
    }],
  };
  const result = chooseStory({
    headline: "Rutgers dean accused of secretly recording women in bathrooms",
    description: "Research dean Joshua Kohut faces invasion of privacy charges.",
    publishedAt: "2026-08-25T15:00:00Z",
    sourceId: "whyy",
    sourceGroupKey: "whyy",
    geography: story.geography,
  }, [story]);

  assert.equal(result.action, "attach");
  assert.equal(result.story.id, story.id);
  assert.equal(result.signals.namedEventAlignment, 1);
  assert.equal(result.signals.namedEventAction, "criminal_charge");
  assert.equal(result.signals.namedEventAnchor, "joshua kohut");
  assert.deepEqual(result.signals.namedEventTopics, ["covert_recording", "privacy_intrusion"]);
  assert.equal(result.signals.municipality, 1);
  assert.equal(result.signals.sourceDiversity, 1);
});

test("named-event semantics cluster statewide care shield-law coverage", () => {
  const story = {
    id: "care-shield-law",
    canonical_title: "Sherrill signs reproductive and gender-affirming care protections into law",
    last_activity_at: "2026-08-25T14:00:00Z",
    organizations: [],
    sourceIds: ["new-jersey-monitor"],
    sourceGroupKeys: ["new-jersey-monitor"],
    geography: { countyIds: [11], municipalityIds: ["hopewell-township-mercer"] },
    evidenceItems: [{
      sourceItemId: "monitor-shield-item",
      sourceId: "new-jersey-monitor",
      headline: "Sherrill signs reproductive and gender-affirming care protections into law",
      description: "The new shield law protects patients and providers.",
      publishedAt: "2026-08-25T14:00:00Z",
    }],
  };
  const result = chooseStory({
    headline: "New Jersey expands protections for abortion and transgender care",
    description: "Governor Mikie Sherrill signed the shield measure into law.",
    publishedAt: "2026-08-25T15:00:00Z",
    sourceId: "jersey-vindicator",
    sourceGroupKey: "jersey-vindicator",
    geography: { countyIds: [], municipalityIds: [] },
  }, [story]);

  assert.equal(result.action, "attach");
  assert.equal(result.story.id, story.id);
  assert.equal(result.signals.namedEventAlignment, 1);
  assert.equal(result.signals.namedEventAction, "law_enactment");
  assert.equal(result.signals.namedEventAnchor, "sherrill");
  assert.deepEqual(result.signals.namedEventTopics, ["reproductive_care", "gender_affirming_care", "legal_protection"]);
  assert.equal(result.signals.municipality, 0);
  assert.equal(result.signals.namedEventStatewideContext, 1);
});

test("named-event semantics cluster statewide settlements and specific institutional court rulings", () => {
  const meta = namedEventMatch(
    "Meta settlement over children and social media includes New Jersey",
    "Meta will pay New Jersey and rebuild how teenagers use Instagram",
  );
  assert.equal(meta.aligned, true);
  assert.equal(meta.action, "civil_settlement");
  assert.equal(meta.anchor, "meta");
  assert.deepEqual(meta.topics, ["social_media", "youth_safety"]);

  const metaStory = {
    id: "meta-youth-settlement",
    canonical_title: "Meta settlement over children and social media includes New Jersey",
    last_activity_at: "2026-08-27T13:00:00Z",
    organizations: [],
    sourceIds: ["monitor"],
    sourceGroupKeys: ["new-jersey-monitor"],
    geography: { countyIds: [], municipalityIds: [] },
  };
  const metaDecision = chooseStory({
    headline: "Meta will pay New Jersey and rebuild how teenagers use Instagram",
    description: "The social media settlement changes protections for children.",
    publishedAt: "2026-08-27T14:00:00Z",
    sourceId: "fox29",
    sourceGroupKey: "fox-television-stations",
    geography: { countyIds: [], municipalityIds: [] },
  }, [metaStory]);
  assert.equal(metaDecision.action, "attach");
  assert.equal(metaDecision.signals.namedEventStatewideContext, 1);

  const clubStory = {
    id: "club-abuse-ruling",
    canonical_title: "Court allows Boys and Girls Club child sexual abuse lawsuit to proceed",
    last_activity_at: "2026-08-27T13:00:00Z",
    organizations: [],
    sourceIds: ["monitor"],
    sourceGroupKeys: ["new-jersey-monitor"],
    geography: { countyIds: [], municipalityIds: [] },
  };
  const clubDecision = chooseStory({
    headline: "Judge rules Boys and Girls Club may be liable for sexual abuse of children",
    description: "",
    publishedAt: "2026-08-27T14:00:00Z",
    sourceId: "vindicator",
    sourceGroupKey: "jersey-vindicator",
    geography: { countyIds: [], municipalityIds: [] },
  }, [clubStory]);
  assert.equal(clubDecision.action, "attach");
  assert.equal(clubDecision.signals.namedEventIndependentCourtSubjectContext, 1);
});

test("named-person event semantics tolerate missing geography only across independent providers", () => {
  const rutgersStory = {
    id: "rutgers-kohut-charge",
    canonical_title: "Joshua Kohut charged with invasion of privacy",
    last_activity_at: "2026-08-25T14:00:00Z",
    organizations: ["Rutgers University"],
    sourceIds: ["source-a"],
    sourceGroupKeys: ["group-a"],
    geography: { countyIds: [12], municipalityIds: ["new-brunswick-city"] },
    evidenceItems: [{
      sourceItemId: "kohut-charge-item",
      sourceId: "source-a",
      headline: "Joshua Kohut charged with invasion of privacy",
      description: "The Rutgers University dean allegedly filmed women in a restroom.",
      publishedAt: "2026-08-25T14:00:00Z",
    }],
  };
  const base = {
    headline: "Rutgers dean accused of secretly recording women in bathrooms",
    description: "Research dean Joshua Kohut faces invasion of privacy charges.",
    publishedAt: "2026-08-25T15:00:00Z",
    sourceId: "source-b",
    sourceGroupKey: "group-b",
  };
  const independent = chooseStory({ ...base, geography: { countyIds: [], municipalityIds: [] } }, [rutgersStory]);
  assert.equal(independent.action, "attach");
  assert.equal(independent.signals.namedEventAlignment, 1);
  assert.equal(independent.signals.namedEventIndependentPersonContext, 1);

  const sameOwner = chooseStory({
    ...base,
    sourceGroupKey: "group-a",
    geography: { countyIds: [], municipalityIds: [] },
  }, [rutgersStory]);
  assert.equal(sameOwner.action, "create");
  assert.equal(sameOwner.ranked[0].signals.namedEventAlignment, 0);
});

test("named-event semantics fail closed on different people, actions, facts, or time", () => {
  const rutgersStory = {
    id: "rutgers-kohut-charge",
    canonical_title: "Joshua Kohut charged with invasion of privacy",
    last_activity_at: "2026-08-25T14:00:00Z",
    organizations: ["Rutgers University"],
    sourceIds: ["source-a"],
    sourceGroupKeys: ["group-a"],
    geography: { countyIds: [12], municipalityIds: ["new-brunswick-city"] },
    evidenceItems: [{
      sourceItemId: "kohut-charge-item",
      sourceId: "source-a",
      headline: "Joshua Kohut charged with invasion of privacy",
      description: "The Rutgers University dean allegedly filmed women in a restroom.",
      publishedAt: "2026-08-25T14:00:00Z",
    }],
  };
  const base = {
    headline: "Rutgers dean accused of secretly recording women in bathrooms",
    description: "Research dean Joshua Kohut faces invasion of privacy charges.",
    publishedAt: "2026-08-25T15:00:00Z",
    sourceId: "source-b",
    sourceGroupKey: "group-b",
  };
  const cases = [{
    label: "a different Rutgers defendant in a same-day privacy case",
    item: {
      ...base,
      headline: "Rutgers dean Jane Smith charged after secretly recording women in bathrooms",
      description: "Dean Jane Smith was charged with invasion of privacy.",
      geography: rutgersStory.geography,
    },
    signal: "namedEventPersonConflict",
  }, {
    label: "a different action involving Rutgers privacy research",
    item: {
      ...base,
      headline: "Rutgers dean presents research on privacy and covert recording",
      description: "Joshua Kohut discussed filming and restroom privacy safeguards.",
      geography: rutgersStory.geography,
    },
  }, {
    label: "coverage outside the 36-hour event window",
    item: { ...base, publishedAt: "2026-08-27T03:00:00Z", geography: rutgersStory.geography },
  }];
  for (const { label, item, signal } of cases) {
    const result = chooseStory(item, [rutgersStory]);
    assert.equal(result.action, "create", label);
    assert.equal(result.ranked[0].signals.namedEventAlignment, 0, label);
    if (signal === "namedEventPersonConflict") assert.equal(result.ranked[0].signals[signal], 1, label);
  }

  const unrelatedBill = namedEventMatch(
    "Sherrill signs reproductive and gender-affirming care protections into law",
    "Sherrill signs a school funding bill into law",
  );
  assert.equal(unrelatedBill.aligned, false);
  assert.deepEqual(unrelatedBill.topics, []);
});

test("exact cross-source headlines cluster despite different inferred geography scopes", () => {
  const headline = "Sherrill signs reproductive and gender-affirming care protections into law";
  const result = chooseStory({
    headline: "Sherrill Signs Reproductive and Gender Affirming Care Protections Into Law",
    description: "",
    publishedAt: "2026-08-21T18:23:00Z",
    sourceId: "nj-urban-news",
    sourceGroupKey: "nj-urban-news",
    geography: { countyIds: [], municipalityIds: [] },
  }, [{
    id: "mercerme-story",
    canonical_title: headline,
    last_activity_at: "2026-08-21T14:00:00Z",
    organizations: [],
    sourceIds: ["mercerme"],
    sourceGroupKeys: ["mercerme"],
    geography: { countyIds: [11], municipalityIds: ["hopewell-township-mercer"] },
  }]);

  assert.equal(normalizeHeadline(result.ranked[0].candidate.canonical_title), normalizeHeadline("Sherrill Signs Reproductive and Gender Affirming Care Protections Into Law"));
  assert.equal(result.ranked[0].signals.geography, 0);
  assert.equal(result.action, "attach");
  assert.equal(result.story.id, "mercerme-story");
});

test("historical source items load Story candidates around publication time, not worker time", async () => {
  const window = storyCandidateWindow({
    publishedAt: "2026-08-21T18:23:00Z",
    discoveredAt: "2026-08-26T14:00:00Z",
    fallbackAt: "2026-08-26T14:00:00Z",
  });
  assert.deepEqual(window, {
    since: "2026-08-18T18:23:00.000Z",
    until: "2026-08-24T18:23:00.000Z",
  });
  assert.deepEqual(storyCandidateWindow({
    publishedAt: null,
    discoveredAt: "2026-08-26T14:00:00Z",
  }), {
    since: "2026-08-23T14:00:00.000Z",
    until: "2026-08-29T14:00:00.000Z",
  });

  const filters = new Map();
  const query = {
    select() { return this; },
    eq(column, value) { filters.set(column, value); return this; },
    gte(column, value) { filters.set(`${column}:gte`, value); return this; },
    lte(column, value) { filters.set(`${column}:lte`, value); return this; },
    order() { return this; },
    limit(value) {
      assert.equal(value, 150);
      return Promise.resolve({ data: [], error: null });
    },
  };
  const supabase = {
    from(table) {
      assert.equal(table, "stories");
      return query;
    },
  };
  await loadStoryCandidates(supabase, {
    published_at: "2026-08-21T18:23:00Z",
    discovered_at: "2026-08-26T14:00:00Z",
  });
  assert.equal(filters.get("status"), "developing");
  assert.equal(filters.get("last_activity_at:gte"), window.since);
  assert.equal(filters.get("last_activity_at:lte"), window.until);
});

test("exact normalized headline lookup recovers a matching Story beyond the recent candidate cap", async () => {
  const headline = "NJ To Disclose Records On How Foreign Nationals Registered To Vote";
  const regularRows = Array.from({ length: 150 }, (_, index) => candidateRow({
    id: `recent-${index}`,
    title: `Camden Weather Bulletin ${index}`,
    lastActivity: "2026-08-26T14:30:00Z",
    sourceId: `recent-source-${index}`,
  }));
  const exactStory = candidateRow({
    id: "nj-spotlight-story",
    title: headline,
    lastActivity: "2026-08-24T04:05:00Z",
    sourceId: "nj-spotlight",
  });
  const calls = [];
  const candidates = await loadStoryCandidates(candidateSupabase({
    stories: regularRows,
    story_sources: [{ story_id: exactStory.id, source_items: { id: "nj-spotlight-item" }, stories: exactStory }],
  }, calls), {
    headline,
    normalized_headline: normalizeHeadline(headline),
    published_at: "2026-08-26T15:00:00Z",
    discovered_at: "2026-08-26T15:05:00Z",
  });

  assert.equal(candidates.length, 151);
  assert.ok(candidates.some((candidate) => candidate.id === exactStory.id));
  assert.equal(calls.find((call) => call.table === "story_sources" && call.method === "limit")?.args[0], EXACT_HEADLINE_CANDIDATE_LIMIT + 1);
  assert.deepEqual(calls.find((call) => call.table === "story_sources" && call.method === "or")?.args[1], { referencedTable: "source_items" });

  const decision = chooseStory({
    headline,
    description: "",
    publishedAt: "2026-08-26T15:00:00Z",
    sourceId: "nj-urban-news",
    sourceGroupKey: "source:nj-urban-news",
    geography: { countyIds: [], municipalityIds: [] },
  }, candidates);
  assert.equal(decision.action, "attach");
  assert.equal(decision.story.id, exactStory.id);
});

test("evidence-headline recall finds independently worded coverage beyond the newest 150 Stories", async () => {
  const monitorHeadline = "NJ Supreme Court sides with Seaside Park in eminent domain case";
  const incomingHeadline = "NJ Supreme Court sides with Seaside Park in motel condemnation";
  const regularRows = Array.from({ length: 150 }, (_, index) => candidateRow({
    id: `newer-${index}`,
    title: `Unrelated statewide bulletin ${index}`,
    lastActivity: "2026-08-13T12:00:00Z",
    sourceId: `newer-source-${index}`,
  }));
  const matchingStory = candidateRow({
    id: "monitor-eminent-domain",
    title: monitorHeadline,
    lastActivity: "2026-08-26T12:00:00Z",
    sourceId: "new-jersey-monitor",
  });
  matchingStory.story_counties = [{ county_id: 15 }];
  matchingStory.story_municipalities = [{ municipality_id: "seaside-park-borough" }];
  matchingStory.story_enrichments = [{
    organizations: ["NJ Supreme Court"],
    is_current: true,
    analysis_kind: "deterministic",
  }];
  matchingStory.story_sources[0].source_items.published_at = "2026-08-10T13:24:00Z";
  matchingStory.story_sources[0].source_items.discovered_at = "2026-08-26T12:00:00Z";

  const calls = [];
  const candidates = await loadStoryCandidates(candidateSupabase({
    stories: regularRows,
    story_sources: (readIndex) => readIndex === 0 ? [] : [{
      story_id: matchingStory.id,
      source_items: { id: "monitor-item" },
      stories: matchingStory,
    }],
  }, calls), {
    headline: incomingHeadline,
    normalized_headline: normalizeHeadline(incomingHeadline),
    published_at: "2026-08-10T14:00:00Z",
    discovered_at: "2026-08-26T14:00:00Z",
  });

  assert.equal(candidates.length, 151);
  const candidate = candidates.find((row) => row.id === matchingStory.id);
  assert.ok(candidate);
  assert.equal(candidate.evidenceItems[0].sourceItemId, "new-jersey-monitor-item");
  assert.equal(candidate.evidenceItems[0].description, "");
  assert.ok(candidateRecallTokens(incomingHeadline).includes("condemnation"));
  assert.equal(calls.filter((call) => call.table === "story_sources" && call.method === "limit").at(-1).args[0], EVIDENCE_HEADLINE_CANDIDATE_LIMIT + 1);
  assert.equal(calls.some((call) => call.table === "story_sources" && call.method === "gte" && call.args[0] === "stories.last_activity_at"), false);

  const decision = chooseStory({
    headline: incomingHeadline,
    description: "",
    publishedAt: "2026-08-10T14:00:00Z",
    sourceId: "press-of-atlantic-city",
    sourceGroupKey: "provider:lee-enterprises",
    geography: { countyIds: [15], municipalityIds: ["seaside-park-borough"] },
  }, candidates);
  assert.equal(decision.action, "attach");
  assert.equal(decision.story.id, matchingStory.id);
  assert.ok(decision.confidence >= 0.809);
  assert.equal(decision.signals.matchedSourceItemId, "new-jersey-monitor-item");
});

test("Story scoring uses active evidence while preserving canonical-title fallback", () => {
  const result = chooseStory({
    headline: "Newark council approves late-night transit pilot",
    description: "",
    publishedAt: "2026-08-21T19:00:00Z",
    sourceId: "source-b",
    geography: { countyIds: [7], municipalityIds: ["newark"] },
  }, [{
    id: "story-with-editorial-title",
    canonical_title: "Newark transportation desk update",
    last_activity_at: "2026-08-21T19:00:00Z",
    organizations: [],
    sourceIds: ["source-a"],
    geography: { countyIds: [7], municipalityIds: ["newark"] },
    evidenceItems: [{
      sourceItemId: "evidence-a",
      sourceId: "source-a",
      headline: "Newark City Council votes for overnight transit pilot",
      publishedAt: "2026-08-21T18:00:00Z",
    }],
  }]);
  assert.equal(result.action, "attach");
  assert.equal(result.signals.matchedSourceItemId, "evidence-a");
});

test("active Story evidence cannot bypass same-source recurring-edition guards", () => {
  const result = chooseStory({
    headline: "Events This Week in New Jersey from August 18-24, 2026",
    publishedAt: "2026-08-18T12:00:00Z",
    sourceId: "new-jersey-stage",
    geography: { countyIds: [], municipalityIds: [] },
  }, [{
    id: "weekly-events-story",
    canonical_title: "Arts calendar and weekly events",
    last_activity_at: "2026-08-25T12:00:00Z",
    organizations: [],
    sourceIds: ["new-jersey-stage", "other-source"],
    geography: { countyIds: [], municipalityIds: [] },
    evidenceItems: [{
      sourceItemId: "same-source-later-edition",
      sourceId: "new-jersey-stage",
      headline: "Events This Week in New Jersey from August 25-31, 2026",
      publishedAt: "2026-08-25T12:00:00Z",
    }, {
      sourceItemId: "other-source-matching-edition",
      sourceId: "other-source",
      headline: "Events This Week in New Jersey from August 18-24, 2026",
      publishedAt: "2026-08-18T12:30:00Z",
    }],
  }]);
  assert.equal(result.action, "create");
  assert.equal(result.reason, "conflicting_headline_dates");
  assert.equal(result.ranked[0].signals.dateEditionConflict, 1);
});

test("exact headline lookup fails closed when its evidence cap overflows", async () => {
  const headline = "A Recurring Exact Headline";
  const regularRows = [candidateRow({
    id: "recent-unrelated",
    title: "A Different Story",
    lastActivity: "2026-08-26T14:30:00Z",
    sourceId: "recent-source",
  })];
  const calls = [];
  const candidates = await loadStoryCandidates(candidateSupabase({
    stories: regularRows,
    story_sources: Array.from({ length: EXACT_HEADLINE_CANDIDATE_LIMIT + 1 }, (_, index) => ({
      story_id: `template-story-${index}`,
      source_items: { id: `template-${index}` },
      stories: candidateRow({
        id: `template-story-${index}`,
        title: headline,
        lastActivity: "2026-08-26T14:30:00Z",
        sourceId: `template-source-${index}`,
      }),
    })),
  }, calls), {
    headline,
    normalized_headline: normalizeHeadline(headline),
    published_at: "2026-08-26T15:00:00Z",
  });

  assert.deepEqual(candidates.map((candidate) => candidate.id), ["recent-unrelated"]);
  assert.equal(calls.filter((call) => call.table === "story_sources" && call.method === "limit").length, 1);
  assert.equal(calls.find((call) => call.table === "story_sources" && call.method === "limit")?.args[0], EXACT_HEADLINE_CANDIDATE_LIMIT + 1);
});

test("cheap clustering records proper-noun, date, and independent-source corroboration", () => {
  const candidates = [{
    id: "story-b",
    canonical_title: "Garden State Parkway work starts September 12",
    last_activity_at: "2026-08-21T18:00:00Z",
    organizations: [],
    sourceIds: ["source-a"],
    geography: { countyIds: [9], municipalityIds: [] },
  }];
  const result = chooseStory({
    headline: "Garden State Parkway closures begin September 12",
    description: "A second outlet confirms the work window.",
    publishedAt: "2026-08-21T19:00:00Z",
    sourceId: "source-b",
    geography: { countyIds: [9], municipalityIds: [] },
  }, candidates);
  assert.equal(result.ranked[0].signals.properNouns, 1);
  assert.equal(result.ranked[0].signals.explicitDates, 1);
  assert.equal(result.ranked[0].signals.dateEditionConflict, 0);
  assert.equal(result.ranked[0].signals.sourceDiversity, 1);
});

test("different explicit headline dates are conservatively separated", () => {
  const result = chooseStory({
    headline: "NJ Spotlight News: August 25, 2026",
    description: "The daily edition.",
    publishedAt: "2026-08-25T22:30:00Z",
    sourceId: "spotlight",
    geography: { countyIds: [], municipalityIds: [] },
  }, [{
    id: "august-24",
    canonical_title: "NJ Spotlight News: August 24, 2026",
    last_activity_at: "2026-08-24T22:30:00Z",
    organizations: [],
    sourceIds: ["spotlight"],
    geography: { countyIds: [], municipalityIds: [] },
  }]);
  assert.equal(result.action, "create");
  assert.equal(result.reason, "conflicting_headline_dates");
  assert.equal(result.ranked[0].signals.dateEditionConflict, 1);
  assert.equal(result.ranked[0].score, 0);
});

test("date-edition guard recognizes equivalent forms and stays source-specific", () => {
  const candidate = {
    id: "edition",
    canonical_title: "NJ Spotlight News: Aug 24, 2026",
    last_activity_at: "2026-08-24T22:30:00Z",
    organizations: [],
    sourceIds: ["spotlight"],
    geography: { countyIds: [], municipalityIds: [] },
  };
  const equivalent = chooseStory({
    headline: "NJ Spotlight News: August 24",
    publishedAt: "2026-08-24T23:00:00Z",
    sourceId: "spotlight",
    geography: { countyIds: [], municipalityIds: [] },
  }, [candidate]);
  assert.equal(equivalent.ranked[0].signals.dateEditionConflict, 0);
  assert.equal(equivalent.ranked[0].signals.explicitDates, 1);

  const corroboratingSource = chooseStory({
    headline: "NJ Spotlight News: August 25, 2026",
    publishedAt: "2026-08-25T22:30:00Z",
    sourceId: "other-outlet",
    geography: { countyIds: [], municipalityIds: [] },
  }, [candidate]);
  assert.equal(corroboratingSource.ranked[0].signals.dateEditionConflict, 0);
  assert.notEqual(corroboratingSource.ranked[0].score, 0);

  const substantiveChange = chooseStory({
    headline: "Newark transit pilot begins August 25, 2026",
    publishedAt: "2026-08-25T22:30:00Z",
    sourceId: "spotlight",
    geography: { countyIds: [], municipalityIds: [] },
  }, [{ ...candidate, canonical_title: "Newark council hearing August 24, 2026" }]);
  assert.equal(substantiveChange.ranked[0].signals.dateEditionConflict, 0);
  assert.ok(substantiveChange.ranked[0].signals.dateStrippedSimilarity < 0.9);
});

test("same-source weekly date ranges remain separate editions", () => {
  const result = chooseStory({
    headline: "Events This Week in New Jersey from August 18-24, 2026",
    publishedAt: "2026-08-18T12:00:00Z",
    sourceId: "new-jersey-stage",
    geography: { countyIds: [], municipalityIds: [] },
  }, [{
    id: "august-25-week",
    canonical_title: "Events This Week in New Jersey from August 25-31, 2026",
    last_activity_at: "2026-08-25T12:00:00Z",
    organizations: [],
    sourceIds: ["new-jersey-stage"],
    geography: { countyIds: [], municipalityIds: [] },
  }]);
  assert.equal(result.action, "create");
  assert.equal(result.reason, "conflicting_headline_dates");
  assert.equal(result.ranked[0].signals.dateEditionConflict, 1);
  assert.equal(result.ranked[0].signals.dateStrippedSimilarity, 1);

  const equivalentRange = chooseStory({
    headline: "Events This Week in New Jersey from Aug 25–31",
    publishedAt: "2026-08-25T13:00:00Z",
    sourceId: "new-jersey-stage",
    geography: { countyIds: [], municipalityIds: [] },
  }, [{
    ...result.ranked[0].candidate,
    canonical_title: "Events This Week in New Jersey from August 25-31, 2026",
  }]);
  assert.equal(equivalentRange.ranked[0].signals.dateEditionConflict, 0);
  assert.equal(equivalentRange.ranked[0].signals.explicitDates, 1);
});

test("same-source live events at one venue require the same performer", () => {
  const candidate = {
    id: "music-pier-event",
    canonical_title: "Todd Rundgren LIVE! at Ocean City Music Pier",
    last_activity_at: "2026-08-25T12:00:00Z",
    organizations: [],
    sourceIds: ["new-jersey-stage"],
    geography: { countyIds: [], municipalityIds: ["ocean-city"] },
  };
  const distinctPerformer = chooseStory({
    headline: "The Outlaws LIVE! at Ocean City Music Pier",
    publishedAt: "2026-08-25T14:00:00Z",
    sourceId: "new-jersey-stage",
    geography: { countyIds: [], municipalityIds: ["ocean-city"] },
  }, [candidate]);
  assert.equal(distinctPerformer.action, "create");
  assert.equal(distinctPerformer.reason, "conflicting_live_venue_subjects");
  assert.equal(distinctPerformer.ranked[0].signals.liveVenueSubjectConflict, 1);

  const corroboratingSource = chooseStory({
    headline: "The Outlaws LIVE! at Ocean City Music Pier",
    publishedAt: "2026-08-25T14:00:00Z",
    sourceId: "other-source",
    geography: { countyIds: [], municipalityIds: ["ocean-city"] },
  }, [candidate]);
  assert.equal(corroboratingSource.ranked[0].signals.liveVenueSubjectConflict, 0);
});

test("geography matches normalized county and municipality references", () => {
  const counties = [{ id:7, name:"Essex" }, { id:4, name:"Camden" }];
  const municipalities = [{ id:"newark", county_id:7, name:"Newark City", aliases:["Newark"] }, { id:"camden", county_id:4, name:"Camden City", aliases:["Camden"] }];
  const result = matchGeography("Newark officials in Essex County announced the plan", counties, municipalities, {});
  assert.deepEqual(result.counties.map((county) => county.id), [7]);
  assert.deepEqual(result.municipalities.map((municipality) => municipality.id), ["newark"]);
});

test("one broken source does not abort healthy sources", async () => {
  const sources = [{ id:"good" }, { id:"bad" }, { id:"also-good" }];
  const results = await runIsolatedSources(sources, async (source) => {
    if (source.id === "bad") throw new Error("broken feed");
    return { sourceId:source.id, status:"succeeded" };
  }, 2);
  assert.deepEqual(results.map((result) => result.status), ["succeeded", "failed", "succeeded"]);
});

test("due-source selection respects cadence and fairly prioritizes never/least-recently checked providers", () => {
  const at = Date.parse("2026-08-21T20:00:00Z");
  const selected = selectDueSources([
    { id:"recent-due", name:"Recent", priority:95, active:true, ingestion_method:"rss", poll_interval_minutes:30, last_checked_at:"2026-08-21T19:00:00Z" },
    { id:"never-lower", name:"Never Lower", priority:60, active:true, ingestion_method:"rss", poll_interval_minutes:30, last_checked_at:null },
    { id:"oldest", name:"Oldest", priority:50, active:true, ingestion_method:"rss", poll_interval_minutes:30, last_checked_at:"2026-08-21T17:00:00Z" },
    { id:"never-higher", name:"Never Higher", priority:90, active:true, ingestion_method:"rss", poll_interval_minutes:30 },
    { id:"fresh", active:true, ingestion_method:"rss", poll_interval_minutes:30, last_checked_at:"2026-08-21T19:45:00Z" },
    { id:"html", active:true, ingestion_method:"html", poll_interval_minutes:30 },
  ], at);
  assert.deepEqual(selected.map((source) => source.id), ["never-higher", "never-lower", "oldest", "recent-due"]);
});

test("ingestion work budget enforces both the item quota and absolute deadline", () => {
  const quota = createIngestionWorkBudget({ startedAt: Date.now(), maximumItems: 2, wallBudgetMs: 60_000 });
  assert.equal(quota.take(), true);
  assert.equal(quota.take(), true);
  assert.equal(quota.take(), false);
  assert.equal(quota.consumed, 2);
  assert.equal(quota.exhausted(), true);
  const expired = createIngestionWorkBudget({ startedAt: Date.now() - 2_000, maximumItems: 10, wallBudgetMs: 1_000 });
  assert.equal(expired.take(), false);
});

test("backlog recovery cannot consume the provider-polling reserve", () => {
  assert.equal(INGESTION_MAX_ITEMS_PER_RUN, 100);
  assert.equal(INGESTION_BACKLOG_MAX_ITEMS_PER_RUN, 50);
  assert.ok(INGESTION_BACKLOG_MAX_ITEMS_PER_RUN < INGESTION_MAX_ITEMS_PER_RUN);
  const budget = createIngestionWorkBudget({ maximumItems: INGESTION_MAX_ITEMS_PER_RUN, wallBudgetMs: 60_000 });
  for (let index = 0; index < INGESTION_BACKLOG_MAX_ITEMS_PER_RUN; index += 1) assert.equal(budget.take(), true);
  assert.equal(budget.consumed, INGESTION_BACKLOG_MAX_ITEMS_PER_RUN);
  assert.equal(budget.exhausted(), false);
  assert.equal(budget.take(), true);
});

test("manual ingestion excludes published feed entries older than one month", () => {
  const at = Date.parse("2026-08-27T12:00:00Z");
  assert.equal(MANUAL_INGESTION_RETENTION_DAYS, 30);
  assert.equal(withinIngestionLookback({ publishedAt: "2026-07-28T12:00:00Z" }, { at }), true);
  assert.equal(withinIngestionLookback({ publishedAt: "2026-07-28T11:59:59Z" }, { at }), false);
  assert.equal(withinIngestionLookback({ publishedAt: null }, { at }), true);
});

test("source-item claims install an opaque lease and status fence", async () => {
  const calls = [];
  const builder = {
    update(value) { calls.push(["update", value]); return this; },
    eq(column, value) { calls.push(["eq", column, value]); return this; },
    in(column, value) { calls.push(["in", column, value]); return this; },
    select() { calls.push(["select"]); return this; },
    maybeSingle() {
      const update = calls.find(([operation]) => operation === "update")[1];
      return Promise.resolve({ data: { id: "item-a", ...update }, error: null });
    },
  };
  const claimed = await claimSourceItem({ from: () => builder }, { id: "item-a", processing_status: "error" }, Date.parse("2026-08-26T06:00:00Z"));
  assert.equal(claimed.processing_status, "processing");
  assert.match(claimed.processing_token, /^[0-9a-f-]{36}$/i);
  assert.equal(claimed.processing_started_at, "2026-08-26T06:00:00.000Z");
  assert.deepEqual(calls.find(([operation]) => operation === "in"), ["in", "processing_status", ["pending", "error"]]);
});

test("manual ingestion validates source IDs and dispatches only to the protected background worker", async () => {
  const previous = process.env.REATH_SCHEDULE_TOKEN;
  process.env.REATH_SCHEDULE_TOKEN = "test-background-token";
  const sourceId = "12345678-1234-4123-8123-123456789abc";
  const calls = [];
  try {
    assert.deepEqual(normalizeSourceIds([sourceId.toUpperCase(), sourceId]), [sourceId]);
    assert.throws(() => normalizeSourceIds(["not-a-uuid"]), /valid Source UUID/);
    const dispatched = await dispatchIngestionBackground(
      new globalThis.Request("https://reath.example/api/reath/ingest", { method: "POST" }),
      { triggerType: "manual", triggeredBy: "editor-a", sourceIds: [sourceId] },
      async (url, options) => {
        calls.push({ url: String(url), options });
        return new Response(null, { status: 202 });
      },
    );
    assert.deepEqual(dispatched, { accepted: true });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://reath.example/.netlify/functions/reath-ingest-background");
    assert.equal(calls[0].options.headers["x-reath-schedule-token"], "test-background-token");
    assert.deepEqual(JSON.parse(calls[0].options.body).sourceIds, [sourceId]);
  } finally {
    if (previous === undefined) delete process.env.REATH_SCHEDULE_TOKEN;
    else process.env.REATH_SCHEDULE_TOKEN = previous;
  }
});

test("structured deterministic enrichment validates and keeps dimensions separate", () => {
  const result = deterministicEnrichment({
    story:{ canonical_title:"Newark council approves bizarre overnight bus pilot", event_date:null },
    sourceItems:[{ headline:"Newark council approves bizarre overnight bus pilot", description:"Residents can attend a public hearing before the pilot begins." }],
    geography:{ counties:[{ name:"Essex" }], municipalities:[{ name:"Newark" }] },
  });
  assert.doesNotThrow(() => enrichmentSchema.parse(result.enrichment));
  assert.doesNotThrow(() => scoreSchema.parse(result.scores));
  assert.ok(result.scores.reath_potential > result.scores.significance);
  assert.match(result.scores.reasons.civic_utility, /actionable civic/i);
});

test("editorial changes, merge, and detach plans validate without publishing", () => {
  assert.deepEqual(validateEditorialChange({ status:"keep", route:"digest" }).route, "digest");
  assert.throws(() => validateEditorialChange({ status:"publish" }), /Invalid editorial status/);
  assert.deepEqual(planStoryMerge({ targetStoryId:"a", sourceStoryId:"b", sourceItemIds:["1","1"] }).sourceItemIds, ["1"]);
  assert.equal(planDetach({ storyId:"a", sourceItemId:"1", reason:"Wrong event" }).reason, "Wrong event");
});

test("Netlify identity authorization fails closed and uses app metadata roles", () => {
  assert.equal(highestRole(["viewer","editor"]), "editor");
  const identity = normalizeIdentityUser({ id:"u1", email:"editor@example.com", appMetadata:{ roles:["editor"] }, userMetadata:{ roles:["owner"] } });
  assert.equal(identity.role, "editor");
  assert.equal(authorizeIdentity(null, "viewer").status, 401);
  assert.equal(authorizeIdentity(identity, "admin").status, 403);
  assert.equal(authorizeIdentity(identity, "editor").allowed, true);
});

test("runtime configuration refuses every Supabase project except the authorized Reath project", () => {
  const valid = reathConfig({ SUPABASE_URL:"https://okqkljexfzolzxysjaha.supabase.co", SUPABASE_PROJECT_REF:"okqkljexfzolzxysjaha", SUPABASE_SERVICE_ROLE_KEY:"secret", REATH_RUNTIME_CONTEXT:"test" });
  const wrong = reathConfig({ SUPABASE_URL:"https://uzderzjbitmghfvrllvz.supabase.co", SUPABASE_PROJECT_REF:"uzderzjbitmghfvrllvz", SUPABASE_SERVICE_ROLE_KEY:"secret", REATH_RUNTIME_CONTEXT:"test" });
  const suffixAttack = reathConfig({ SUPABASE_URL:"https://okqkljexfzolzxysjaha.supabase.co.attacker.example", SUPABASE_PROJECT_REF:"okqkljexfzolzxysjaha", SUPABASE_SERVICE_ROLE_KEY:"secret", REATH_RUNTIME_CONTEXT:"test" });
  const insecure = reathConfig({ SUPABASE_URL:"http://okqkljexfzolzxysjaha.supabase.co", SUPABASE_PROJECT_REF:"okqkljexfzolzxysjaha", SUPABASE_SERVICE_ROLE_KEY:"secret", REATH_RUNTIME_CONTEXT:"test" });
  assert.equal(valid.configured, true);
  assert.equal(wrong.configured, false);
  assert.equal(suffixAttack.configured, false);
  assert.equal(insecure.configured, false);
  assert.match(wrong.errors.join(" "), /not the authorized Reath project/);
  assert.match(suffixAttack.errors.join(" "), /authorized HTTPS Supabase project URL/);
  assert.match(insecure.errors.join(" "), /authorized HTTPS Supabase project URL/);
});

test("Reath Wire only renders source-comparison state from the active enrichment version", async () => {
  const client = await readFile(path.join(directory, "../src/scripts/reath-wire-client.js"), "utf8");
  assert.match(client, /analysis\.enrichment_version === story\.ai\.enrichmentVersion/);
  assert.match(client, /attempt\.enrichment_version === story\.ai\.enrichmentVersion/);
  assert.doesNotMatch(client, /(?:analysis|attempt)\.enrichment_version === state\?\.enrichment_version/);
  assert.doesNotMatch(client, /(?:analysis|attempt)\.input_fingerprint === state\?\.current_input_fingerprint/);
});

test("manual AI reconciliation uses the database-authored ingestion start fence", async () => {
  const ingestion = await readFile(path.join(directory, "../netlify/functions/_shared/reath/ingestion.mjs"), "utf8");
  const background = await readFile(path.join(directory, "../netlify/functions/reath-ingest-background.mjs"), "utf8");
  assert.match(ingestion, /startedAt: run\.started_at/);
  assert.match(background, /runHousekeeping: \(\) => runStoryAiHousekeeping/);
  assert.match(background, /configurationCutoff: coreResult\.startedAt/);
  assert.doesNotMatch(background, /configurationCutoff: new Date/);
  assert.match(ingestion, /if \(config\?\.aiEnabled && corroboration\.priorityEligible\)/);
  assert.match(ingestion, /Reload Story after deterministic enrichment/);
  assert.match(background, /deadlineAt: coreResult\.deadlineAt/);
});

test("manual API dispatches ingestion asynchronously instead of running it inline", async () => {
  const api = await readFile(path.join(directory, "../netlify/functions/reath-api.mjs"), "utf8");
  const wireClient = await readFile(path.join(directory, "../src/scripts/reath-wire-client.js"), "utf8");
  assert.match(api, /dispatchIngestionBackground\(request/);
  assert.doesNotMatch(api, /await ingestDueSources\(/);
  assert.match(wireClient, /All active sources, the one-month processing backlog, and duplicate Story candidates are being checked\./);
  assert.doesNotMatch(wireClient, /result\.status|result\.inserted|result\.duplicates|result\.errors/);
});

test("manual worker refreshes every active source and owns maintenance plus reconciliation", async () => {
  const background = await readFile(path.join(directory, "../netlify/functions/reath-ingest-background.mjs"), "utf8");
  assert.match(background, /forceSourceRefresh: manual && !dispatch\.sourceIds\?\.length/);
  assert.match(background, /lookbackDays: manual \? MANUAL_INGESTION_RETENTION_DAYS : null/);
  assert.match(background, /triggeredBy: `system:manual-ingestion:/);
  assert.match(background, /scanLimit: 2_000/);
  assert.doesNotMatch(background, /netlify-schedule|triggerType === "scheduled"/);
});

test("database migration contains current geography, idempotency constraints, RLS, and no auto-publish object", async () => {
  const migration = await readFile(path.join(directory, "../supabase/migrations/20260822031655_convert_creative_os_to_reath_digest.sql"), "utf8");
  assert.equal((migration.match(/^  \(\d+, '.*', '.*', '(?:borough|city|town|township|village|other)', array\[/gm) || []).length, 564);
  assert.equal((migration.match(/^  \(\d+, '[A-Za-z ]+', '[a-z-]+', '0\d\d', '\d\d'\)/gm) || []).length, 21);
  assert.match(migration, /canonical_url text not null unique/);
  assert.match(migration, /source_items_source_guid_unique/);
  assert.match(migration, /alter table public\.%I enable row level security/);
  assert.match(migration, /revoke all on table public\.%I from public, anon, authenticated/);
  assert.doesNotMatch(migration, /auto_publish|published_articles|publication_job/i);
});
