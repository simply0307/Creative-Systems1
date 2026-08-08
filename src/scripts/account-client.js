import { AUTH_EVENTS, acceptInvite, getUser, handleAuthCallback, login as identityLogin, logout as identityLogout, onAuthChange, updateUser as updateIdentityUser } from "@netlify/identity";

const signedOut = {
  authenticated: false,
  userId: null,
  userEmail: null,
  userName: "Not signed in",
  userRole: "viewer",
  roleSource: "No verified Netlify Identity session",
  adminPrivilegesActive: false,
  emergencyFallbackActive: false,
};

let account = { ...signedOut };
let authError = "";
let health = null;
let healthRequest = null;
let pendingInviteToken = null;
let passwordFormVisible = false;
let passwordSetupRequired = false;

const setAccountDrawer = (visible) => {
  document.querySelector("[data-account-drawer]")?.classList.toggle("account-drawer-open", visible);
  document.querySelectorAll("[data-account-drawer-open]").forEach((button) => {
    button.setAttribute("aria-expanded", String(visible));
  });
};

const normalizeAccount = (user) => {
  if (!user?.id) return { ...signedOut };
  const roles = Array.isArray(user.roles) ? user.roles.map((role) => String(role).toLowerCase()) : [];
  const roleOrder = ["viewer", "contributor", "editor", "admin", "owner"];
  const userRole = roles.filter((role) => roleOrder.includes(role)).sort((a, b) => roleOrder.indexOf(b) - roleOrder.indexOf(a))[0] || "viewer";
  return {
    authenticated: true,
    userId: user.id,
    userEmail: user.email || "",
    userName: user.name || user.email || "Employee",
    userRole,
    roleSource: "Netlify Identity app_metadata.roles (server verified for every API request)",
    adminPrivilegesActive: ["admin", "owner"].includes(userRole),
    emergencyFallbackActive: false,
  };
};

const snapshot = () => ({ ...account });
const canMutate = () => account.authenticated && ["contributor", "editor", "admin", "owner"].includes(account.userRole);
const authority = () => account.authenticated ? `${account.userRole} Creative OS authority` : "No application authority";

const render = () => {
  const state = snapshot();
  document.querySelectorAll("[data-account-state]").forEach((el) => { el.textContent = state.authenticated ? "Authenticated" : "Authentication required"; });
  document.querySelectorAll("[data-account-name]").forEach((el) => { el.textContent = state.userName; });
  document.querySelectorAll("[data-account-email]").forEach((el) => { el.textContent = state.userEmail || "—"; });
  document.querySelectorAll("[data-account-role]").forEach((el) => { el.textContent = state.userRole; });
  document.querySelectorAll("[data-account-role-source]").forEach((el) => { el.textContent = state.roleSource; });
  document.querySelectorAll("[data-account-privileges]").forEach((el) => { el.textContent = state.adminPrivilegesActive ? "admin active" : "not elevated"; });
  document.querySelectorAll("[data-account-authority]").forEach((el) => { el.textContent = authority(); });
  document.querySelectorAll("[data-account-auto]").forEach((el) => { el.textContent = canMutate() ? "Available actions are enforced again by the Creative OS API." : "Sign in with contributor authority or higher to change Creative OS state."; });
  document.querySelectorAll("[data-account-login]").forEach((el) => { el.hidden = state.authenticated; });
  document.querySelectorAll("[data-account-logout]").forEach((el) => { el.hidden = !state.authenticated; });
  document.querySelectorAll("[data-password-open]").forEach((el) => { el.hidden = !state.authenticated || passwordFormVisible; });
  document.querySelectorAll("[data-password-form]").forEach((el) => { el.hidden = !passwordFormVisible; });
  document.querySelectorAll("[data-password-cancel]").forEach((el) => { el.hidden = passwordSetupRequired; });
  document.querySelectorAll("[data-admin-link]").forEach((el) => { el.classList.toggle("admin-authorized", state.adminPrivilegesActive); });
  document.querySelectorAll("[data-admin-portal-status]").forEach((el) => { el.textContent = state.authenticated ? "Open Archive" : "View sign-in status"; });
  document.querySelectorAll("[data-emergency-state]").forEach((el) => { el.textContent = authError || "No automatic owner or emergency fallback is active."; });
  document.querySelectorAll('[name="actor"]').forEach((input) => { if (!input.value && state.authenticated) input.value = state.userName; });
  document.querySelectorAll('[data-artifact-form] button[type="submit"],#bulk-editor button[type="submit"],#tagging-bulk-form button[type="submit"],[data-submit-decision]').forEach((button) => {
    button.disabled = !canMutate();
    button.title = canMutate() ? "" : "Verified contributor authority or higher is required.";
  });
  window.dispatchEvent(new CustomEvent("creative-os-auth-changed", { detail: state }));
};

const renderHealth = () => {
  const checks = health?.checks || {};
  document.querySelectorAll("[data-deploy-branch]").forEach((el) => { el.textContent = health?.deployedBranch || "unknown"; });
  document.querySelectorAll("[data-deploy-auth]").forEach((el) => { el.textContent = account.authenticated ? "Netlify Identity verified" : "authentication required"; });
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

const showLoginForm = (visible) => {
  document.querySelectorAll("[data-login-form]").forEach((form) => {
    form.hidden = !visible;
    if (visible) form.querySelector("[data-login-email]")?.focus();
  });
};

const openLogin = () => {
  authError = "";
  setAccountDrawer(true);
  showLoginForm(true);
  render();
};

const closeLogin = () => {
  document.querySelectorAll("[data-login-form]").forEach((form) => form.reset());
  showLoginForm(false);
  authError = "";
  render();
};

const showPasswordForm = (visible) => {
  passwordFormVisible = visible;
  if (visible) document.querySelector("[data-password-new]")?.focus();
};

const openPasswordForm = () => {
  if (!account.authenticated) return;
  authError = "";
  setAccountDrawer(true);
  showPasswordForm(true);
  render();
};

const closePasswordForm = () => {
  if (passwordSetupRequired) return;
  document.querySelectorAll("[data-password-form]").forEach((form) => form.reset());
  showPasswordForm(false);
  authError = "";
  render();
};

const setPassword = async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const password = form.querySelector("[data-password-new]")?.value || "";
  const confirmation = form.querySelector("[data-password-confirmation]")?.value || "";
  if (!account.authenticated) {
    authError = "An authenticated Netlify Identity session is required to set a password.";
    render();
    return;
  }
  if (!password || password !== confirmation) {
    authError = "Passwords must be present and match.";
    render();
    return;
  }
  try {
    authError = "";
    account = normalizeAccount(await updateIdentityUser({ password }));
    passwordSetupRequired = false;
    form.reset();
    showPasswordForm(false);
    authError = "Password saved. Sign out and sign back in to verify it.";
  } catch (error) {
    authError = error?.message || "Password update failed.";
    form.querySelectorAll('input[type="password"]').forEach((input) => { input.value = ""; });
  }
  render();
};

const login = async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const email = form.querySelector("[data-login-email]")?.value.trim() || "";
  const passwordInput = form.querySelector("[data-login-password]");
  const password = passwordInput?.value || "";
  if (!email || !password) return;
  try {
    authError = "";
    account = normalizeAccount(await identityLogin(email, password));
    form.reset();
    showLoginForm(false);
  } catch (error) {
    account = { ...signedOut };
    authError = error?.message || "Sign-in failed.";
    if (passwordInput) passwordInput.value = "";
  }
  render();
};

const logout = async () => {
  try { await identityLogout(); }
  finally {
    account = { ...signedOut };
    authError = "";
    showLoginForm(false);
    passwordSetupRequired = false;
    showPasswordForm(false);
    render();
  }
};

const showInviteForm = (visible) => {
  document.querySelectorAll("[data-invite-form]").forEach((form) => { form.hidden = !visible; });
};

const acceptPendingInvite = async (event) => {
  event.preventDefault();
  if (!pendingInviteToken) return;
  const form = event.currentTarget;
  const password = form.querySelector("[data-invite-password]")?.value || "";
  const confirmation = form.querySelector("[data-invite-password-confirmation]")?.value || "";
  if (!password || password !== confirmation) {
    authError = "Invitation passwords must be present and match.";
    render();
    return;
  }
  try {
    authError = "";
    account = normalizeAccount(await acceptInvite(pendingInviteToken, password));
    pendingInviteToken = null;
    form.reset();
    showInviteForm(false);
  } catch (error) {
    account = { ...signedOut };
    authError = error?.message || "Invitation acceptance failed.";
  }
  render();
};

const ready = (async () => {
  try {
    const callback = await handleAuthCallback();
    if (callback?.type === "invite") {
      pendingInviteToken = callback.token;
      authError = "Set and confirm a password to accept your Creative OS invitation.";
      setAccountDrawer(true);
      showInviteForm(true);
      account = { ...signedOut };
    } else if (callback?.type === "recovery") {
      account = normalizeAccount(callback.user);
      passwordSetupRequired = true;
      setAccountDrawer(true);
      showPasswordForm(true);
      authError = "Set and confirm a new password to complete account recovery.";
    } else {
      account = normalizeAccount(callback?.user || await getUser());
    }
  } catch (error) {
    account = { ...signedOut };
    authError = error?.message || "Authentication is unavailable.";
  }
  render();
  return account;
})();

onAuthChange((event, user) => {
  account = normalizeAccount(user);
  if (event === AUTH_EVENTS.RECOVERY) {
    passwordSetupRequired = true;
    setAccountDrawer(true);
    showPasswordForm(true);
    authError = "Set and confirm a new password to complete account recovery.";
    render();
    return;
  }
  authError = "";
  if (account.authenticated) showLoginForm(false);
  else {
    passwordSetupRequired = false;
    showPasswordForm(false);
  }
  render();
});

document.querySelectorAll("[data-account-login]").forEach((button) => button.addEventListener("click", openLogin));
document.querySelectorAll("[data-account-logout]").forEach((button) => button.addEventListener("click", logout));
document.querySelectorAll("[data-account-drawer-open]").forEach((button) => button.addEventListener("click", () => setAccountDrawer(true)));
document.querySelectorAll("[data-account-drawer-close]").forEach((button) => button.addEventListener("click", () => setAccountDrawer(false)));
document.querySelectorAll("[data-login-form]").forEach((form) => form.addEventListener("submit", login));
document.querySelectorAll("[data-login-cancel]").forEach((button) => button.addEventListener("click", closeLogin));
document.querySelectorAll("[data-password-open]").forEach((button) => button.addEventListener("click", openPasswordForm));
document.querySelectorAll("[data-password-form]").forEach((form) => form.addEventListener("submit", setPassword));
document.querySelectorAll("[data-password-cancel]").forEach((button) => button.addEventListener("click", closePasswordForm));
document.querySelectorAll("[data-invite-form]").forEach((form) => form.addEventListener("submit", acceptPendingInvite));
render();
refreshHealth();

window.CreativeAccount = {
  ready,
  current: snapshot,
  authHeaders: async () => ({}),
  refreshHealth,
  login: openLogin,
  logout,
  emergencyFallbackEnabled: () => false,
};
