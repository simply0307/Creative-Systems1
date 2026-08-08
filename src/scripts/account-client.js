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
  document.querySelectorAll("[data-deploy-branch]").forEach((el) => { el.textContent = health?.deployedBranch || "unknown"; });
  document.querySelectorAll("[data-deploy-auth]").forEach((el) => { el.textContent = "solo mode"; });
  document.querySelectorAll("[data-deploy-api]").forEach((el) => { el.textContent = health ? "reached" : "unavailable"; });
  document.querySelectorAll("[data-health-context]").forEach((el) => { el.textContent = health?.runtimeContext || "missing"; });
  document.querySelectorAll("[data-health-project]").forEach((el) => { el.textContent = checks.projectIdentityMatches ? "declared URL/ref match" : "not ready"; });
  document.querySelectorAll("[data-health-contract]").forEach((el) => { el.textContent = checks.contractCompatible ? `version ${checks.schemaContractVersion}` : "not compatible"; });
  document.querySelectorAll("[data-health-schema]").forEach((el) => { el.textContent = checks.schemaCompatible ? `${checks.requiredTableCount} table/column probes passed` : "not compatible"; });
  document.querySelectorAll("[data-health-buckets]").forEach((el) => { el.textContent = checks.storageCompatible ? `${checks.bucketsFound?.length || 0}/${checks.requiredBuckets?.length || 0} private` : (checks.missingBuckets || []).length ? `missing: ${checks.missingBuckets.join(", ")}` : `must be private: ${(checks.nonPrivateBuckets || []).join(", ") || "check failed"}`; });
  document.querySelectorAll("[data-health-authority]").forEach((el) => { el.textContent = checks.mutationAuthority || health?.requiredMutationAuthority || "not verified"; });
  document.querySelectorAll("[data-deploy-github]").forEach((el) => { el.textContent = health?.githubRoutineWrites === false ? "disabled" : "unknown"; });
  document.querySelectorAll("[data-health-status]").forEach((el) => { el.textContent = health?.ready ? "Runtime is ready; all checks were read-only." : (health?.failures || []).map((item) => item.message).join(" - ") || "Complete runtime configuration, then refresh."; });
};

const refreshHealth = async () => {
  if (healthRequest) return healthRequest;
  healthRequest = Promise.all([
    fetch("/api/creative-os/health").then((response) => response.json()),
    fetch("/api/creative-os/ready").then((response) => response.json()),
  ])
    .then(([shallow, readiness]) => {
      health = { ...shallow, ...readiness };
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
