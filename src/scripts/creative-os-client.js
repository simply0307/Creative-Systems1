import { createClient } from "@supabase/supabase-js";
import { effectiveArtifactType, filterArtifacts, normalizeArtifactFilters } from "../lib/artifact-filters.mjs";

const authHeaders = async () => {
  await window.CreativeAccount?.ready;
  return window.CreativeAccount?.authHeaders?.() || {};
};

const request = async (path, options = {}) => {
  const response = await fetch(`/api/creative-os/${path.replace(/^\//, "")}`, {
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : { "content-type": "application/json" }),
      ...(await authHeaders()),
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); }
  catch { body = { ok: false, error: text || `Creative OS API returned HTTP ${response.status}.` }; }
  body.httpStatus = response.status;
  if (!response.ok) throw Object.assign(new Error(body.error || `Creative OS API returned HTTP ${response.status}.`), { response: body, status: response.status });
  return body;
};

const stateLabel = (result = {}) => {
  if (result.mode === "failed" || result.accepted === false || result.ok === false) return "Failed";
  if (result.mode === "pending-review" || result.approvalMode === "pending-review") return "Pending admin review";
  if (result.mode === "database-applied" || result.databaseWriteApplied) return "Live in Creative OS";
  if (result.mode === "review-resolved") return "Review resolved";
  return "Saved";
};

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]);

const renderStatus = (element, result) => {
  if (!element) return;
  const label = stateLabel(result);
  element.textContent = `${label}. ${result.message || result.error || "Response received."}`;
  let panel = element.parentElement?.querySelector(".operations-diagnostics");
  if (!panel) {
    panel = document.createElement("details");
    panel.className = "operations-diagnostics";
    element.parentElement?.append(panel);
  }
  const rows = [
    ["Current state", label],
    ["Authenticated", result.authenticated],
    ["Operator", result.userName],
    ["Role", result.userRole],
    ["Risk level", result.riskLevel],
    ["Approval mode", result.approvalMode],
    ["Database configured", result.databaseConfigured],
    ["Database write attempted", result.databaseWriteAttempted],
    ["Database write applied", result.databaseWriteApplied],
    ["Review request", result.reviewRequestId],
    ["Audit event", result.auditEventId],
    ["GitHub write attempted", result.githubWriteAttempted],
    ["Canonical effect", result.canonicalEffect],
    ["Source effect", result.sourceEffect],
    ["Error", result.error],
  ].filter(([, value]) => value !== undefined && value !== null && value !== "");
  panel.innerHTML = `<summary>Operation diagnostics</summary><dl>${rows.map(([name, value]) => `<dt>${escapeHtml(name)}</dt><dd>${escapeHtml(typeof value === "boolean" ? (value ? "yes" : "no") : value)}</dd>`).join("")}</dl>`;
  if (result.error || result.mode === "failed") panel.open = true;
};

const sha256 = async (file) => {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

const uploadArtifact = async (file, metadata = {}, onState = () => {}) => {
  onState("Computing checksum · 5%");
  const checksumSha256 = await sha256(file);
  const relativePath = metadata.relativePath || file.webkitRelativePath || file.name;
  onState("Checking existing records · 15%");
  const signed = await request("uploads/sign", { method: "POST", body: JSON.stringify({ fileName: file.name, fileSize: file.size, mimeType: file.type, checksumSha256, relativePath }) });
  if (signed.duplicate) {
    onState("Duplicate already stored · 100%");
    return { ...signed, mode: "database-applied", databaseWriteApplied: false, duplicate: true, matchedExistingArtifact: true };
  }
  const client = createClient(signed.supabase.url, signed.supabase.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  onState("Uploading to private Storage · 55%");
  const upload = await client.storage.from(signed.upload.bucket).uploadToSignedUrl(signed.upload.path, signed.upload.token, file, { contentType: file.type || "application/octet-stream" });
  if (upload.error) throw upload.error;
  onState(signed.matchedArtifactId ? "Connecting to known metadata · 85%" : "Creating artifact record · 85%");
  const result = await request("uploads/complete", { method: "POST", body: JSON.stringify({ ...metadata, storagePath: signed.upload.path, originalFileName: file.name, mimeType: file.type || "application/octet-stream", fileSize: file.size, checksumSha256, relativePath, matchedArtifactId: signed.matchedArtifactId, matchedBy: signed.matchedBy }) });
  onState("Complete · 100%");
  return result;
};

const failedResult = (error) => ({
  ...(error.response || {}),
  ok: false,
  accepted: false,
  mode: "failed",
  databaseWriteApplied: false,
  githubWriteAttempted: false,
  error: error.message || "Creative OS operation failed.",
  message: error.message || "Creative OS operation failed.",
});

const submit = async (payload) => {
  try {
    const operationType = payload.operationType || payload.action;
    if (["decision_resolution", "decision.resolve", "source_rewrite_request", "rewrite.plan"].includes(operationType)) {
      return await request(`decisions/${encodeURIComponent(payload.decisionId)}/resolutions`, { method: "POST", body: JSON.stringify({
        selectedResolution: payload.resolution?.selected,
        customResolution: payload.resolution?.custom,
        rationale: payload.rationale || payload.reason,
        applicationType: ["source_rewrite_request", "rewrite.plan"].includes(operationType) || payload.rewritePlan ? "rewrite_request" : payload.affectedArchiveRecords?.length ? "structured_update" : "record_only",
        rewriteRequested: Boolean(payload.rewritePlan),
        affectedRecords: payload.affectedArchiveRecords || payload.targets,
        affectedFiles: payload.affectedSourceFiles || payload.affectedFiles,
        followUpTasks: payload.followUpTasks || payload.followUp,
        canonStatusResult: payload.canonStatusResult,
        reviewStatusResult: payload.reviewStatusResult,
        criticalDecision: payload.criticalDecision,
        workType: payload.workType,
      }) });
    }
    if (["export.regenerate", "change_log_entry"].includes(operationType) && payload.affectedExports?.length) {
      return await request("exports", { method: "POST", body: JSON.stringify({ exportType: "full-creative-os", title: payload.summary || "Full Creative OS", reason: payload.reason }) });
    }
    if (["artifact_metadata_update", "metadata.update", "bulk_artifact_metadata_update", "metadata.bulk-update"].includes(operationType)) {
      const targets = payload.targets || [];
      const changes = payload.changes || {};
      const outputs = [];
      for (const artifactId of targets) {
        if (changes.addTags?.length || changes.removeTags?.length || changes.tags?.length) outputs.push(await request(`artifacts/${encodeURIComponent(artifactId)}/tags`, { method: "POST", body: JSON.stringify({ addTags: changes.addTags || changes.tags || [], removeTags: changes.removeTags || [], reason: payload.reason }) }));
        if (changes.addCategories?.length || changes.removeCategories?.length) outputs.push(await request(`artifacts/${encodeURIComponent(artifactId)}/categories`, { method: "POST", body: JSON.stringify({ addCategories: changes.addCategories || [], removeCategories: changes.removeCategories || [], reason: payload.reason }) }));
        const metadata = Object.fromEntries(Object.entries(changes).filter(([key]) => !["addTags", "removeTags", "tags", "addCategories", "removeCategories"].includes(key)));
        if (Object.keys(metadata).length) outputs.push(await request(`artifacts/${encodeURIComponent(artifactId)}`, { method: "PATCH", body: JSON.stringify({ changes: metadata, reason: payload.reason }) }));
      }
      const latest = outputs.at(-1) || { ok: false, accepted: false, mode: "failed", error: "No database change was supplied." };
      return { ...latest, results: outputs, message: outputs.length > 1 ? `${outputs.length} database operations completed. ${latest.message || ""}` : latest.message };
    }
    throw new Error(`Operation “${operationType}” has not been migrated to the Supabase workflow. No GitHub PR or database change was created.`);
  } catch (error) {
    return failedResult(error);
  }
};

window.CreativeDatabase = {
  request,
  listArtifacts: (filters = {}) => {
    const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value !== undefined && value !== null && value !== ""));
    return request(`artifacts${query.size ? `?${query}` : ""}`);
  },
  organizationOptions: () => request("organization/options"),
  createControlledValue: (kind, payload) => request(`controlled-values/${kind}`, { method: "POST", body: JSON.stringify(payload) }),
  updateControlledValue: (kind, valueId, payload) => request(`controlled-values/${kind}/${valueId}`, { method: "PATCH", body: JSON.stringify(payload) }),
  listReviews: () => request("review-requests"),
  listExports: () => request("exports"),
  importStatus: () => request("imports/status"),
  importRepoMetadata: () => request("imports/repo-metadata", { method: "POST", body: "{}" }),
  importArchiveFolderIndex: () => request("imports/archive-folder", { method: "POST", body: "{}" }),
  createFolder: (path, reason) => request("folders", { method: "POST", body: JSON.stringify({ path, reason }) }),
  createImportBatch: (payload) => request("import-batches", { method: "POST", body: JSON.stringify(payload) }),
  updateImportFile: (batchId, payload) => request(`import-batches/${batchId}/files`, { method: "PATCH", body: JSON.stringify(payload) }),
  completeImportBatch: (batchId) => request(`import-batches/${batchId}/complete`, { method: "POST", body: "{}" }),
  uploadArtifact,
  addTags: (artifactId, addTags, removeTags, reason) => request(`artifacts/${encodeURIComponent(artifactId)}/tags`, { method: "POST", body: JSON.stringify({ addTags, removeTags, reason }) }),
  addCategories: (artifactId, addCategories, removeCategories, reason) => request(`artifacts/${encodeURIComponent(artifactId)}/categories`, { method: "POST", body: JSON.stringify({ addCategories, removeCategories, reason }) }),
  moveArtifact: (artifactId, folderPath, reason) => request(`artifacts/${encodeURIComponent(artifactId)}/move`, { method: "POST", body: JSON.stringify({ folderPath, reason }) }),
  updateArtifact: (artifactId, changes, reason) => request(`artifacts/${encodeURIComponent(artifactId)}`, { method: "PATCH", body: JSON.stringify({ changes, reason }) }),
  organizeArtifact: (artifactId, payload) => request(`artifacts/${encodeURIComponent(artifactId)}/organization`, { method: "POST", body: JSON.stringify(payload) }),
  organizeArtifacts: (artifactIds, payload) => request("artifacts/bulk/organization", { method: "POST", body: JSON.stringify({ ...payload, artifactIds }) }),
  reviewAction: (reviewId, action, note) => request(`review-requests/${reviewId}/action`, { method: "POST", body: JSON.stringify({ action, note }) }),
  createRevert: (auditId, reason) => request(`audit-events/${auditId}/revert`, { method: "POST", body: JSON.stringify({ reason }) }),
  createExport: (payload) => request("exports", { method: "POST", body: JSON.stringify(payload) }),
  effectiveArtifactType,
  filterArtifacts,
  normalizeArtifactFilters,
  stateLabel,
  renderStatus,
};

window.CreativeOperations = {
  submit,
  renderStatus,
  stateLabel,
  readLocal: () => [],
  readOperations: () => [],
  writeOperations: () => {},
};
