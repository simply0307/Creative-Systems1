import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import evidence from "../docs/evidence/creative-os-architecture-baseline-2026-08-09.json" with { type: "json" };

const root = path.resolve(import.meta.dirname, "..");
const architecture = fs.readFileSync(path.join(root, "docs/CREATIVE_OS_ARCHITECTURE.md"), "utf8");

const invariants = [
  "Postgres owns canonical creative history.",
  "Runtime providers never own provenance.",
  "Queue messages never own workflow state.",
  "Blob URLs are not artifact identity.",
  "Artifacts and artifact versions are distinct.",
  "Definitions, instances, versions, and runs are distinct.",
  "Every generated output points to exact input versions.",
  "Historical runs never resolve `latest`.",
  "Rendered prompts are immutable run evidence.",
  "Provider-specific APIs do not leak into graph semantics.",
  "Ports describe valid flow; provenance records actual history.",
  "Similarity does not imply provenance or canon.",
  "Published assets reference approved immutable versions.",
  "Unknown rights default to internal-only.",
  "Authentication and authorization fail closed.",
  "Privileged roles are server-controlled.",
  "Normal page loads never mutate canonical state.",
  "Immutable historical records are appended, not overwritten.",
  "Netlify remains rollback infrastructure until Cloudflare and Supabase Auth achieve verified parity.",
  "New infrastructure must earn its complexity against a concrete milestone.",
];

test("architecture contract preserves every approved invariant", () => {
  for (const invariant of invariants) assert.match(architecture, new RegExp(invariant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("architecture contract fixes Postgres while keeping only real provider boundaries replaceable", () => {
  assert.match(architecture, /Do \*\*not\*\* introduce a generic database-provider abstraction/);
  for (const boundary of ["RuntimeAdapter", "AuthProvider", "BlobProvider", "GenerationProvider", "JobQueue", "WorkflowExecutor"]) {
    assert.match(architecture, new RegExp(`\\b${boundary}\\b`));
  }
  assert.match(architecture, /No `DatabaseProvider`[^\n]*is planned/);
});

test("future graph vocabulary stays design-only and preserves semantic distinctions", () => {
  for (const concept of [
    "NodeDefinition", "NodeDefinitionVersion", "NodeInstance", "NodeVersion", "TypedEdge", "GraphVersion", "NodeRun", "WorkflowRun",
    "ArtifactVersion", "GenerationRun", "PromptVersion", "RenderedPromptSnapshot", "ProvenanceRelationship", "BlobRef", "Review", "Approval", "PublicationVersion",
  ]) assert.match(architecture, new RegExp(`\\b${concept}\\b`));
  assert.match(architecture, /Definition ≠ instance ≠ version ≠ run/);
});

test("dated evidence is explicitly non-canonical, non-secret, and read-only in method", () => {
  assert.equal(evidence.evidenceOnly, true);
  assert.equal(evidence.canonicalSourceOfTruth, false);
  assert.equal(evidence.containsSecrets, false);
  assert.equal(evidence.runtimeContract.version, 1);
  assert.equal(evidence.runtimeContract.mutationAuthority, "creative-os-api");
  assert.equal(evidence.supabase.projectRef, "okqkljexfzolzxysjaha");
  assert.equal(evidence.supabase.knownMigrationHistoryGap.productionHistoryRewritten, false);
  assert.ok(evidence.capture.methods.every((method) => /read|SELECT|GET/i.test(method)));
  assert.doesNotMatch(JSON.stringify(evidence), /sb_secret_|service_role|password|signedUrl/i);
});
