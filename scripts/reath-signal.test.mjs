import assert from "node:assert/strict";
import test from "node:test";

import {
  assessStorySignal,
  assessmentForSourceItem,
  evidenceOriginKeyFor,
} from "../netlify/functions/_shared/reath/signal.mjs";

const assessment = ({
  group,
  role = "independent_journalism",
  status = "reviewed",
  tier = 2,
  assessedAt = "2026-08-26T12:00:00Z",
  supersededAt = null,
} = {}) => ({
  id: `${group || "unknown"}-${role}-${status}-${tier}`,
  assessment_status: status,
  evidence_role: role,
  corroboration_group_key: group,
  verification_tier: tier,
  assessed_at: assessedAt,
  superseded_at: supersededAt,
});

const sourceItem = ({ sourceId, assessments = [], detachedAt = null, author = null, byline } = {}) => ({
  source_id: sourceId,
  detached_at: detachedAt,
  author,
  ...(byline === undefined ? {} : { byline }),
  sources: { id: sourceId, source_assessments: assessments },
});

const expectedKeys = [
  "distinctSourceCount",
  "independentProviderCount",
  "priorityEligible",
  "qualifiedJournalismCount",
  "reason",
  "reputableAccountCount",
  "sourceItemCount",
  "status",
  "unassessedSourceCount",
];

test("story signal returns only the transparent public contract", () => {
  assert.deepEqual(Object.keys(assessStorySignal([])).sort(), expectedKeys);
});

test("unrecognized bylines use the same normalized provider fallback as SQL", () => {
  assert.equal(
    evidenceOriginKeyFor(sourceItem({ sourceId: "local", author: "Independent Reporter" }), "  Local-Newsroom  "),
    "provider:local-newsroom",
  );
});

test("repeated items from one source do not add independent corroboration", () => {
  const reviewed = assessment({ group: "newsroom-a" });
  const result = assessStorySignal([
    sourceItem({ sourceId: "source-a", assessments: [reviewed] }),
    sourceItem({ sourceId: "source-a", assessments: [reviewed] }),
  ]);
  assert.equal(result.sourceItemCount, 2);
  assert.equal(result.distinctSourceCount, 1);
  assert.equal(result.independentProviderCount, 1);
  assert.equal(result.qualifiedJournalismCount, 1);
  assert.equal(result.priorityEligible, false);
});

test("different sources under one corroboration group count as one provider", () => {
  const result = assessStorySignal([
    sourceItem({ sourceId: "feed-a", assessments: [assessment({ group: "shared-owner" })] }),
    sourceItem({ sourceId: "feed-b", assessments: [assessment({ group: "shared-owner" })] }),
  ]);
  assert.equal(result.distinctSourceCount, 2);
  assert.equal(result.independentProviderCount, 1);
  assert.equal(result.qualifiedJournalismCount, 1);
  assert.equal(result.priorityEligible, false);
});

test("two independent reviewed journalism groups are priority eligible", () => {
  const result = assessStorySignal([
    sourceItem({ sourceId: "source-a", assessments: [assessment({ group: "newsroom-a" })] }),
    sourceItem({ sourceId: "source-b", assessments: [assessment({ group: "newsroom-b" })] }),
  ]);
  assert.equal(result.independentProviderCount, 2);
  assert.equal(result.qualifiedJournalismCount, 2);
  assert.equal(result.reputableAccountCount, 2);
  assert.equal(result.status, "corroborated_journalism");
  assert.equal(result.priorityEligible, true);
});

test("syndicated New Jersey Statehouse News Service copy counts as one evidence origin", () => {
  const result = assessStorySignal([
    sourceItem({
      sourceId: "mercerme",
      author: "New Jersey Statehouse News Service",
      assessments: [assessment({ group: "mercerme" })],
    }),
    sourceItem({
      sourceId: "nj-urban-news",
      author: "New Jersey State House News",
      assessments: [assessment({ group: "nj-urban-news" })],
    }),
  ]);
  assert.equal(result.sourceItemCount, 2);
  assert.equal(result.distinctSourceCount, 2);
  assert.equal(result.independentProviderCount, 1);
  assert.equal(result.qualifiedJournalismCount, 1);
  assert.equal(result.reputableAccountCount, 1);
  assert.equal(result.status, "insufficient_corroboration");
  assert.equal(result.priorityEligible, false);
});

test("two independently authored outlets still count as two evidence origins", () => {
  const result = assessStorySignal([
    sourceItem({
      sourceId: "local-a",
      author: "Alex Reporter",
      assessments: [assessment({ group: "local-a-newsroom" })],
    }),
    sourceItem({
      sourceId: "local-b",
      author: "Bailey Journalist",
      assessments: [assessment({ group: "local-b-newsroom" })],
    }),
  ]);
  assert.equal(result.independentProviderCount, 2);
  assert.equal(result.qualifiedJournalismCount, 2);
  assert.equal(result.reputableAccountCount, 2);
  assert.equal(result.status, "corroborated_journalism");
  assert.equal(result.priorityEligible, true);
});

test("exact and explicitly credited AP and Reuters bylines collapse reprints without broad author matching", () => {
  const ap = assessStorySignal([
    sourceItem({ sourceId: "ap-a", author: "The Associated Press", assessments: [assessment({ group: "ap-a" })] }),
    sourceItem({ sourceId: "ap-b", byline: "By AP", assessments: [assessment({ group: "ap-b" })] }),
  ]);
  assert.equal(ap.independentProviderCount, 1);
  assert.equal(ap.priorityEligible, false);

  const reuters = assessStorySignal([
    sourceItem({ sourceId: "reuters-a", author: "Reuters", assessments: [assessment({ group: "reuters-a" })] }),
    sourceItem({ sourceId: "reuters-b", author: "By Thomson Reuters", assessments: [assessment({ group: "reuters-b" })] }),
  ]);
  assert.equal(reuters.independentProviderCount, 1);
  assert.equal(reuters.priorityEligible, false);

  assert.equal(
    evidenceOriginKeyFor(sourceItem({ sourceId: "compound-ap", author: "NBC New York Staff and Associated Press" }), "nbc-local"),
    "origin:associated-press",
  );
  assert.equal(
    evidenceOriginKeyFor(sourceItem({ sourceId: "compound-reuters", author: "Reuters with Local Desk" }), "local-desk"),
    "origin:reuters",
  );

  const independent = assessStorySignal([
    sourceItem({ sourceId: "local-a", author: "Associated Press Street Desk", assessments: [assessment({ group: "local-a" })] }),
    sourceItem({ sourceId: "local-b", author: "Reuters Township Reporter", assessments: [assessment({ group: "local-b" })] }),
  ]);
  assert.equal(independent.independentProviderCount, 2);
  assert.equal(independent.priorityEligible, true);
});

test("one provider cannot multiply corroboration by carrying different wire origins", () => {
  const result = assessStorySignal([
    sourceItem({ sourceId: "same-outlet", author: "Associated Press", assessments: [assessment({ group: "same-newsroom" })] }),
    sourceItem({ sourceId: "same-outlet", author: "Reuters", assessments: [assessment({ group: "same-newsroom" })] }),
  ]);
  assert.equal(result.distinctSourceCount, 1);
  assert.equal(result.independentProviderCount, 1);
  assert.equal(result.qualifiedJournalismCount, 1);
  assert.equal(result.priorityEligible, false);
});

test("one journalism group plus two independent official groups is eligible", () => {
  const result = assessStorySignal([
    sourceItem({ sourceId: "news", assessments: [assessment({ group: "newsroom", role: "independent_journalism" })] }),
    sourceItem({ sourceId: "agency-a", assessments: [assessment({ group: "agency-a", role: "official_primary" })] }),
    sourceItem({ sourceId: "agency-b", assessments: [assessment({ group: "agency-b", role: "official_primary" })] }),
  ]);
  assert.equal(result.qualifiedJournalismCount, 1);
  assert.equal(result.reputableAccountCount, 3);
  assert.equal(result.status, "corroborated_reputable_accounts");
  assert.equal(result.priorityEligible, true);
});

test("official-only evidence is not eligible without journalism", () => {
  const result = assessStorySignal(["a", "b", "c"].map((id) => sourceItem({
    sourceId: id,
    assessments: [assessment({ group: `agency-${id}`, role: "official_primary" })],
  })));
  assert.equal(result.reputableAccountCount, 3);
  assert.equal(result.qualifiedJournalismCount, 0);
  assert.equal(result.status, "insufficient_corroboration");
  assert.equal(result.priorityEligible, false);
});

test("detached evidence is excluded from every signal count", () => {
  const result = assessStorySignal([
    sourceItem({ sourceId: "active", assessments: [assessment({ group: "active-news" })] }),
    sourceItem({ sourceId: "detached", detachedAt: "2026-08-26T13:00:00Z", assessments: [assessment({ group: "detached-news" })] }),
  ]);
  assert.equal(result.sourceItemCount, 1);
  assert.equal(result.distinctSourceCount, 1);
  assert.equal(result.independentProviderCount, 1);
  assert.equal(result.qualifiedJournalismCount, 1);
  assert.equal(result.priorityEligible, false);
});

test("provisional, unrated, superseded, and unknown assessments fail closed", () => {
  const sourceWithHistory = sourceItem({ sourceId: "history", assessments: [
    assessment({ group: "history", status: "reviewed", supersededAt: "2026-08-25T00:00:00Z" }),
    assessment({ group: "history", status: "provisional", assessedAt: "2026-08-26T00:00:00Z" }),
  ] });
  assert.equal(assessmentForSourceItem(sourceWithHistory).assessment_status, "provisional");

  const result = assessStorySignal([
    sourceWithHistory,
    sourceItem({ sourceId: "unrated", assessments: [assessment({ group: "unrated", status: "unrated" })] }),
    sourceItem({ sourceId: "unknown" }),
    sourceItem({ sourceId: "missing-tier", assessments: [assessment({ group: "missing-tier", tier: null })] }),
    sourceItem({ sourceId: "low-tier", assessments: [assessment({ group: "low-tier", tier: 1 })] }),
    sourceItem({ sourceId: "context", assessments: [assessment({ group: "context", role: "context_only", tier: 3 })] }),
  ]);
  assert.equal(result.sourceItemCount, 6);
  assert.equal(result.distinctSourceCount, 6);
  assert.equal(result.independentProviderCount, 0);
  assert.equal(result.qualifiedJournalismCount, 0);
  assert.equal(result.reputableAccountCount, 0);
  assert.equal(result.unassessedSourceCount, 4);
  assert.equal(result.priorityEligible, false);
  assert.match(result.reason, /Not eligible/);
});
