(() => {
  const storageKey = "eggs-creative-os-local-changes";
  const operationsKey = "eggs-creative-os-local-operations";
  const adminKeyStorageKey = "eggs-creative-os-admin-key";
  let sessionAdminKey = "";
  const readLocal = () => { try { return JSON.parse(localStorage.getItem(storageKey) || "[]"); } catch { return []; } };
  const readOperations = () => { try { return JSON.parse(localStorage.getItem(operationsKey) || "[]"); } catch { return []; } };
  const writeOperations = (entries) => localStorage.setItem(operationsKey, JSON.stringify(entries.slice(0, 100)));
  const writeLocal = (entries) => localStorage.setItem(storageKey, JSON.stringify(entries));
  const stateLabel = (result = {}) => {
    const mode = result.approvalMode || result.mode || "";
    if (result.mode === "failed" || result.accepted === false) return "Failed";
    if (result.mode === "pending-writeback") return "Pending GitHub writeback";
    if (mode === "draft-pr-not-ready") return "Review required — PR draft not ready";
    if (result.fallbackUsed || result.localFallback || result.mode === "local-draft") return "Pending locally";
    if (result.prMerged && mode === "admin-auto-approved") return "Admin auto-approved and merged";
    if (result.prMerged && mode === "owner-auto-approved") return "Owner auto-approved and merged";
    if (result.prMerged) return "Waiting for Netlify rebuild";
    if (/manual-review|required|review-recommended|pending-admin-review/.test(mode) || result.riskLevel === "high") return "Review required";
    if (mode === "admin-approved-pr") return "Admin approved — PR created";
    if (/owner-approved/.test(mode)) return "Owner approved — PR created";
    if (result.prCreated || result.pullRequestUrl) return "Staged to GitHub PR";
    return "Pending locally";
  };
  const renderStatus = (element, result) => {
    const label = stateLabel(result);
    element.textContent = `${label}. ${result.message || "Operation response received."}`;
    if (result.pullRequestUrl) {
      element.append(" ");
      const link = document.createElement("a");
      link.href = result.pullRequestUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = `Open PR #${result.pullRequestNumber || ""}`.trim();
      element.append(link);
    }
    let panel = element.parentElement?.querySelector(".operations-diagnostics");
    if (!panel) {
      panel = document.createElement("details");
      panel.className = "operations-diagnostics";
      element.parentElement?.append(panel);
    }
    const d = result.diagnostics || {};
    const privileged = ["admin", "owner"].includes(result.userRole);
    const rows = [
      ["Current state", label],
      ["Canonical state", result.changeLogEntry?.canonicalEffect || (result.prMerged ? "Waiting for Netlify rebuild" : result.pullRequestUrl ? "Unchanged until PR merge and rebuild" : "Unchanged")],
      ["API reached", d.apiReached], ["GitHub configured", result.githubConfigured ?? d.githubConfigured],
      ["Authenticated", result.authenticated], ["Operator", result.userName], ["Role", result.userRole],
      ["Admin / owner detected", privileged], ["Admin key fallback used", result.authMethod === "emergency-admin-key" || result.adminKeyAccepted],
      ["Risk level", result.riskLevel], ["Approval mode", result.approvalMode],
      ["GitHub write attempted", result.githubWriteAttempted ?? d.githubWriteAttempted],
      ["Branch created", result.branchCreated ?? d.branchCreated], ["Commit created", result.commitCreated ?? d.commitCreated], ["PR created by this action", result.prCreated ?? d.prCreated], ["PR already exists", result.prExists], ["PR is draft", result.prDraft], ["PR merged", result.prMerged],
      ["Fallback used", result.fallbackUsed ?? d.fallbackUsed], ["Fallback reason", result.fallbackReason || d.fallbackReason],
      ["Error", d.errorMessage || result.error], ["Operation ID", result.operationId],
      ["Affected files", (result.filesWritten || result.changedFiles || result.changeLogEntry?.affectedFiles || []).join(" · ")],
      ["Audit record", result.auditRecordPath], ["Undo", result.undoInstructions],
    ].filter(([, value]) => value !== undefined && value !== null && value !== "");
    const valueText = (value) => typeof value === "boolean" ? (value ? "yes" : "no") : String(value);
    panel.innerHTML = `<summary>Operation diagnostics</summary><dl>${rows.map(([label,value])=>`<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(valueText(value))}</dd>`).join("")}</dl>`;
    if (d.fallbackUsed || d.errorMessage) panel.open = true;
  };
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]);

  const getAdminKey = () => {
    if (!window.CreativeAccount?.emergencyFallbackEnabled?.()) return "";
    if (sessionAdminKey) return sessionAdminKey;
    const stored = localStorage.getItem(adminKeyStorageKey);
    if (stored) return stored;
    const entered = window.prompt("Operations Admin Key (required for GitHub writeback). Cancel to save a local draft.") || "";
    if (!entered) return "";
    if (window.confirm("Store this Operations Admin Key in this browser? Choose Cancel to keep it for this tab only.")) localStorage.setItem(adminKeyStorageKey, entered);
    else sessionAdminKey = entered;
    return entered;
  };

  const requiresExplicitConfirmation = (payload) => {
    const changes = payload.changes || {};
    return ["metadata.bulk-update", "bulk_artifact_metadata_update"].includes(payload.action || payload.operationType)
      || ["canonStatus", "rightsStatus", "reviewStatus"].some((field) => changes[field] !== undefined)
      || /retired|published|public|private/i.test(String(changes.lifecycleStage || ""));
  };
  const storeOperation = (payload, response) => {
    const operationId = response.operationId || payload.operationId;
    const entries = readOperations().filter((entry) => entry.operationId !== operationId);
    const operation = {
      id: response.changeLogEntry?.id || `local-operation.${Date.now()}`,
      operationId,
      action: payload.action,
      timestamp: response.changeLogEntry?.timestamp || new Date().toISOString(),
      persistence: response.persistence,
      committed: Boolean(response.committed),
      changeLogEntry: response.changeLogEntry,
      decisionResolution: response.decisionResolution || null,
      sourceRewritePlan: response.sourceRewritePlan || null,
      result: {
        accepted: response.accepted, mode: response.mode, approvalMode: response.approvalMode, riskLevel: response.riskLevel,
        authenticated: response.authenticated, userRole: response.userRole, authMethod: response.authMethod,
        githubConfigured: response.githubConfigured, githubWriteAttempted: response.githubWriteAttempted,
        prCreated: response.prCreated, prMerged: response.prMerged, pullRequestUrl: response.pullRequestUrl,
        pullRequestNumber: response.pullRequestNumber, auditRecordPath: response.auditRecordPath,
        fallbackUsed: response.fallbackUsed, fallbackReason: response.fallbackReason, diagnostics: response.diagnostics,
        message: response.message, error:response.error, prDraft:response.prDraft, prExists:response.prExists,
      },
      proposedChanges: response.proposedChanges || [],
      followUp: response.followUp || [],
      request: { ...payload },
    };
    entries.unshift(operation);
    writeOperations(entries);
    return operation;
  };
  const storeDraft = (payload, response = null) => {
    const entries = readLocal();
    const entry = response?.changeLogEntry || {
      id: `local.${Date.now()}`,
      actionType: payload.action,
      person: payload.actor,
      timestamp: new Date().toISOString(),
      summary: payload.summary,
      affectedRecords: payload.targets,
      affectedFiles: payload.affectedFiles || [],
      status: "local-draft",
      notes: payload.reason,
      sourceImpact: payload.sourceImpact || ["metadata-only"],
      relatedDecision: payload.decisionId || null,
    };
    entries.unshift(entry); writeLocal(entries.slice(0, 100)); return entry;
  };

  const submit = async (payload) => {
    const authHeaders = await (window.CreativeAccount?.authHeaders?.() || Promise.resolve({}));
    const adminKey = getAdminKey();
    const operatorRole = window.CreativeAccount?.current?.().userRole || "viewer";
    const explicitConfirmation = requiresExplicitConfirmation(payload)
      ? window.confirm(`${operatorRole === "owner" ? "Owner" : operatorRole === "admin" ? "Admin" : "Operator"} confirmation: this operation includes medium-risk or bulk metadata changes. Review is recommended. Continue?`)
      : false;
    const operationId = payload.operationId || `operation.client.${Date.now()}.${Math.random().toString(36).slice(2,7)}`;
    const requestPayload = { ...payload, operationId, explicitConfirmation };
    const account = window.CreativeAccount?.current?.() || {};
    const pendingResult = {
      accepted:true, committed:false, mode:"pending-writeback", persistence:"browser-pending-writeback", operationId,
      authenticated:Boolean(account.authenticated), userName:account.userName, userRole:account.userRole,
      githubWriteAttempted:false, branchCreated:false, commitCreated:false, prCreated:false, prMerged:false,
      fallbackUsed:false, message:"Tag or metadata change captured locally; contacting GitHub writeback.",
      diagnostics:{apiReached:null,githubConfigured:null,githubWriteAttempted:false,branchCreated:false,commitCreated:false,prCreated:false,fallbackUsed:false},
    };
    storeOperation(requestPayload,pendingResult);
    window.dispatchEvent(new CustomEvent("creative-os-operation-pending",{detail:{payload:requestPayload,result:pendingResult}}));
    try {
      const response = await fetch("/api/operations", { method: "POST", headers: { "content-type": "application/json", ...authHeaders, ...(adminKey ? { "x-creative-os-key": adminKey } : {}) }, body: JSON.stringify(requestPayload) });
      const raw = await response.text();
      let result;
      try { result = JSON.parse(raw); }
      catch { result = { mode: "failed", error: `Operations API returned ${response.status} with a non-JSON response.`, fallbackReason: raw.slice(0, 300) || "Empty response", diagnostics: { apiReached: true, fallbackUsed: true, errorMessage: raw.slice(0, 300) || `HTTP ${response.status}` } }; }
      result.httpStatus = response.status;
      result.operationId ||= operationId;
      result.diagnostics = { apiReached: true, ...(result.diagnostics || {}) };
      if (result.adminKeyConfigured && result.adminKeyAccepted === false) {
        localStorage.removeItem(adminKeyStorageKey);
        sessionAdminKey = "";
      }
      if (!response.ok || result.mode === "failed") {
        result.committed = false;
        result.localFallback = true;
        result.fallbackReason ||= result.error || `Operations API returned ${response.status}`;
        result.message ||= "API reached, but GitHub writeback failed. A local draft was retained.";
      } else result.localFallback = result.mode === "local-draft";
      storeDraft(requestPayload, result); storeOperation(requestPayload, result); window.dispatchEvent(new CustomEvent("creative-os-operation-result",{detail:{payload:requestPayload,result}})); return result;
    } catch (error) {
      const changeLogEntry = storeDraft(requestPayload);
      const timestamp = changeLogEntry.timestamp;
      const decisionResolution = ["decision.resolve", "decision_resolution"].includes(requestPayload.action || requestPayload.operationType) ? {
        id: `local-resolution.${requestPayload.decisionId || "unknown"}.${Date.now()}`,
        decisionId: requestPayload.decisionId,
        selectedResolution: requestPayload.resolution?.selected || requestPayload.resolution || "custom",
        customResolution: requestPayload.resolution?.custom || "",
        rationale: requestPayload.reason,
        submittedBy: requestPayload.actor,
        timestamp,
        affectedArchiveRecords: requestPayload.affectedArchiveRecords || requestPayload.targets,
        affectedSourceFiles: requestPayload.affectedSourceFiles || requestPayload.affectedFiles || [],
        affectedExports: requestPayload.affectedExports || [],
        statusBefore: requestPayload.statusBefore || "open",
        statusAfter: requestPayload.statusAfter || "proposed-resolution",
        followUpNeeded: Boolean(requestPayload.followUp?.length),
        followUpTasks: requestPayload.followUp || [],
        sourceFilesChanged: false,
        createdPullRequestUrl: null,
        status: "local-draft",
      } : null;
      const sourceRewritePlan = requestPayload.rewritePlan ? { ...requestPayload.rewritePlan, affectedFiles: requestPayload.affectedFiles || [], status: "local-draft", sourceFilesChanged: false } : null;
      const reason = error?.message || "Network request failed";
      const result = { accepted: false, committed: false, mode: "failed", persistence: "browser-local-draft", operationId, localFallback: true, githubConfigured: false, adminKeyAccepted: false, fallbackReason: reason, error:reason, message: "Operations API could not be reached. Attempt retained locally; no repository files changed.", diagnostics: { apiReached: false, githubConfigured: false, githubWriteAttempted: false, branchCreated: false, commitCreated: false, prCreated: false, fallbackUsed: true, fallbackReason: reason, errorMessage: reason }, changeLogEntry, decisionResolution, sourceRewritePlan, proposedChanges: requestPayload.targets.map((target) => ({ target, operation: requestPayload.action, after: requestPayload.changes || requestPayload.resolution })), followUp: requestPayload.followUp || [] };
      storeOperation(requestPayload, result);
      window.dispatchEvent(new CustomEvent("creative-os-operation-result",{detail:{payload:requestPayload,result}}));
      return result;
    }
  };
  window.CreativeOperations = { submit, readLocal, readOperations, writeOperations, storeDraft, renderStatus, stateLabel };
})();
