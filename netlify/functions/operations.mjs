import { timingSafeEqual } from "node:crypto";
import { GitHubAdapter, githubConfigStatus } from "./lib/github-adapter.mjs";
import { buildGitWritePlan, createOperationDraft, supportedOperationTypes, validateOperationPayload } from "./lib/operation-planner.mjs";
import { evaluateOperationPolicy } from "../../src/data/operation-policies.mjs";
import { resolveIdentity, roleAuthority } from "./lib/identity.mjs";
import { actionsForLifecycle, buildOperationPresentation, classifyOperation } from "../../src/data/operation-lifecycle.mjs";

const headers = {
  "content-type": "application/json",
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type, authorization, x-creative-os-key",
  "access-control-allow-methods": "POST, OPTIONS",
};
const json = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });
const truthy = (value) => /^(1|true|yes|on)$/i.test(String(value || ""));

const adminKeyStatus = (submitted, env = process.env) => {
  const configured = Boolean(env.OPERATIONS_ADMIN_KEY);
  if (!configured) return { configured: false, accepted: false, reason: "Operations key not configured on server." };
  if (!submitted) return { configured: true, accepted: false, reason: "Operations admin key missing or invalid" };
  const expected = Buffer.from(env.OPERATIONS_ADMIN_KEY);
  const actual = Buffer.from(submitted);
  const accepted = expected.length === actual.length && timingSafeEqual(expected, actual);
  return { configured: true, accepted, reason: accepted ? null : "Operations admin key missing or invalid" };
};

const diagnostics = (overrides = {}) => ({
  apiReached: true,
  githubConfigured: false,
  githubWriteAttempted: false,
  branchCreated: false,
  commitCreated: false,
  prCreated: false,
  fallbackUsed: false,
  fallbackReason: null,
  errorMessage: null,
  ...overrides,
});

const reviewAuditFile = ({ draft, identity, pull, status }) => {
  const path = `src/content/change-log/${draft.token}-review-${draft.operationId}.json`;
  const record = {
    id:`change.review.${draft.operationId}`, operationId:draft.operationId, operationType:"review_action", actionType:"review_action",
    title:`${draft.reviewAction} PR #${pull.number}`, summary:`${identity.userRole} ${draft.reviewAction} on PR #${pull.number}`,
    submittedBy:identity.userName, person:identity.userName, actor:identity.userName, timestamp:draft.timestamp,
    affectedRecords:draft.targets, affectedFiles:[], affectedExports:[], status, notes:draft.rationale, reason:draft.rationale,
    sourceImpact:["review-action"], relatedDecision:null, pullRequestUrl:pull.html_url, sourceFilesChanged:false,
    authenticated:true, userId:identity.userId, userEmail:identity.userEmail, userName:identity.userName, userRole:identity.userRole,
    authMethod:identity.authMethod, adminKeyAccepted:false, riskLevel:"high", approvalMode:status,
    beforeSnapshot:draft.originalAudit || {}, afterSnapshot:{ reviewAction:draft.reviewAction, adminNote:draft.adminNote || "" },
    commitSha:null, mergeCommitSha:null, undoInstructions:`Review PR #${pull.number}; merged changes require a revert_operation request.`,
    revertBranchName:null, revertRequestId:null, validationResult:{passed:true}, policyResult:draft.policyResult,
    originalSubmitter:draft.originalSubmitter || null,
  };
  return { path, content:`${JSON.stringify(record,null,2)}\n`, record };
};

const executeReviewAction = async ({ adapter, draft, identity }) => {
  const pull = await adapter.getPullRequest(Number(draft.pullRequestNumber));
  if (!pull?.head?.ref?.startsWith("creative-os/")) throw new Error("Legacy review API can act only on Creative OS operation PRs");
  if (draft.reviewAction === "merge" && pull.draft) {
    return {
      accepted:false, committed:false, mode:"failed", authenticated:true, userId:identity.userId, userEmail:identity.userEmail,
      userName:identity.userName, userRole:identity.userRole, adminKeyAccepted:false, riskLevel:"high",
      approvalMode:"draft-pr-not-ready", githubWriteAttempted:false, branchCreated:false, commitCreated:false,
      prCreated:false, prExists:true, prDraft:true, prMerged:false, pullRequestUrl:pull.html_url, pullRequestNumber:pull.number,
      fallbackUsed:false, fallbackReason:"PR is draft; manual merge unavailable until marked ready.",
      error:"PR is draft; manual merge unavailable until marked ready.", auditRecordPath:null,
      undoInstructions:`Open PR #${pull.number}, complete review, and mark it ready before merging.`,
      message:"PR is draft; manual merge unavailable until marked ready.",
      diagnostics:diagnostics({githubConfigured:true,githubWriteAttempted:false,errorMessage:"PR is draft; manual merge unavailable until marked ready."}),
    };
  }
  const statusMap = { approve:"approved", reject:"rejected", "request-changes":"changes-requested", "needs-review":"needs-review", merge:"merged", "add-note":draft.currentStatus || "needs-review", "escalate-owner":"pending-owner-review", reopen:"pending-admin-review" };
  const audit = reviewAuditFile({ draft, identity, pull, status:statusMap[draft.reviewAction] });
  const auditCommit = await adapter.appendFilesToBranch({ branch:pull.head.ref, files:[{path:audit.path,content:audit.content}], message:`Creative OS review: ${draft.reviewAction} by ${identity.userName}` });
  const note = [`Creative OS ${draft.reviewAction} by ${identity.userName} (${identity.userRole}).`, draft.rationale, draft.adminNote].filter(Boolean).join("\n\n");
  let merge = null;
  if (draft.reviewAction === "merge") merge = await adapter.mergePullRequest({ number:pull.number, expectedHeadSha:auditCommit.commitSha });
  else {
    await adapter.addPullRequestComment(pull.number, note);
    if (draft.reviewAction === "reject") await adapter.closePullRequest(pull.number);
    if (draft.reviewAction === "reopen") await adapter.reopenPullRequest(pull.number);
  }
  return {
    accepted:true, committed:true, mode:"github-pr", authenticated:true, userId:identity.userId, userEmail:identity.userEmail,
    userName:identity.userName, userRole:identity.userRole, adminKeyAccepted:false, riskLevel:"high",
    approvalMode:statusMap[draft.reviewAction], policyResult:draft.policyResult, githubWriteAttempted:true,
    branchCreated:false, commitCreated:true, prCreated:false, prMerged:Boolean(merge?.merged), pullRequestUrl:pull.html_url,
    commitSha:auditCommit.commitSha, mergeCommitSha:merge?.sha || null, fallbackUsed:false, fallbackReason:null,
    auditRecordPath:audit.path, undoInstructions:audit.record.undoInstructions, reviewStatus:statusMap[draft.reviewAction],
    message:merge?.merged ? "Operation approved and merged; review action logged." : `Review action “${draft.reviewAction}” logged on the operation PR.`,
    diagnostics:diagnostics({githubConfigured:true,githubWriteAttempted:true,commitCreated:true,prCreated:false,fallbackUsed:false}),
    changeLogEntry:audit.record,
  };
};

const localResponse = ({ draft, github, admin, identity, fallbackReason, policyResult = null, errorMessage = null }) => {
  const auditRecordPath = `src/content/change-log/${draft.token}-${draft.operationId}.json`;
  const changeLogEntry = {
    id: `change.${draft.operationId}`, operationId: draft.operationId, operationType: draft.operationType,
    actionType: draft.operationType, title: draft.title, summary: draft.title, submittedBy: draft.submittedBy,
    person: draft.submittedBy, actor: draft.submittedBy, adminKeyAccepted: admin.accepted, timestamp: draft.timestamp,
    reason: draft.rationale || draft.reason || "", affectedRecords: draft.targets, affectedFiles: draft.affectedFiles || [],
    affectedExports: draft.affectedExports, status: "local-draft", approvalMode: "local-draft", riskLevel: policyResult?.riskLevel || "unknown",
    pullRequestUrl: null, commitSha: null, mergeCommitSha: null, sourceFilesChanged: false,
    undoInstructions: policyResult?.undoStrategy || "Discard this local draft; no repository change exists to revert.",
    notes: draft.rationale || draft.reason || "", sourceImpact: draft.sourceImpact || [], relatedDecision: draft.decisionId || null,
    validationResult: { passed: true }, policyResult,
    userId: identity?.userId || null, userEmail: identity?.userEmail || null, userName: identity?.userName || null,
    userRole: identity?.userRole || "viewer", authenticated: Boolean(identity?.authenticated), authMethod: identity?.authMethod || "none",
  };
  const decisionResolution = draft.operationType === "decision_resolution" ? {
    id: `resolution.${draft.decisionId.toLowerCase()}.${draft.token}`, decisionId: draft.decisionId,
    selectedResolution: draft.resolution.selected, customResolution: draft.resolution.custom || "",
    rationale: draft.rationale, submittedBy: draft.submittedBy, timestamp: draft.timestamp,
    affectedArchiveRecords: draft.affectedArchiveRecords || draft.targets,
    affectedSourceFiles: draft.affectedSourceFiles || draft.affectedFiles || [], affectedExports: draft.affectedExports,
    followUpNeeded: Boolean(draft.followUpNeeded ?? draft.followUp?.length), followUpTasks: draft.followUpTasks || draft.followUp || [],
    statusBefore: draft.statusBefore || "open", statusAfter: draft.statusAfter || "proposed-resolution",
    sourceFilesChanged: false, createdPullRequestUrl: null, status: "local-draft",
  } : null;
  const sourceRewritePlan = draft.rewritePlan ? {
    decisionId: draft.decisionId || null, affectedFiles: draft.affectedSourceFiles || draft.affectedFiles || [],
    proposedStructuredWork: draft.rewritePlan.automatic || null, humanReviewBoundary: draft.rewritePlan.humanReview || null,
    preserveRawSources: draft.rewritePlan.preserveRawSources !== false, status: "local-draft", sourceFilesChanged: false,
  } : null;
  return {
    accepted: true,
    committed: false,
    mode: "local-draft",
    persistence: "browser-local-draft",
    githubConfigured: github.configured,
    gitConfigured: github.configured,
    adminKeyAccepted: admin.accepted,
    adminKeyConfigured: admin.configured,
    authenticated: Boolean(identity?.authenticated), userId: identity?.userId || null, userEmail: identity?.userEmail || null,
    userName: identity?.userName || null, userRole: identity?.userRole || "viewer", authMethod: identity?.authMethod || "none",
    operationId: draft.operationId,
    riskLevel:policyResult?.riskLevel || "unknown",
    approvalMode:"local-draft",
    branchName: null,
    commitSha: null,
    mergeCommitSha: null,
    pullRequestUrl: null,
    filesWritten: [],
    sourceFilesChanged: false,
    auditRecordPath,
    fallbackReason,
    githubWriteAttempted:false, branchCreated:false, commitCreated:false, prCreated:false, prMerged:false, fallbackUsed:true,
    undoInstructions: changeLogEntry.undoInstructions,
    message: `${fallbackReason}. Local draft saved; no repository files changed.`,
    diagnostics: diagnostics({ githubConfigured: github.configured, fallbackUsed: true, fallbackReason, errorMessage }),
    changeLogEntry,
    decisionResolution,
    sourceRewritePlan,
    proposedChanges: draft.targets.map((target) => ({ target, operation: draft.operationType, after: draft.changes || draft.resolution || null })),
    policyResult,
    exportsNeedRegeneration: draft.affectedExports.length > 0,
    affectedExports: draft.affectedExports,
    followUp: draft.followUpTasks || draft.followUp || [],
  };
};

const handleEvent = async (request, context = {}) => {
  if (request.httpMethod === "OPTIONS") return json(204, {});
  if (request.httpMethod === "GET") {
    const github = githubConfigStatus();
    const view = request.queryStringParameters?.view || (request.rawUrl ? new URL(request.rawUrl).searchParams.get("view") : null);
    const identity = await resolveIdentity(request, context);
    if (view === "reviews") {
      if (!identity.authenticated) return json(401,{ok:false,error:"Sign in to open the legacy review queue.",authenticated:false,userRole:"viewer"});
      if (!["admin","owner"].includes(identity.userRole)) return json(403,{ok:false,error:"Legacy review queue access requires an admin or owner.",authenticated:true,userRole:identity.userRole});
      if (!github.configured) return json(503,{ok:false,error:`GitHub adapter not configured. Missing: ${github.missing.join(", ")}`});
      try {
        const items = await new GitHubAdapter().listOperationReviews();
        const presented = items.map((item) => {
          const lifecycle = classifyOperation(item);
          const presentation = item.audit?.intentSummary ? {
            title:item.audit.title, intentSummary:item.audit.intentSummary, fieldDiffs:item.audit.fieldDiffs || [], sourceEffect:item.audit.sourceEffect || "Audit record", canonicalEffect:item.audit.canonicalEffect || "Canonical state depends on merge and rebuild.",
          } : buildOperationPresentation({ ...(item.audit || {}), beforeSnapshot:item.audit?.beforeSnapshot || {}, afterSnapshot:item.audit?.afterSnapshot || {} });
          return { ...item, lifecycle, actions:actionsForLifecycle(lifecycle.bucket, lifecycle.status), presentation };
        });
        return json(200,{ok:true,authenticated:true,...identity,items:presented,queueDiagnostics:{
          githubQueueLoaded:true, githubConfigured:true, pendingPullRequests:presented.filter((item)=>item.lifecycle.activeApproval).length,
          reviewRecords:presented.filter((item)=>item.reviewAudit).length,
          changelogRecords:presented.filter((item)=>item.audit).length, errors:[],
        }});
      }
      catch(error){return json(502,{ok:false,error:error.message,authenticated:true,...identity});}
    }
    return json(200, {
      ok: true,
      mode: "api-staged",
      endpoint: "/api/operations",
      githubConfigured: github.configured,
      adminKeyConfigured: Boolean(process.env.OPERATIONS_ADMIN_KEY),
      adminAutoApproveConfigured: truthy(process.env.ADMIN_AUTO_APPROVE),
      identityEnabled: true,
      operationsEndpointConfigured: true,
      adminPortalRouteExists: true,
      authenticated:identity.authenticated,
      userRole:identity.userRole,
      defaultBranch: process.env.GITHUB_DEFAULT_BRANCH || null,
      deployedBranch: process.env.BRANCH || process.env.HEAD || process.env.GITHUB_DEFAULT_BRANCH || null,
      deployId: process.env.DEPLOY_ID || null,
      commitRef: process.env.COMMIT_REF || null,
      diagnostics: diagnostics({ githubConfigured: github.configured }),
    });
  }
  if (request.httpMethod !== "POST") return json(405, { mode: "failed", error: "POST required", diagnostics: diagnostics({ errorMessage: "POST required" }) });

  let payload;
  try { payload = JSON.parse(request.body || "{}"); }
  catch { return json(400, { mode: "failed", error: "Invalid JSON body", diagnostics: diagnostics({ errorMessage: "Invalid JSON body" }) }); }

  let draft;
  let policyResult;
  try {
    draft = createOperationDraft(validateOperationPayload(payload));
    policyResult = evaluateOperationPolicy(draft);
  } catch (error) {
    return json(400, { mode: "failed", error: error.message, supportedOperationTypes, diagnostics: diagnostics({ errorMessage: error.message }) });
  }

  const github = githubConfigStatus();
  const submittedKey = request.headers?.["x-creative-os-key"] || request.headers?.["X-Creative-Os-Key"] || request.headers?.["X-CREATIVE-OS-KEY"];
  const admin = adminKeyStatus(submittedKey);
  const resolvedIdentity = await resolveIdentity(request, context);
  const emergencyFallback = !resolvedIdentity.authenticated && truthy(process.env.OPERATIONS_ADMIN_KEY_FALLBACK) && admin.accepted;
  const identity = emergencyFallback ? {
    authenticated:false, userId:"emergency-admin-key", userEmail:null, userName:"Emergency administrator",
    userRole:"admin", authMethod:"emergency-admin-key",
  } : resolvedIdentity;
  if (!resolvedIdentity.authenticated && !emergencyFallback) {
    const reason = resolvedIdentity.authMethod === "identity-unavailable" ? "Employee authentication is unavailable. Sign in again or contact an owner." : "Sign in with an employee account to submit operations.";
    return json(401, { ...localResponse({ draft, github, admin, identity, fallbackReason:reason, policyResult }), accepted:false, message:`${reason} A local draft was retained.` });
  }
  if (!github.configured) {
    const reason = `GitHub adapter not configured. Missing: ${github.missing.join(", ")}`;
    return json(202, localResponse({ draft, github, admin, identity, fallbackReason: reason, policyResult }));
  }

  const autoApproveConfigured = truthy(process.env.ADMIN_AUTO_APPROVE);
  const authority = roleAuthority({ identity, operationType:draft.operationType, riskLevel:policyResult.riskLevel, explicitConfirmation:draft.explicitConfirmation, autoApproveConfigured:autoApproveConfigured && policyResult.autoApproveAllowed });
  if (!authority.allowed) return json(403, { ...localResponse({ draft, github, admin, identity, fallbackReason:authority.reason, policyResult }), accepted:false, message:`${authority.reason} A local draft was retained.` });
  const autoApproveEligible = Boolean(authority.autoMerge && policyResult.autoApproveAllowed);
  const approvalMode = authority.approvalMode;
  const stagedApprovalMode = autoApproveEligible ? `${identity.userRole}-approved-pr` : approvalMode;
  draft = { ...draft, submittedBy:identity.userName || draft.submittedBy, adminKeyAccepted: emergencyFallback, policyResult:{...policyResult,roleAuthority:authority}, approvalMode:stagedApprovalMode, ...identity };

  if (draft.operationType === "review_action") {
    try { const result = await executeReviewAction({adapter:new GitHubAdapter(),draft,identity}); return json(result.accepted ? 200 : 409, result); }
    catch(error){return json(502,{accepted:false,mode:"failed",authenticated:true,...identity,error:error.message,fallbackUsed:false,fallbackReason:error.message,diagnostics:diagnostics({githubConfigured:true,githubWriteAttempted:true,errorMessage:error.message})});}
  }

  try {
    const adapter = new GitHubAdapter();
    const plan = await buildGitWritePlan(draft, { readJson: (path) => adapter.readJson(path) });
    const git = await adapter.stageOperation({
      operationId: draft.operationId,
      riskLevel:policyResult.riskLevel,
      approvalMode:stagedApprovalMode,
      title: `[Creative OS/${policyResult.riskLevel}] ${draft.title}`,
      body: [
        `Operation: ${draft.operationType}`,
        `Submitted by: ${draft.submittedBy}`,
        `Operation ID: ${draft.operationId}`,
        `Risk: ${policyResult.riskLevel}`,
        `Approval mode: ${stagedApprovalMode}`,
        "",
        draft.rationale || draft.reason || "No additional rationale supplied.",
        "",
        policyResult.riskLevel === "high" ? "Manual review recommended before merge." : "Review the audit record and proposed metadata before merge.",
        "Exports regenerate after merge/rebuild; this function does not run the Astro build.",
      ].join("\n"),
      files: plan.files,
      finalizeFiles: plan.finalizeFiles,
      draft: autoApproveEligible ? false : authority.draft,
    });

    let merge = null;
    let mergeError = null;
    if (autoApproveEligible && git.pullRequestStatus === "draft") {
      mergeError = "PR is draft; manual merge unavailable until marked ready.";
    } else if (autoApproveEligible) {
      try {
        merge = await adapter.mergePullRequest({ number: git.pullRequestNumber, expectedHeadSha: git.commitSha });
        if (!merge?.merged) mergeError = merge?.message || "GitHub did not merge the auto-approved PR.";
      } catch (error) {
        mergeError = error.message;
      }
    }
    const merged = Boolean(merge?.merged);
    const effectiveApprovalMode = merged ? approvalMode : autoApproveEligible && git.pullRequestStatus === "draft" ? "draft-pr-not-ready" : stagedApprovalMode;
    const mode = merged ? approvalMode : "github-pr";
    const pullRequestUrl = git.pullRequestUrl;
    const undoInstructions = merged
      ? `Create a revert_operation request for ${draft.operationId} or revert merge commit ${merge.sha} through a new reviewed PR.`
      : `Close this PR to discard it, or submit revert_operation for ${draft.operationId} after merge.`;
    const changeLogEntry = {
      ...plan.changeLogEntry,
      status: merged ? "merged" : "pull-request-open",
      approvalMode:effectiveApprovalMode,
      pullRequestUrl,
      commitSha: git.commitSha,
      mergeCommitSha: merge?.sha || null,
      undoInstructions,
    };
    return json(201, {
      accepted: true,
      committed: true,
      mode,
      persistence: merged ? "github-auto-approved" : "git-pull-request",
      githubConfigured: true,
      gitConfigured: true,
      authenticated: Boolean(identity.authenticated),
      userId: identity.userId,
      userEmail: identity.userEmail,
      userName: identity.userName,
      userRole: identity.userRole,
      authMethod: identity.authMethod,
      adminKeyAccepted: emergencyFallback,
      adminKeyConfigured: true,
      operationId: draft.operationId,
      riskLevel:policyResult.riskLevel,
      approvalMode:effectiveApprovalMode,
      branchName: git.branch,
      branch: git.branch,
      commitSha: git.commitSha,
      mergeCommitSha: merge?.sha || null,
      pullRequestUrl,
      pullRequestNumber: git.pullRequestNumber,
      pullRequestStatus: merged ? "merged" : git.pullRequestStatus,
      prMerged: merged,
      githubWriteAttempted:true,
      branchCreated:true,
      commitCreated:true,
      prCreated:true,
      fallbackUsed:false,
      filesWritten: git.changedFiles,
      changedFiles: git.changedFiles,
      sourceFilesChanged: false,
      auditRecordPath: plan.auditRecordPath,
      fallbackReason: null,
      undoInstructions,
      message: merged
        ? `${identity.userRole === "owner" ? "Owner" : "Admin"} approved and merged this low-risk operation through its audited pull request.`
        : git.pullRequestStatus === "draft" && autoApproveEligible
          ? "PR is draft; manual merge unavailable until marked ready. No merge was attempted."
        : autoApproveEligible && mergeError
          ? `${identity.userRole === "owner" ? "Owner" : "Admin"} approved — PR created. Manual merge required.`
          : policyResult.riskLevel === "high"
            ? "Operation staged in a draft PR. Manual review recommended before merge."
            : authority.reason,
      diagnostics: diagnostics({ githubConfigured: true, ...git.progress, fallbackUsed: false, errorMessage: mergeError }),
      changeLogEntry,
      decisionResolution: plan.decisionResolution ? { ...plan.decisionResolution, createdPullRequestUrl: pullRequestUrl } : null,
      sourceRewritePlan: plan.sourceRewriteRequest ? { ...plan.sourceRewriteRequest, createdPullRequestUrl: pullRequestUrl } : null,
      revertRequest: plan.revertRequest ? { ...plan.revertRequest, createdPullRequestUrl: pullRequestUrl } : null,
      policyResult: {...policyResult,roleAuthority:authority},
      autoApproveConfigured,
      autoApproveEligible,
      exportsNeedRegeneration: draft.affectedExports.length > 0,
      affectedExports: draft.affectedExports,
      stillNeedsReview: policyResult.riskLevel === "high" ? policyResult.reasons.length ? policyResult.reasons : ["High-risk operation"] : [],
      followUp: draft.followUpTasks || draft.followUp || [],
    });
  } catch (error) {
    const progress = error.githubProgress || {};
    const fallbackReason = error.message || "GitHub writeback failed";
    return json(error.status && error.status < 500 ? 409 : 502, {
      ...localResponse({ draft, github, admin, identity, fallbackReason, policyResult, errorMessage: fallbackReason }),
      accepted: false,
      mode: "failed",
      persistence: "git-write-failed",
      message: "GitHub writeback failed. A browser-local draft was retained; production was not changed.",
      diagnostics: diagnostics({ githubConfigured: true, githubWriteAttempted: true, ...progress, fallbackUsed: true, fallbackReason, errorMessage: fallbackReason }),
    });
  }
};

export const handler = handleEvent;

export default async (request, context = {}) => {
  if (request?.method && typeof request.text === "function") {
    const result = await handleEvent({
      httpMethod: request.method,
      body: await request.text(),
      headers: Object.fromEntries(request.headers.entries()), rawUrl:request.url,
    }, context);
    return new Response(result.body || null, { status: result.statusCode, headers: result.headers });
  }
  return handleEvent(request, context);
};
