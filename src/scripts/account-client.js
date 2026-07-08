const ready = Promise.resolve();

const localOperator = {
  authenticated: true,
  userId: "local-archive-operator",
  userEmail: "archive-operator@creative-os.local",
  userName: "Archive operator",
  userRole: "owner",
  roleSource: "Open archive tool mode: solo user",
  adminPrivilegesActive: true,
  emergencyFallbackActive: false,
};

let health = null;
let healthRequest = null;

const yesNo = (value) => value ? "yes" : "no";
const snapshot = () => ({ ...localOperator });
const authority = () => "Full archive indexing authority";

const render = () => {
  const state = snapshot();
  document.querySelectorAll("[data-account-state]").forEach((el) => { el.textContent = "Solo archive mode"; });
  document.querySelectorAll("[data-account-name]").forEach((el) => { el.textContent = state.userName; });
  document.querySelectorAll("[data-account-email]").forEach((el) => { el.textContent = state.userEmail; });
  document.querySelectorAll("[data-account-role]").forEach((el) => { el.textContent = state.userRole; });
  document.querySelectorAll("[data-account-role-source]").forEach((el) => { el.textContent = state.roleSource; });
  document.querySelectorAll("[data-account-privileges]").forEach((el) => { el.textContent = "owner active"; });
  document.querySelectorAll("[data-account-authority]").forEach((el) => { el.textContent = authority(); });
  document.querySelectorAll("[data-account-auto]").forEach((el) => { el.textContent = "Tag, folder, category, import, and export actions are available for the solo operator."; });
  document.querySelectorAll("[data-account-login],[data-account-logout],[data-emergency-toggle]").forEach((el) => { el.hidden = true; });
  document.querySelectorAll("[data-admin-link]").forEach((el) => { el.classList.add("admin-authorized"); });
  document.querySelectorAll("[data-admin-portal-status]").forEach((el) => { el.textContent = "Open Archive"; });
  document.querySelectorAll("[data-emergency-state]").forEach((el) => { el.textContent = "No account gate for solo-user mode."; });
  document.querySelectorAll('[name="actor"]').forEach((input) => { if (!input.value) input.value = state.userName; });
  document.querySelectorAll('[data-artifact-form] button[type="submit"],#bulk-editor button[type="submit"],#tagging-bulk-form button[type="submit"],[data-submit-decision]').forEach((button) => {
    button.disabled = false;
    button.title = "";
    button.textContent = "Save to archive index";
  });
  window.dispatchEvent(new CustomEvent("creative-os-auth-changed", { detail: state }));
};

const renderHealth = () => {
  const checks = health?.checks || {};
  const environment = health?.environment || {};
  document.querySelectorAll("[data-deploy-branch]").forEach((el) => { el.textContent = health?.deployedBranch || "unknown"; });
  document.querySelectorAll("[data-deploy-auth]").forEach((el) => { el.textContent = "solo mode"; });
  document.querySelectorAll("[data-deploy-api]").forEach((el) => { el.textContent = health ? "reached" : "unavailable"; });
  document.querySelectorAll("[data-health-url]").forEach((el) => { el.textContent = yesNo(checks.supabaseUrlConfigured ?? environment.supabaseUrlConfigured); });
  document.querySelectorAll("[data-health-anon]").forEach((el) => { el.textContent = yesNo(checks.anonKeyConfigured ?? environment.anonKeyConfigured); });
  document.querySelectorAll("[data-health-service]").forEach((el) => { el.textContent = yesNo(checks.serviceRoleConfigured ?? environment.serviceRoleConfigured); });
  document.querySelectorAll("[data-health-database]").forEach((el) => { el.textContent = checks.databaseConnected === undefined ? "not checked" : yesNo(checks.databaseConnected); });
  document.querySelectorAll("[data-health-artifacts]").forEach((el) => { el.textContent = checks.artifactsReadable === undefined ? "not checked" : checks.artifactsReadable ? `yes - ${checks.artifactCount ?? "?"} rows` : "no"; });
  document.querySelectorAll("[data-health-buckets]").forEach((el) => { el.textContent = checks.storageBucketsReady === undefined ? "not checked" : checks.storageBucketsReady ? `${checks.bucketsFound.length}/${checks.expectedBuckets.length} private` : (checks.missingBuckets || []).length ? `missing: ${checks.missingBuckets.join(", ")}` : `must be private: ${(checks.nonPrivateBuckets || []).join(", ") || "check failed"}`; });
  document.querySelectorAll("[data-health-role]").forEach((el) => { el.textContent = "owner"; });
  document.querySelectorAll("[data-health-audit]").forEach((el) => { el.textContent = checks.auditWriteVerified ? `verified${checks.lastAuditProbeAt ? ` - ${new Date(checks.lastAuditProbeAt).toLocaleString()}` : ""}` : "not yet verified"; });
  document.querySelectorAll("[data-deploy-github]").forEach((el) => { el.textContent = health?.githubRoutineWrites === false ? "disabled" : "unknown"; });
  document.querySelectorAll("[data-health-status]").forEach((el) => { el.textContent = checks.errors?.length ? checks.errors.join(" - ") : health?.ok ? "Setup checks passed." : "Complete Supabase configuration, then refresh."; });
  document.querySelectorAll("[data-health-audit-probe]").forEach((el) => { el.hidden = false; });
};

const refreshHealth = async () => {
  if (healthRequest) return healthRequest;
  healthRequest = fetch("/api/creative-os/health/full")
    .then((response) => response.json())
    .then((body) => {
      health = body;
      renderHealth();
      return health;
    })
    .catch(() => {
      health = null;
      renderHealth();
      return null;
    })
    .finally(() => { healthRequest = null; });
  return healthRequest;
};

document.addEventListener("click", async (event) => {
  const healthProbe = event.target.closest("[data-health-audit-probe]");
  if (!healthProbe) return;
  const healthStatus = document.querySelector("[data-health-status]");
  healthProbe.disabled = true;
  healthStatus.textContent = "Writing one intentional health-check audit event...";
  try {
    const response = await fetch("/api/creative-os/health/audit-probe", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Audit write probe failed.");
    healthStatus.textContent = body.message;
    await refreshHealth();
  } catch (error) {
    healthStatus.textContent = error instanceof Error ? error.message : "Audit write probe failed.";
  } finally {
    healthProbe.disabled = false;
  }
});

render();
refreshHealth();

window.CreativeAccount = {
  ready,
  current: snapshot,
  authHeaders: async () => ({}),
  refreshHealth,
  login: () => {},
  logout: async () => {},
  emergencyFallbackEnabled: () => false,
};
