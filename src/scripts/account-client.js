import {
  acceptInvite,
  getUser,
  handleAuthCallback,
  login,
  logout,
  onAuthChange,
  updateUser,
} from "@netlify/identity";

const fallbackFlag = "eggs-creative-os-emergency-key-enabled";
const roleOrder = ["viewer", "contributor", "editor", "admin", "owner"];
let currentUser = null;
let health = null;
let pendingCallback = null;
let healthRequest = null;
let readyResolve;
const ready = new Promise((resolve) => { readyResolve = resolve; });

const roleOf = (user) => {
  const roles = (user?.roles || user?.appMetadata?.roles || [])
    .map((role) => String(role).toLowerCase())
    .filter((role) => roleOrder.includes(role));
  return roles.sort((a, b) => roleOrder.indexOf(b) - roleOrder.indexOf(a))[0] || "viewer";
};
const hasTrustedRole = (user) => (user?.roles || user?.appMetadata?.roles || []).some((role) => roleOrder.includes(String(role).toLowerCase()));
const snapshot = () => currentUser ? {
  authenticated: true,
  userId: currentUser.id,
  userEmail: currentUser.email,
  userName: currentUser.name || currentUser.userMetadata?.full_name || currentUser.email,
  userRole: roleOf(currentUser),
  roleSource: hasTrustedRole(currentUser) ? "Netlify Identity app_metadata.roles" : "No supported app_metadata.roles claim (viewer fallback)",
  adminPrivilegesActive: ["admin", "owner"].includes(roleOf(currentUser)),
  emergencyFallbackActive: false,
} : {
  authenticated: false,
  userId: null,
  userEmail: null,
  userName: null,
  userRole: "viewer",
  roleSource: "No authenticated role claim",
  adminPrivilegesActive: false,
  emergencyFallbackActive: localStorage.getItem(fallbackFlag) === "true",
};
const authority = (role) => ({
  viewer: "Browse only",
  contributor: "Submit metadata proposals",
  editor: "Approve low-risk metadata",
  admin: "Administer operations",
  owner: "Owner authority",
}[role] || "Browse only");

const render = () => {
  const state = snapshot();
  document.querySelectorAll("[data-account-state]").forEach((el) => { el.textContent = state.authenticated ? "Logged in" : "Logged out"; });
  document.querySelectorAll("[data-account-name]").forEach((el) => { el.textContent = state.authenticated ? state.userName : "Not signed in"; });
  document.querySelectorAll("[data-account-email]").forEach((el) => { el.textContent = state.userEmail || "—"; });
  document.querySelectorAll("[data-account-role]").forEach((el) => { el.textContent = state.userRole; });
  document.querySelectorAll("[data-account-role-source]").forEach((el) => { el.textContent = state.roleSource; });
  document.querySelectorAll("[data-account-privileges]").forEach((el) => { el.textContent = state.adminPrivilegesActive ? "admin/owner active" : "inactive"; });
  document.querySelectorAll("[data-account-authority]").forEach((el) => { el.textContent = authority(state.userRole); });
  document.querySelectorAll("[data-account-auto]").forEach((el) => { el.textContent = state.adminPrivilegesActive ? "Admin/owner database changes apply immediately" : state.userRole === "editor" ? "Low-risk metadata applies immediately" : "Changes follow role review policy"; });
  document.querySelectorAll("[data-account-login]").forEach((el) => { el.hidden = state.authenticated; });
  document.querySelectorAll("[data-account-logout]").forEach((el) => { el.hidden = !state.authenticated; });
  document.querySelectorAll("[data-admin-link]").forEach((el) => { el.classList.toggle("admin-authorized", state.adminPrivilegesActive); });
  document.querySelectorAll("[data-admin-portal-status]").forEach((el) => {
    el.textContent = state.adminPrivilegesActive ? "Admin Portal available" : state.authenticated ? "Admin Portal requires admin or owner role" : "Log in as admin/owner to access Admin Portal";
  });
  document.querySelectorAll("[data-emergency-state]").forEach((el) => { el.textContent = state.emergencyFallbackActive ? "Emergency key fallback active" : "Emergency fallback inactive"; });
  if (state.authenticated) document.querySelectorAll('[name="actor"]').forEach((input) => { if (!input.value) input.value = state.userName; });
  document.querySelectorAll('[data-artifact-form] button[type="submit"],#bulk-editor button[type="submit"],#tagging-bulk-form button[type="submit"],[data-submit-decision]').forEach((button) => {
    const canWrite = state.userRole !== "viewer" || state.emergencyFallbackActive;
    button.disabled = !canWrite;
    button.title = canWrite ? "" : "Log in with a contributor, editor, admin, or owner account";
    button.textContent = state.authenticated ? `Submit as ${state.userRole[0].toUpperCase() + state.userRole.slice(1)}` : state.emergencyFallbackActive ? "Submit with emergency key" : "Login required";
  });
  window.dispatchEvent(new CustomEvent("creative-os-auth-changed", { detail: state }));
};

const renderHealth = () => {
  const yesNo = (value) => value ? "yes" : "no";
  const checks = health?.checks || {};
  const environment = health?.environment || {};
  document.querySelectorAll("[data-deploy-branch]").forEach((el) => { el.textContent = health?.deployedBranch || "unknown"; });
  document.querySelectorAll("[data-deploy-auth]").forEach((el) => { el.textContent = yesNo(health?.identityEnabled); });
  document.querySelectorAll("[data-deploy-api]").forEach((el) => { el.textContent = health ? "reached" : "unavailable"; });
  document.querySelectorAll("[data-health-url]").forEach((el) => { el.textContent = yesNo(checks.supabaseUrlConfigured ?? environment.supabaseUrlConfigured); });
  document.querySelectorAll("[data-health-anon]").forEach((el) => { el.textContent = yesNo(checks.anonKeyConfigured ?? environment.anonKeyConfigured); });
  document.querySelectorAll("[data-health-service]").forEach((el) => { el.textContent = yesNo(checks.serviceRoleConfigured ?? environment.serviceRoleConfigured); });
  document.querySelectorAll("[data-health-database]").forEach((el) => { el.textContent = checks.databaseConnected === undefined ? "log in to test" : yesNo(checks.databaseConnected); });
  document.querySelectorAll("[data-health-artifacts]").forEach((el) => { el.textContent = checks.artifactsReadable === undefined ? "log in to test" : checks.artifactsReadable ? `yes · ${checks.artifactCount ?? "?"} rows` : "no"; });
  document.querySelectorAll("[data-health-buckets]").forEach((el) => { el.textContent = checks.storageBucketsReady === undefined ? "log in to test" : checks.storageBucketsReady ? `${checks.bucketsFound.length}/${checks.expectedBuckets.length} private` : (checks.missingBuckets || []).length ? `missing: ${checks.missingBuckets.join(", ")}` : `must be private: ${(checks.nonPrivateBuckets || []).join(", ") || "check failed"}`; });
  document.querySelectorAll("[data-health-role]").forEach((el) => { el.textContent = checks.userRoleDetected ? checks.userRole : "not detected"; });
  document.querySelectorAll("[data-health-audit]").forEach((el) => { el.textContent = checks.auditWriteVerified ? `verified${checks.lastAuditProbeAt ? ` · ${new Date(checks.lastAuditProbeAt).toLocaleString()}` : ""}` : "not yet verified"; });
  document.querySelectorAll("[data-deploy-github]").forEach((el) => { el.textContent = health?.githubRoutineWrites === false ? "disabled" : "unknown"; });
  document.querySelectorAll("[data-health-status]").forEach((el) => { el.textContent = checks.errors?.length ? checks.errors.join(" · ") : health?.ok ? "Setup checks passed." : "Complete configuration, then refresh."; });
  document.querySelectorAll("[data-health-audit-probe]").forEach((el) => { el.hidden = !["admin", "owner"].includes(snapshot().userRole); });
};

const tokenHeaders = () => {
  const token = document.cookie.split("; ").find((part) => part.startsWith("nf_jwt="))?.slice("nf_jwt=".length);
  return token ? { authorization: `Bearer ${decodeURIComponent(token)}` } : {};
};

const refreshHealth = async () => {
  if (healthRequest) return healthRequest;
  const account = snapshot();
  const path = account.authenticated ? "/api/creative-os/health/full" : "/api/creative-os/health";
  healthRequest = fetch(path, { headers: tokenHeaders() }).then(async (response) => ({ response, body: await response.json() })).then(({ response, body }) => {
    health = body;
    if (!response.ok && !body.checks) health.ok = false;
    renderHealth();
    return health;
  }).catch(() => {
    health = null;
    renderHealth();
    return null;
  }).finally(() => { healthRequest = null; });
  return healthRequest;
};

const dialog = document.querySelector("#account-dialog");
const form = dialog?.querySelector("form");
const status = dialog?.querySelector("[data-account-status]");
const setMode = (mode) => {
  form.dataset.mode = mode;
  form.querySelector('[name="email"]').hidden = mode !== "login";
  form.querySelector('[name="email"]').required = mode === "login";
  form.querySelector("button[type=submit]").textContent = mode === "invite" ? "Accept invite" : mode === "recovery" ? "Set new password" : "Log in";
};
const openDialog = (mode = "login") => { setMode(mode); status.textContent = ""; dialog.showModal(); };

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(form);
  status.textContent = "Authenticating…";
  try {
    if (form.dataset.mode === "invite") currentUser = await acceptInvite(pendingCallback.token, String(data.get("password")));
    else if (form.dataset.mode === "recovery") currentUser = await updateUser({ password: String(data.get("password")) });
    else currentUser = await login(String(data.get("email")), String(data.get("password")));
    dialog.close();
    form.reset();
    pendingCallback = null;
    render();
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "Authentication failed.";
  }
});

document.addEventListener("click", async (event) => {
  const loginButton = event.target.closest("[data-account-login]");
  const logoutButton = event.target.closest("[data-account-logout]");
  const fallback = event.target.closest("[data-emergency-toggle]");
  if (loginButton) openDialog();
  if (logoutButton) { await logout(); currentUser = null; render(); }
  if (fallback) {
    const active = localStorage.getItem(fallbackFlag) === "true";
    localStorage.setItem(fallbackFlag, String(!active));
    render();
  }
  const healthProbe = event.target.closest("[data-health-audit-probe]");
  if (healthProbe) {
    const healthStatus = document.querySelector("[data-health-status]");
    healthProbe.disabled = true;
    healthStatus.textContent = "Writing one intentional health-check audit event…";
    try {
      const response = await fetch("/api/creative-os/health/audit-probe", { method: "POST", headers: { "content-type": "application/json", ...tokenHeaders() }, body: "{}" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Audit write probe failed.");
      healthStatus.textContent = body.message;
      await refreshHealth();
    } catch (error) {
      healthStatus.textContent = error instanceof Error ? error.message : "Audit write probe failed.";
    } finally { healthProbe.disabled = false; }
  }
});

onAuthChange((_event, user) => { currentUser = user; render(); refreshHealth(); });
Promise.all([
  fetch("/api/creative-os/health").then((response) => response.json()).catch(() => null),
  handleAuthCallback().catch((error) => { status.textContent = error instanceof Error ? error.message : "Authentication callback failed."; return null; }),
]).then(async ([healthResult, callback]) => {
  health = healthResult;
  renderHealth();
  pendingCallback = callback;
  if (callback?.user) currentUser = callback.user;
  else currentUser = await getUser();
  if (callback?.type === "invite") openDialog("invite");
  if (callback?.type === "recovery") openDialog("recovery");
  render();
  readyResolve();
  refreshHealth();
});

window.CreativeAccount = {
  ready,
  current: () => snapshot(),
  authHeaders: async () => {
    await ready;
    return tokenHeaders();
  },
  refreshHealth,
  login: () => openDialog(),
  logout,
  emergencyFallbackEnabled: () => localStorage.getItem(fallbackFlag) === "true",
};
