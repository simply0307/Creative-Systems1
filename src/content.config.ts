import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const archive = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/archive" }),
  schema: z.object({
    title: z.string(),
    entityType: z.enum([
      "foundation",
      "alien-principle",
      "convergence",
      "morphling",
      "astral-vanguard",
      "mortal-civilization",
      "achievement",
      "player-archetype",
      "visual-motif",
      "mechanic",
      "para-application",
      "project",
      "artifact",
    ]),
    summary: z.string(),
    canonStatus: z.enum([
      "foundation-canon",
      "project-canon",
      "strong-direction",
      "flexible-inspiration",
      "experimental",
      "retired",
    ]),
    reviewFlags: z.array(z.string()).default([]),
    tags: z.array(z.string()).default([]),
    reuseCategories: z.array(z.string()).default([]),
    relatedProjects: z.array(z.string()).default([]),
    relatedConcepts: z.array(z.string()).default([]),
    openDecisions: z.array(z.string()).default([]),
    remediationTasks: z.array(z.string()).default([]),
    sourceArtifacts: z.array(z.string()).default([]),
    riskFlags: z.array(z.string()).default([]),
    aliases: z.array(z.string()).default([]),
    version: z.string().default("0.1"),
    provenance: z.string().default("Archive synthesis"),
    featured: z.boolean().default(false),
  }),
});

const artifacts = defineCollection({
  loader: glob({ pattern: "**/*.json", base: "./src/content/artifacts" }),
  schema: z.object({
    id: z.string(), title: z.string(), type: z.string(), fileName: z.string(), filePath: z.string(),
    sourceType: z.string(), sourceUrl: z.string().nullable().default(null), creator: z.string().nullable().default(null),
    createdAt: z.string().nullable().default(null), importedAt: z.string(), rightsStatus: z.string(),
    aiGenerated: z.boolean().nullable().default(null), aiModel: z.string().nullable().default(null),
    promptUsed: z.string().nullable().default(null), canonStatus: z.string(), reviewStatus: z.string(),
    riskFlags: z.array(z.string()).default([]), tags: z.array(z.string()).default([]),
    relatedArchiveRecords: z.array(z.string()).default([]), relatedProjects: z.array(z.string()).default([]),
    relatedTasks: z.array(z.string()).default([]), notes: z.string().default(""), importBatch: z.string().nullable().default(null),
    lifecycleStage: z.string().default("Imported"),
  }),
});

const importBatches = defineCollection({
  loader: glob({ pattern: "**/*.json", base: "./src/content/import-batches" }),
  schema: z.object({
    id: z.string(), title: z.string(), importedAt: z.string(), source: z.string(), files: z.array(z.string()),
    defaultTags: z.array(z.string()).default([]), status: z.string(), notes: z.string().default(""),
  }),
});

const exportBundles = defineCollection({
  loader: glob({ pattern: "**/*.json", base: "./src/content/export-bundles" }),
  schema: z.object({
    id: z.string(), title: z.string(), createdAt: z.string(), exportType: z.string(),
    includedCollections: z.array(z.string()), includedTags: z.array(z.string()).default([]),
    includedProjects: z.array(z.string()).default([]), format: z.string(), filePath: z.string(), notes: z.string().default(""),
    publicStatus: z.string().default("internal"), riskWarnings: z.array(z.string()).default([]),
  }),
});

const pipelineTasks = defineCollection({
  loader: glob({ pattern: "**/*.json", base: "./src/content/pipeline-tasks" }),
  schema: z.object({
    id: z.string(), title: z.string(), type: z.string(), status: z.string(), priority: z.string(),
    inputFiles: z.array(z.string()).default([]), outputRecords: z.array(z.string()).default([]),
    relatedArchiveRecords: z.array(z.string()).default([]), relatedTasks: z.array(z.string()).default([]), notes: z.string().default(""),
  }),
});

const changeLog = defineCollection({
  loader: glob({ pattern: "**/*.json", base: "./src/content/change-log" }),
  schema: z.object({
    id: z.string(), actionType: z.string(), person: z.string(), timestamp: z.string(), summary: z.string(),
    affectedRecords: z.array(z.string()).default([]), affectedFiles: z.array(z.string()).default([]),
    status: z.string(), notes: z.string().default(""), sourceImpact: z.array(z.string()).default([]),
    relatedDecision: z.string().nullable().default(null),
    operationId: z.string().optional(), operationType: z.string().optional(), title: z.string().optional(),
    submittedBy: z.string().optional(), affectedExports: z.array(z.string()).default([]),
    pullRequestUrl: z.string().nullable().optional(), sourceFilesChanged: z.boolean().default(false),
    actor: z.string().optional(), adminKeyAccepted: z.boolean().optional(), reason: z.string().optional(),
    riskLevel: z.string().optional(), approvalMode: z.string().optional(), beforeSnapshot: z.record(z.string(), z.unknown()).optional(),
    afterSnapshot: z.unknown().optional(), commitSha: z.string().nullable().optional(), mergeCommitSha: z.string().nullable().optional(),
    undoInstructions: z.string().optional(), revertBranchName: z.string().nullable().optional(), revertRequestId: z.string().nullable().optional(),
    validationResult: z.unknown().optional(), policyResult: z.unknown().optional(),
    authenticated: z.boolean().optional(), userId: z.string().nullable().optional(), userEmail: z.string().nullable().optional(),
    userName: z.string().optional(), userRole: z.string().optional(), authMethod: z.string().optional(),
    intentSummary: z.string().optional(), fieldDiffs: z.array(z.unknown()).default([]), sourceEffect: z.string().optional(), canonicalEffect: z.string().optional(),
    rewriteRequested: z.boolean().optional(), followUpTasksCreated: z.boolean().optional(),
  }),
});

const decisionResolutions = defineCollection({
  loader: glob({ pattern: "**/*.json", base: "./src/content/decision-resolutions" }),
  schema: z.object({
    id: z.string(), decisionId: z.string(), selectedResolution: z.string(), rationale: z.string(),
    customResolution: z.string().default(""), submittedBy: z.string(), timestamp: z.string(),
    affectedArchiveRecords: z.array(z.string()).default([]), affectedSourceFiles: z.array(z.string()).default([]),
    affectedExports: z.array(z.string()).default([]), followUpNeeded: z.boolean(), followUpTasks: z.array(z.string()).default([]),
    statusBefore: z.string(), statusAfter: z.string(), sourceFilesChanged: z.boolean().default(false),
    createdPullRequestUrl: z.string().nullable().default(null), status: z.string(),
    canonStatusResult: z.string().nullable().optional(), reviewStatusResult: z.string().nullable().optional(),
    workType: z.string().nullable().optional(), criticalDecision: z.boolean().optional(),
  }),
});

const rewriteRequests = defineCollection({
  loader: glob({ pattern: "**/*.json", base: "./src/content/rewrite-requests" }),
  schema: z.object({
    id: z.string(), requestId: z.string(), decisionId: z.string().nullable().default(null),
    submittedBy: z.string(), timestamp: z.string(), rationale: z.string(),
    affectedSourceFiles: z.array(z.string()).default([]), proposedStructuredWork: z.string().nullable().default(null),
    humanReviewBoundary: z.string().nullable().default(null), preserveRawSources: z.boolean().default(true),
    status: z.string(), sourceFilesChanged: z.boolean().default(false), createdPullRequestUrl: z.string().nullable().default(null),
  }),
});

const revertRequests = defineCollection({
  loader: glob({ pattern: "**/*.json", base: "./src/content/revert-requests" }),
  schema: z.object({
    id: z.string(), requestId: z.string(), originalOperationId: z.string().nullable().default(null),
    originalCommitSha: z.string().nullable().default(null), submittedBy: z.string(), timestamp: z.string(),
    rationale: z.string(), status: z.string(), inverseApplied: z.boolean().default(false),
    sourceFilesChanged: z.boolean().default(false), createdPullRequestUrl: z.string().nullable().default(null), instructions: z.string(),
  }),
});

export const collections = { archive, artifacts, importBatches, exportBundles, pipelineTasks, changeLog, decisionResolutions, rewriteRequests, revertRequests };
