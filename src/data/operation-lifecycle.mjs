const asArray = (value) => Array.isArray(value) ? value : value == null ? [] : [value];
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const titleCase = (value) => String(value || "").replace(/[-_.]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

export const buildFieldDiffs = (beforeSnapshot = {}, afterSnapshot = {}) => {
  const records = [...new Set([...Object.keys(beforeSnapshot || {}), ...Object.keys(afterSnapshot || {})])];
  return records.flatMap((recordId) => {
    const before = beforeSnapshot?.[recordId] || {};
    const after = afterSnapshot?.[recordId] || {};
    return [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .filter((field) => field !== "updatedAt" && !same(before[field], after[field]))
      .map((field) => {
        const prior = before[field] ?? null;
        const next = after[field] ?? null;
        const arrayField = Array.isArray(prior) || Array.isArray(next);
        return {
          recordId, field, before: prior, after: next,
          added: arrayField ? asArray(next).filter((value) => !asArray(prior).includes(value)) : [],
          removed: arrayField ? asArray(prior).filter((value) => !asArray(next).includes(value)) : [],
        };
      });
  });
};

export const buildOperationPresentation = ({ operationType, targets = [], decisionId, resolution, rewritePlan, beforeSnapshot = {}, afterSnapshot = {}, affectedSourceFiles = [], followUpTasks = [] }) => {
  let fieldDiffs = ["artifact_metadata_update", "bulk_artifact_metadata_update"].includes(operationType) ? buildFieldDiffs(beforeSnapshot, afterSnapshot) : [];
  const firstBefore = beforeSnapshot?.[targets[0]] || {};
  const targetName = firstBefore.title || firstBefore.name || targets[0] || "record";
  const tagsAdded = fieldDiffs.filter((diff) => diff.field === "tags").flatMap((diff) => diff.added);
  const tagsRemoved = fieldDiffs.filter((diff) => diff.field === "tags").flatMap((diff) => diff.removed);
  let title;
  let intentSummary;
  if (["artifact_metadata_update", "bulk_artifact_metadata_update"].includes(operationType)) {
    if (tagsAdded.length === 1 && fieldDiffs.length === 1) title = `Add tag ${tagsAdded[0]} to ${targetName}`;
    else if (tagsRemoved.length === 1 && fieldDiffs.length === 1) title = `Remove ${tagsRemoved[0]} from ${targetName}`;
    else if (tagsAdded.length) title = `Add ${tagsAdded.length} tags to ${targets.length} artifact${targets.length === 1 ? "" : "s"}`;
    else {
      const first = fieldDiffs[0];
      title = first ? `Change ${titleCase(first.field)} for ${targetName}` : `Update metadata for ${targets.length} artifact${targets.length === 1 ? "" : "s"}`;
    }
    const parts = fieldDiffs.map((diff) => diff.field === "tags"
      ? [diff.added.length ? `add ${diff.added.join(", ")}` : "", diff.removed.length ? `remove ${diff.removed.join(", ")}` : ""].filter(Boolean).join(" and ") + ` tag${diff.added.length + diff.removed.length === 1 ? "" : "s"} on ${firstBefore.title || diff.recordId}`
      : `change ${titleCase(diff.field)} from ${JSON.stringify(diff.before)} to ${JSON.stringify(diff.after)} on ${firstBefore.title || diff.recordId}`);
    intentSummary = `${parts.join("; ") || `Update metadata on ${targets.join(", ")}`}.`;
  } else if (operationType === "decision_resolution") {
    const selected = resolution?.custom || resolution?.selected || afterSnapshot?.customResolution || afterSnapshot?.selectedResolution || "selected resolution";
    title = `Resolve ${decisionId || targets[0]}: ${selected}`;
    intentSummary = `Resolve ${decisionId || targets[0]} by ${selected}.`;
    fieldDiffs = [
      ["decisionId", decisionId || afterSnapshot?.decisionId || targets[0]],
      ["selectedResolution", afterSnapshot?.selectedResolution || resolution?.selected],
      ["customResolution", afterSnapshot?.customResolution || resolution?.custom],
      ["affectedArchiveRecords", afterSnapshot?.affectedArchiveRecords || targets],
      ["affectedSourceFiles", afterSnapshot?.affectedSourceFiles || affectedSourceFiles],
      ["rewriteRequested", Boolean(rewritePlan)],
      ["sourceFilesChanged", Boolean(afterSnapshot?.sourceFilesChanged)],
      ["followUpTasksCreated", followUpTasks.length > 0 || Boolean(afterSnapshot?.followUpNeeded)],
    ].map(([field, after]) => ({ recordId:decisionId || targets[0], field, before:null, after, added:[], removed:[] }));
  } else if (operationType === "source_rewrite_request") {
    title = `Request source rewrite for ${decisionId || targets.join(", ")}`;
    intentSummary = `Request later review of ${affectedSourceFiles.length || asArray(afterSnapshot?.affectedSourceFiles).length} source file(s), without changing prose automatically.`;
  } else {
    title = `${titleCase(operationType)}: ${targets.join(", ")}`;
    intentSummary = `${title}.`;
  }
  const sourceFilesChanged = Boolean(afterSnapshot?.sourceFilesChanged);
  const sourceEffect = operationType === "decision_resolution"
    ? `Decision record only · Source prose ${sourceFilesChanged ? "changed" : "unchanged"}`
    : operationType === "source_rewrite_request"
      ? "Rewrite request only · Source prose unchanged"
      : "Metadata JSON only · Source prose unchanged";
  const canonicalEffect = operationType === "decision_resolution" && !sourceFilesChanged
    ? "Decision record may become canonical after PR merge and rebuild; canonical archive data and source prose remain unchanged until a separate patch is merged."
    : operationType === "source_rewrite_request"
      ? "Rewrite request may become canonical after PR merge; source prose remains unchanged until a later patch is merged."
      : "Metadata becomes canonical only after PR merge and Netlify rebuild.";
  return { title, intentSummary, fieldDiffs, sourceEffect, canonicalEffect, sourceFilesChanged, followUpTasksCreated: followUpTasks.length > 0, rewriteRequested: Boolean(rewritePlan) };
};

export const classifyOperation = (item = {}) => {
  const audit = item.audit || item.changeLogEntry || item;
  const review = item.reviewAudit || {};
  const raw = String(review.status || review.approvalMode || audit.reviewStatus || audit.approvalMode || audit.status || item.status || "").toLowerCase();
  const merged = Boolean(item.merged || item.prMerged || audit.mergeCommitSha || /auto-merged|^merged$/.test(raw));
  const closed = item.state === "closed" || raw === "closed";
  let bucket;
  let status;
  if (merged) { bucket = "completed"; status = "merged"; }
  else if (/reject/.test(raw) || (closed && !/approved/.test(raw))) { bucket = "rejected"; status = "rejected"; }
  else if (/fail/.test(raw) || item.mode === "failed") { bucket = "failed"; status = "failed"; }
  else if (/changes-requested/.test(raw)) { bucket = "changes-requested"; status = "changes-requested"; }
  else if (/admin-approved-pr|owner-approved-pr|editor-approved|approved-awaiting-merge|manual-merge-required|^approved$/.test(raw) && item.draft) { bucket = "review-required"; status = "approved-draft-not-ready"; }
  else if (/admin-approved-pr|owner-approved-pr|editor-approved|approved-awaiting-merge|manual-merge-required|^approved$/.test(raw)) { bucket = "needs-merge"; status = "approved-awaiting-merge"; }
  else if (/manual-review-required|owner-review-required|pending-owner-review|review-required|review-recommended|needs-review/.test(raw)) { bucket = "review-required"; status = "review-required"; }
  else if (/pending-admin-review|pending-approval|pull-request-staged/.test(raw) || (item.draft && audit.userRole === "contributor")) { bucket = "pending"; status = "pending-admin-review"; }
  else if (item.state === "open") { bucket = ["admin", "owner"].includes(audit.userRole) ? "needs-merge" : "pending"; status = bucket === "needs-merge" ? "approved-awaiting-merge" : "pending-admin-review"; }
  else { bucket = "completed"; status = raw || "audit-history"; }
  return { bucket, status, ownerAdminAction: ["admin", "owner"].includes(audit.userRole), activeApproval: ["pending", "review-required", "changes-requested"].includes(bucket) };
};

export const actionsForLifecycle = (bucket, status = "") => status === "approved-draft-not-ready" ? ["open-pr", "add-note"] : ({
  pending: ["approve", "reject", "request-changes", "needs-review", "escalate-owner", "open-pr"],
  "review-required": ["approve", "reject", "request-changes", "needs-review", "escalate-owner", "open-pr"],
  "changes-requested": ["approve", "reject", "needs-review", "add-note", "open-pr"],
  "needs-merge": ["merge", "open-pr", "revert", "add-note"],
  completed: ["open-pr", "revert", "add-note"],
  rejected: ["reopen", "add-note", "open-pr"],
  failed: ["retry", "open-diagnostics", "manual-task", "dismiss"],
}[bucket] || ["open-pr"]);
