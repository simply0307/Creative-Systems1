import { assertAllowedWritePath } from "./github-adapter.mjs";
import { buildOperationPresentation } from "../../../src/data/operation-lifecycle.mjs";

export const MAX_BATCH_SIZE = 25;

const ACTION_MAP = new Map([
  ["artifact_metadata_update", "artifact_metadata_update"],
  ["metadata.update", "artifact_metadata_update"],
  ["bulk_artifact_metadata_update", "bulk_artifact_metadata_update"],
  ["metadata.bulk-update", "bulk_artifact_metadata_update"],
  ["decision_resolution", "decision_resolution"],
  ["decision.resolve", "decision_resolution"],
  ["source_rewrite_request", "source_rewrite_request"],
  ["rewrite.plan", "source_rewrite_request"],
  ["change_log_entry", "change_log_entry"],
  ["changelog.append", "change_log_entry"],
  ["export.regenerate", "change_log_entry"],
  ["publish.request", "change_log_entry"],
  ["revert_operation", "revert_operation"],
  ["review_action", "review_action"],
]);

export const supportedOperationTypes = [...new Set(ACTION_MAP.values())];

export const sanitizeId = (value, label = "id") => {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(value)) throw new Error(`${label} contains unsafe characters`);
  return value;
};

export const normalizeOperationType = (value) => {
  const operationType = ACTION_MAP.get(value);
  if (!operationType) throw new Error(`Unsupported operation type: ${String(value)}`);
  return operationType;
};

export const validateOperationPayload = (payload) => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("JSON object body required");
  const operationType = normalizeOperationType(payload.operationType || payload.action);
  const submittedBy = String(payload.submittedBy || payload.actor || "").trim();
  if (!submittedBy) throw new Error("submittedBy or actor is required");
  if (submittedBy.length > 160) throw new Error("submittedBy is too long");
  const targets = Array.isArray(payload.targets) ? payload.targets : [];
  if (!targets.length) throw new Error("at least one target is required");
  if (targets.length > MAX_BATCH_SIZE) throw new Error(`batch size cannot exceed ${MAX_BATCH_SIZE}`);
  targets.forEach((target) => sanitizeId(target, "target"));
  const rationale = String(payload.rationale || payload.reason || "").trim();
  if (["decision_resolution", "source_rewrite_request"].includes(operationType) && !rationale) throw new Error("rationale is required for decision resolutions and rewrite requests");
  if (operationType === "decision_resolution") {
    sanitizeId(payload.decisionId, "decisionId");
    if (!payload.resolution?.selected) throw new Error("resolution.selected is required");
    if (payload.resolution.selected === "custom" && !String(payload.resolution.custom || "").trim()) throw new Error("custom resolution text is required");
  }
  if (operationType === "revert_operation" && !payload.revertOperationId && !payload.commitSha) throw new Error("revertOperationId or commitSha is required");
  if (operationType === "review_action") {
    if (!Number.isInteger(Number(payload.pullRequestNumber)) || Number(payload.pullRequestNumber) < 1) throw new Error("pullRequestNumber is required");
    if (!["approve","reject","request-changes","needs-review","merge","add-note","escalate-owner","reopen"].includes(payload.reviewAction)) throw new Error("Unsupported review action");
  }
  return { ...payload, operationType, submittedBy, rationale, targets };
};

const stamp = (date) => date.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
const jsonFile = (path, value) => ({ path: assertAllowedWritePath(path), content: `${JSON.stringify(value, null, 2)}\n` });
const artifactPath = (artifactId) => `src/content/artifacts/${sanitizeId(artifactId.replace(/^artifact\./, ""), "artifactId")}.json`;
const addUnique = (values, value) => value ? [...new Set([...(values || []), value])] : values || [];

const applyArtifactChanges = (current, changes, timestamp) => {
  const next = { ...current };
  if (Array.isArray(changes.tags)) next.tags = [...new Set(changes.tags)];
  if (Array.isArray(changes.addTags) || Array.isArray(changes.removeTags)) {
    const removed = new Set(changes.removeTags || []);
    next.tags = [...new Set([...(current.tags || []), ...(changes.addTags || [])])].filter((tag) => !removed.has(tag));
  }
  const direct = ["type", "lifecycleStage", "canonStatus", "rightsStatus", "reviewStatus", "relatedProjects", "relatedArchiveRecords", "relatedTasks", "riskFlags", "notes"];
  direct.forEach((key) => { if (changes[key] !== undefined) next[key] = changes[key]; });
  if (changes.project) next.relatedProjects = addUnique(current.relatedProjects, changes.project);
  if (changes.archiveRecord) next.relatedArchiveRecords = addUnique(current.relatedArchiveRecords, changes.archiveRecord);
  if (changes.relatedTask) next.relatedTasks = addUnique(current.relatedTasks, changes.relatedTask);
  next.updatedAt = timestamp;
  return next;
};

export const createOperationDraft = (validated, now = new Date()) => {
  const timestamp = now.toISOString();
  const token = stamp(now);
  const operationId = sanitizeId(validated.operationId || `operation.${token}.${Math.random().toString(36).slice(2, 7)}`, "operationId");
  const title = validated.summary || `${validated.operationType} by ${validated.submittedBy}`;
  const affectedExports = validated.affectedExports || (validated.sourceImpact?.includes("generated-exports-requested") || validated.action === "export.regenerate" ? ["all-generated-bundles"] : []);
  return { ...validated, timestamp, token, operationId, title, affectedExports };
};

export const buildGitWritePlan = async (draft, { readJson }) => {
  const files = [];
  const affectedFiles = [];
  let decisionResolution = null;
  let sourceRewriteRequest = null;
  let revertRequest = null;
  let decisionPath = null;
  let rewritePath = null;
  let revertPath = null;
  const beforeSnapshot = {};
  const afterSnapshot = {};

  if (["artifact_metadata_update", "bulk_artifact_metadata_update"].includes(draft.operationType)) {
    for (const target of draft.targets) {
      const path = draft.sourceFiles?.[target] || (draft.targets.length === 1 && draft.affectedFiles?.[0]) || artifactPath(target);
      assertAllowedWritePath(path);
      if (!path.startsWith("src/content/artifacts/")) throw new Error(`Artifact metadata must write under src/content/artifacts/: ${path}`);
      const existing = await readJson(path);
      if (!existing?.data) throw new Error(`Artifact record not found on the default branch: ${path}`);
      const updated = applyArtifactChanges(existing.data, draft.changes || {}, draft.timestamp);
      beforeSnapshot[target] = existing.data;
      afterSnapshot[target] = updated;
      files.push(jsonFile(path, updated));
      affectedFiles.push(path);
    }
  }

  if (draft.operationType === "decision_resolution") {
    const decisionSlug = sanitizeId(draft.decisionId.toLowerCase(), "decisionId");
    const path = `src/content/decision-resolutions/${decisionSlug}-${draft.token}.json`;
    decisionPath = path;
    decisionResolution = {
      id: `resolution.${decisionSlug}.${draft.token}`,
      decisionId: draft.decisionId,
      selectedResolution: draft.resolution.selected,
      customResolution: draft.resolution.custom || "",
      rationale: draft.rationale,
      submittedBy: draft.submittedBy,
      timestamp: draft.timestamp,
      affectedArchiveRecords: draft.affectedArchiveRecords || draft.targets,
      affectedSourceFiles: draft.affectedSourceFiles || draft.affectedFiles || [],
      affectedExports: draft.affectedExports,
      followUpNeeded: Boolean(draft.followUpNeeded ?? draft.followUp?.length),
      followUpTasks: draft.followUpTasks || draft.followUp || [],
      canonStatusResult: draft.canonStatusResult || null,
      reviewStatusResult: draft.reviewStatusResult || null,
      workType: draft.workType || null,
      criticalDecision: Boolean(draft.criticalDecision),
      statusBefore: draft.statusBefore || "open",
      statusAfter: draft.statusAfter || "proposed-resolution",
      sourceFilesChanged: false,
      createdPullRequestUrl: null,
      status: "pull-request-staged",
    };
    files.push(jsonFile(path, decisionResolution));
    affectedFiles.push(path);
    if (draft.rewritePlan && (decisionResolution.affectedSourceFiles.length || draft.rewritePlan.automatic)) {
      rewritePath = `src/content/rewrite-requests/rewrite-${decisionSlug}-${draft.token}.json`;
      sourceRewriteRequest = {
        id: `rewrite.${decisionSlug}.${draft.token}`,
        requestId: `rewrite-${decisionSlug}-${draft.token}`,
        decisionId: draft.decisionId,
        submittedBy: draft.submittedBy,
        timestamp: draft.timestamp,
        rationale: draft.rationale,
        affectedSourceFiles: decisionResolution.affectedSourceFiles,
        proposedStructuredWork: draft.rewritePlan.automatic || null,
        humanReviewBoundary: draft.rewritePlan.humanReview || null,
        preserveRawSources: draft.rewritePlan.preserveRawSources !== false,
        status: "needs-human-review",
        sourceFilesChanged: false,
        createdPullRequestUrl: null,
      };
      files.push(jsonFile(rewritePath, sourceRewriteRequest));
      affectedFiles.push(rewritePath);
    }
  }

  if (draft.operationType === "source_rewrite_request") {
    const requestSlug = sanitizeId((draft.requestId || draft.operationId).toLowerCase(), "requestId");
    const path = `src/content/rewrite-requests/${requestSlug}.json`;
    rewritePath = path;
    sourceRewriteRequest = {
      id: requestSlug,
      requestId: requestSlug,
      decisionId: draft.decisionId || null,
      submittedBy: draft.submittedBy,
      timestamp: draft.timestamp,
      rationale: draft.rationale,
      affectedSourceFiles: draft.affectedSourceFiles || draft.affectedFiles || [],
      proposedStructuredWork: draft.rewritePlan?.automatic || null,
      humanReviewBoundary: draft.rewritePlan?.humanReview || null,
      preserveRawSources: draft.rewritePlan?.preserveRawSources !== false,
      status: "needs-human-review",
      sourceFilesChanged: false,
      createdPullRequestUrl: null,
    };
    files.push(jsonFile(path, sourceRewriteRequest));
    affectedFiles.push(path);
  }

  if (draft.operationType === "revert_operation") {
    const original = sanitizeId(draft.revertOperationId || draft.commitSha, "revert target");
    const slug = original.toLowerCase();
    revertPath = `src/content/revert-requests/revert-${slug}-${draft.token}.json`;
    revertRequest = {
      id: `revert.${slug}.${draft.token}`,
      requestId: `revert-${slug}-${draft.token}`,
      originalOperationId: draft.revertOperationId || null,
      originalCommitSha: draft.commitSha || null,
      submittedBy: draft.submittedBy,
      timestamp: draft.timestamp,
      rationale: draft.rationale,
      status: "needs-human-review",
      inverseApplied: false,
      sourceFilesChanged: false,
      createdPullRequestUrl: null,
      instructions: "Review the original audit before snapshot and prepare an inverse metadata commit. This request does not claim an automatic revert.",
    };
    files.push(jsonFile(revertPath, revertRequest));
    affectedFiles.push(revertPath);
  }

  const presentedAfter = Object.keys(afterSnapshot).length ? afterSnapshot : (decisionResolution || sourceRewriteRequest || revertRequest || null);
  const presentation = buildOperationPresentation({
    ...draft, beforeSnapshot, afterSnapshot:presentedAfter,
    affectedSourceFiles:draft.affectedSourceFiles || draft.affectedFiles || [],
    followUpTasks:draft.followUpTasks || draft.followUp || [],
  });
  const changePath = `src/content/change-log/${draft.token}-${draft.operationId.replace(/[^A-Za-z0-9._-]/g, "-")}.json`;
  const changeLogEntry = {
    id: `change.${draft.operationId}`,
    operationId: draft.operationId,
    operationType: draft.operationType,
    actionType: draft.operationType,
    title: presentation.title,
    summary: presentation.title,
    intentSummary: presentation.intentSummary,
    fieldDiffs: presentation.fieldDiffs,
    sourceEffect: presentation.sourceEffect,
    canonicalEffect: presentation.canonicalEffect,
    rewriteRequested: presentation.rewriteRequested,
    followUpTasksCreated: presentation.followUpTasksCreated,
    submittedBy: draft.submittedBy,
    person: draft.submittedBy,
    timestamp: draft.timestamp,
    affectedRecords: draft.targets,
    affectedFiles: [...new Set([...affectedFiles, ...(draft.affectedFiles || [])])],
    affectedExports: draft.affectedExports,
    status: "pull-request-staged",
    pullRequestUrl: null,
    notes: draft.rationale || draft.reason || "",
    sourceImpact: draft.sourceImpact || [],
    relatedDecision: draft.decisionId || null,
    sourceFilesChanged: false,
    actor: draft.submittedBy,
    adminKeyAccepted: Boolean(draft.adminKeyAccepted),
    reason: draft.rationale || draft.reason || "",
    riskLevel: draft.policyResult?.riskLevel || "unknown",
    approvalMode: draft.approvalMode || "staged-pr",
    beforeSnapshot,
    afterSnapshot: presentedAfter,
    commitSha: null,
    mergeCommitSha: null,
    undoInstructions: draft.policyResult?.undoStrategy || "Create a logged revert request referencing this operation.",
    revertBranchName: null,
    revertRequestId: revertRequest?.requestId || null,
    validationResult: { passed: true },
    policyResult: draft.policyResult || null,
    authenticated: Boolean(draft.authenticated),
    userId: draft.userId || null,
    userEmail: draft.userEmail || null,
    userName: draft.userName || draft.submittedBy,
    userRole: draft.userRole || "viewer",
    authMethod: draft.authMethod || "none",
  };
  files.push(jsonFile(changePath, changeLogEntry));

  const finalizeFiles = (pullRequestUrl, commitSha = null) => files
    .filter((file) => [changePath, decisionPath, rewritePath, revertPath].filter(Boolean).includes(file.path))
    .map((file) => {
      const value = JSON.parse(file.content);
      if ("createdPullRequestUrl" in value) value.createdPullRequestUrl = pullRequestUrl;
      if ("pullRequestUrl" in value) value.pullRequestUrl = pullRequestUrl;
      if ("commitSha" in value) value.commitSha = commitSha;
      value.status = value.status === "pull-request-staged" ? "pull-request-open" : value.status;
      return jsonFile(file.path, value);
    });

  return { files, finalizeFiles, changeLogEntry, decisionResolution, sourceRewriteRequest, revertRequest, auditRecordPath: changePath, affectedFiles: files.map((file) => file.path) };
};
