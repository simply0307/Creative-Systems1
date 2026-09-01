import assert from "node:assert/strict";
import test from "node:test";

import { deskSection } from "../netlify/functions/reath-api.mjs";

const scores = (overrides = {}) => ({
  reath_potential: 20,
  momentum: 20,
  significance: 20,
  civic_utility: 20,
  ...overrides,
});

const story = ({ priorityEligible = false, editorialStatus = "new", activeScores = scores() } = {}) => ({
  active_scores: activeScores,
  corroboration: { priorityEligible },
  editorial_queue: { status: editorialStatus, route: null },
});

test("a high-scoring single-source Story remains Low Signal", () => {
  assert.equal(deskSection(story({ activeScores: scores({ reath_potential: 99, civic_utility: 99, significance: 99 }) })), "Low Signal");
});

test("corroboration unlocks automatic desk sections without declaring truth", () => {
  assert.equal(deskSection(story({ priorityEligible: true, activeScores: scores({ reath_potential: 75 }) })), "Reath Bait");
  assert.equal(deskSection(story({ priorityEligible: true, activeScores: scores({ momentum: 70 }) })), "Developing");
  assert.equal(deskSection(story({ priorityEligible: true, activeScores: scores({ civic_utility: 70 }) })), "Worth a Look");
  assert.equal(deskSection(story({ priorityEligible: true })), "Corroborated");
});

test("human editorial decisions override the automatic corroboration gate", () => {
  assert.equal(deskSection(story({ editorialStatus: "keep" })), "Kept");
  assert.equal(deskSection(story({ editorialStatus: "watch" })), "Watch");
  assert.equal(deskSection(story({ editorialStatus: "ignore" })), "Ignored");
});
