export const operationPolicies = {
  artifact_metadata_update: {
    operationType: "artifact_metadata_update",
    riskLevel: "low",
    autoApproveAllowed: true,
    requiresRationale: false,
    requiresActor: true,
    maxBatchSize: 1,
    allowedFields: ["tags", "addTags", "removeTags", "notes", "type", "project", "archiveRecord", "relatedTask", "relatedProjects", "relatedArchiveRecords", "relatedTasks", "riskFlags", "lifecycleStage", "canonStatus", "rightsStatus", "reviewStatus"],
    blockedFields: [],
    requiresReviewIfTagsInclude: ["legal-review", "monetization", "paid-advancement", "cashout", "rake", "prize", "public", "private", "retired"],
    requiresReviewIfCanonStatusChanges: true,
    requiresReviewIfRightsStatusChanges: true,
    requiresReviewIfReviewStatusChanges: true,
    undoStrategy: "Create a revert request using the audit record's before snapshot.",
  },
  bulk_artifact_metadata_update: {
    operationType: "bulk_artifact_metadata_update",
    riskLevel: "medium",
    autoApproveAllowed: true,
    requiresRationale: true,
    requiresActor: true,
    maxBatchSize: 25,
    allowedFields: ["addTags", "removeTags", "project", "archiveRecord", "relatedTask", "lifecycleStage", "canonStatus", "rightsStatus", "reviewStatus"],
    blockedFields: [],
    requiresReviewIfTagsInclude: ["legal-review", "monetization", "paid-advancement", "cashout", "rake", "prize", "public", "private", "retired"],
    requiresReviewIfCanonStatusChanges: true,
    requiresReviewIfRightsStatusChanges: true,
    requiresReviewIfReviewStatusChanges: true,
    undoStrategy: "Create a revert request; inverse metadata is derived from per-record before snapshots.",
  },
  decision_resolution: {
    operationType: "decision_resolution", riskLevel: "low", autoApproveAllowed: false,
    requiresRationale: true, requiresActor: true, maxBatchSize: 25, allowedFields: [], blockedFields: ["sourceProse"],
    requiresReviewIfTagsInclude: [], requiresReviewIfCanonStatusChanges: true, requiresReviewIfRightsStatusChanges: true,
    undoStrategy: "Supersede through a new logged decision or create a structured revert request.",
  },
  source_rewrite_request: {
    operationType: "source_rewrite_request", riskLevel: "high", autoApproveAllowed: false,
    requiresRationale: true, requiresActor: true, maxBatchSize: 25, allowedFields: [], blockedFields: ["sourceContent"],
    requiresReviewIfTagsInclude: [], requiresReviewIfCanonStatusChanges: true, requiresReviewIfRightsStatusChanges: true,
    undoStrategy: "Close the review PR or supersede the rewrite request; source files are not changed by this operation.",
  },
  change_log_entry: {
    operationType: "change_log_entry", riskLevel: "low", autoApproveAllowed: true,
    requiresRationale: false, requiresActor: true, maxBatchSize: 25, allowedFields: [], blockedFields: [],
    requiresReviewIfTagsInclude: [], requiresReviewIfCanonStatusChanges: false, requiresReviewIfRightsStatusChanges: false,
    undoStrategy: "Append a correcting Change Log entry; audit history remains append-only.",
  },
  revert_operation: {
    operationType: "revert_operation", riskLevel: "high", autoApproveAllowed: false,
    requiresRationale: true, requiresActor: true, maxBatchSize: 1, allowedFields: [], blockedFields: [],
    requiresReviewIfTagsInclude: [], requiresReviewIfCanonStatusChanges: true, requiresReviewIfRightsStatusChanges: true,
    undoStrategy: "Review and merge the generated revert request PR; no inverse change is claimed automatically.",
  },
  review_action: {
    operationType:"review_action", riskLevel:"high", autoApproveAllowed:false,
    requiresRationale:true, requiresActor:true, maxBatchSize:1, allowedFields:[], blockedFields:[],
    requiresReviewIfTagsInclude:[], requiresReviewIfCanonStatusChanges:true, requiresReviewIfRightsStatusChanges:true,
    undoStrategy:"Review actions remain in the PR audit trail; merged changes use a revert_operation request.",
  },
};

const highRiskWords = /foundation[- ]canon|legal|monetization|cashout|rake|prize|wager|public[- ]os|source[- ]prose/i;

export const evaluateOperationPolicy = (draft) => {
  const base = operationPolicies[draft.operationType];
  if (!base) throw new Error(`No approval policy exists for ${draft.operationType}`);
  const changes = draft.changes || {};
  if (base.requiresRationale && !draft.rationale) throw new Error(`Rationale is required by the ${draft.operationType} policy`);
  const changedFields = Object.keys(changes).filter((key) => changes[key] !== undefined && changes[key] !== "" && (!Array.isArray(changes[key]) || changes[key].length));
  if (["artifact_metadata_update", "bulk_artifact_metadata_update"].includes(draft.operationType) && !changedFields.length) throw new Error("No artifact metadata changes were supplied");
  const unknownFields = changedFields.filter((key) => base.allowedFields.length && !base.allowedFields.includes(key));
  const blockedFields = changedFields.filter((key) => base.blockedFields.includes(key));
  if (unknownFields.length) throw new Error(`Policy does not allow fields: ${unknownFields.join(", ")}`);
  if (blockedFields.length) throw new Error(`Policy blocks fields: ${blockedFields.join(", ")}`);

  let riskLevel = base.riskLevel;
  const reasons = [];
  const tags = [...(changes.tags || []), ...(changes.addTags || []), ...(changes.riskFlags || [])];
  if (tags.some((tag) => base.requiresReviewIfTagsInclude.includes(String(tag).toLowerCase()))) {
    riskLevel = "high";
    reasons.push("Sensitive governance tag requires review");
  }
  if (base.requiresReviewIfCanonStatusChanges && changes.canonStatus !== undefined) {
    riskLevel = changes.canonStatus === "foundation-canon" ? "high" : riskLevel === "low" ? "medium" : riskLevel;
    reasons.push("Canon status change");
  }
  if (base.requiresReviewIfRightsStatusChanges && changes.rightsStatus !== undefined) {
    riskLevel = riskLevel === "low" ? "medium" : riskLevel;
    reasons.push("Rights status change");
  }
  if (base.requiresReviewIfReviewStatusChanges && changes.reviewStatus !== undefined) {
    riskLevel = riskLevel === "low" ? "medium" : riskLevel;
    reasons.push("Review status change");
  }
  if (/retired|published|public|private/i.test(String(changes.lifecycleStage || ""))) {
    riskLevel = riskLevel === "low" ? "medium" : riskLevel;
    reasons.push("Lifecycle visibility or retirement change");
  }
  if (draft.operationType === "decision_resolution" && (draft.criticalDecision || draft.rewritePlan || (draft.affectedSourceFiles || []).length || /foundation|canon decision|legal|monetization|public publish/i.test(String(draft.workType || "")))) {
    riskLevel = "high";
    reasons.push(draft.criticalDecision ? "Critical decision resolution requires review" : draft.rewritePlan ? "Source rewrite request requires review" : "Canon, legal, publication, or source impact requires review");
  }
  if (draft.targets.length > 10 || highRiskWords.test(JSON.stringify({ changes, title: draft.title, sourceImpact: draft.sourceImpact }))) {
    riskLevel = "high";
    reasons.push(draft.targets.length > 10 ? "Operation affects many records" : "High-risk subject matter detected");
  }
  const autoApproveAllowed = base.autoApproveAllowed && riskLevel !== "high" && (riskLevel !== "medium" || draft.explicitConfirmation === true);
  return {
    ...base,
    riskLevel,
    autoApproveAllowed,
    changedFields,
    reasons,
    explicitConfirmation: draft.explicitConfirmation === true,
    validationPassed: true,
  };
};
