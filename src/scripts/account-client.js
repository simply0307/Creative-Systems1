import {
  AUTH_EVENTS,
  AUTH_MODE,
  defaultProvider,
  providerAllowed,
  providerAvailable,
  providerByName,
  selectProvider,
} from "./auth-provider-client.js";

const signedOut = {
  authenticated: false,
  provider: null,
  userId: null,
  userEmail: null,
  userName: "Not signed in",
  userRole: "viewer",
  roleSource: "No verified Creative OS session",
  adminPrivilegesActive: false,
  emergencyFallbackActive: false,
};

let account = { ...signedOut };
let activeProviderName = null;
let authError = "";
let health = null;
let healthRequest = null;
let pendingInviteToken = null;
let passwordFormVisible = false;
let passwordSetupRequired = false;

const provider = () => activeProviderName ? providerByName(activeProviderName) : null;
const snapshot = () => ({ ...account });
const canMutate = () => account.authenticated && ["contributor", "editor", "admin", "owner"].includes(account.userRole);
const authority = () => account.authenticated ? `${account.userRole} Creative OS authority` : "No application authority";

const setAccountDrawer = (visible) => {
  document.querySelector("[data-account-drawer]")?.classList.toggle("account-drawer-open", visible);
  document.querySelectorAll("[data-account-drawer-open]").forEach((button) => button.setAttribute("aria-expanded", String(visible)));
};

const accountFromUser = (user) => user?.id ? ({
  authenticated: true,
  provider: user.provider,
  userId: user.id,
  userEmail: user.email || "",
  userName: user.name || user.email || "Employee",
  userRole: "viewer",
  roleSource: "Awaiting server-controlled public.profiles.role",
  adminPrivilegesActive: false,
  emergencyFallbackActive: false,
}) : ({ ...signedOut });

const authHeaders = async (target = "/api/creative-os") => provider()?.authHeaders(target) || {};

const hydrateAuthority = async (user) => {
  account = accountFromUser(user);
  if (!account.authenticated) return account;
  const response = await fetch("/api/creative-os/auth/session", { headers: await authHeaders("/api/creative-os/auth/session") });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    account.userRole = "viewer";
    account.roleSource = "No provisioned Creative OS profile identity";
    authError = result.error || "This account is authenticated but not provisioned for Creative OS.";
    return account;
  }
  account.userRole = result.userRole || "viewer";
  account.roleSource = result.roleSource || "public.profiles.role";
  account.adminPrivilegesActive = ["admin", "owner"].includes(account.userRole);
  return account;
};

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
  document.querySelectorAll("[data-auth-provider-field]").forEach((el) => { el.hidden = AUTH_MODE !== "dual"; });
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
  document.querySelectorAll("[data-deploy-auth]").forEach((el) => { el.textContent = account.authenticated ? `${account.provider} verified (${AUTH_MODE})` : `${AUTH_MODE}; authentication required`; });
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
  ]).then(([shallow, readiness]) => {
    health = { ...shallow, ...readiness };
    renderHealth();
    return health;
  }).catch(() => {
    health = null;
    renderHealth();
    return null;
  }).finally(() => { healthRequest = null; });
  return healthRequest;
};

const showLoginForm = (visible) => document.querySelectorAll("[data-login-form]").forEach((form) => {
  form.hidden = !visible;
  if (visible) form.querySelector("[data-login-email]")?.focus();
});
const showInviteForm = (visible) => document.querySelectorAll("[data-invite-form]").forEach((form) => { form.hidden = !visible; });
const showPasswordForm = (visible) => {
  passwordFormVisible = visible;
  if (visible) document.querySelector("[data-password-new]")?.focus();
};
const openLogin = () => { authError = ""; setAccountDrawer(true); showLoginForm(true); render(); };
const closeLogin = () => { document.querySelectorAll("[data-login-form]").forEach((form) => form.reset()); showLoginForm(false); authError = ""; render(); };
const openPasswordForm = () => { if (account.authenticated) { authError = ""; setAccountDrawer(true); showPasswordForm(true); render(); } };
const closePasswordForm = () => { if (!passwordSetupRequired) { document.querySelectorAll("[data-password-form]").forEach((form) => form.reset()); showPasswordForm(false); authError = ""; render(); } };

const selectedLoginProvider = (form) => AUTH_MODE === "dual" ? form.querySelector("[data-auth-provider]")?.value || defaultProvider() : defaultProvider();

const login = async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const email = form.querySelector("[data-login-email]")?.value.trim() || "";
  const password = form.querySelector("[data-login-password]")?.value || "";
  if (!email || !password) return;
  try {
    activeProviderName = selectedLoginProvider(form);
    const selected = selectProvider(activeProviderName);
    const otherName = activeProviderName === "netlify" ? "supabase" : "netlify";
    if (AUTH_MODE === "dual" && providerAvailable(otherName)) await providerByName(otherName).logout().catch(() => {});
    authError = "";
    await hydrateAuthority(await selected.login(email, password));
    form.reset();
    showLoginForm(false);
  } catch (error) {
    account = { ...signedOut };
    authError = error?.message || "Sign-in failed.";
  }
  render();
};

const logout = async () => {
  try { await provider()?.logout(); }
  finally { account = { ...signedOut }; authError = ""; showLoginForm(false); passwordSetupRequired = false; showPasswordForm(false); render(); }
};

const setPassword = async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const password = form.querySelector("[data-password-new]")?.value || "";
  const confirmation = form.querySelector("[data-password-confirmation]")?.value || "";
  if (!account.authenticated) authError = "An authenticated Creative OS session is required to set a password.";
  else if (!password || password !== confirmation) authError = "Passwords must be present and match.";
  else try {
    await hydrateAuthority(await provider().updatePassword(password));
    passwordSetupRequired = false;
    form.reset();
    showPasswordForm(false);
    authError = "Password saved. Sign out and sign back in to verify it.";
  } catch (error) { authError = error?.message || "Password update failed."; }
  render();
};

const requestRecovery = async (event) => {
  const form = event.currentTarget.closest("form");
  const email = form?.querySelector("[data-login-email]")?.value.trim() || "";
  if (!email) { authError = "Enter the account email first."; render(); return; }
  try {
    activeProviderName = selectedLoginProvider(form);
    await selectProvider(activeProviderName).recover(email);
    authError = "Password recovery instructions were sent if the account exists.";
  } catch (error) { authError = error?.message || "Password recovery failed."; }
  render();
};

const acceptPendingInvite = async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const password = form.querySelector("[data-invite-password]")?.value || "";
  const confirmation = form.querySelector("[data-invite-password-confirmation]")?.value || "";
  if (!pendingInviteToken || !password || password !== confirmation) { authError = "Invitation passwords must be present and match."; render(); return; }
  try {
    activeProviderName = "netlify";
    const netlify = selectProvider("netlify");
    await hydrateAuthority(await netlify.acceptInvite(pendingInviteToken, password));
    pendingInviteToken = null;
    form.reset();
    showInviteForm(false);
  } catch (error) { account = { ...signedOut }; authError = error?.message || "Invitation acceptance failed."; }
  render();
};

const ready = (async () => {
  try {
    activeProviderName = defaultProvider();
    const restored = await selectProvider(activeProviderName).restore();
    if (restored?.type === "invite") {
      pendingInviteToken = restored.token;
      authError = "Set and confirm a password to accept your Creative OS invitation.";
      setAccountDrawer(true);
      showInviteForm(true);
    } else {
      if (restored?.type === "recovery") { passwordSetupRequired = true; setAccountDrawer(true); showPasswordForm(true); }
      await hydrateAuthority(restored?.user);
    }
  } catch (error) { account = { ...signedOut }; authError = error?.message || "Authentication is unavailable."; }
  render();
  return account;
})();

for (const name of ["netlify", "supabase"]) {
  if (!providerAllowed(name) || !providerAvailable(name)) continue;
  providerByName(name).onChange(async (event, user) => {
    if (activeProviderName !== name) return;
    if (event === AUTH_EVENTS.RECOVERY || event === "PASSWORD_RECOVERY") { passwordSetupRequired = true; setAccountDrawer(true); showPasswordForm(true); }
    authError = "";
    await hydrateAuthority(user).catch((error) => { authError = error?.message || "Authorization verification failed."; });
    render();
  });
}

document.querySelectorAll("[data-account-login]").forEach((button) => button.addEventListener("click", openLogin));
document.querySelectorAll("[data-account-logout]").forEach((button) => button.addEventListener("click", logout));
document.querySelectorAll("[data-account-drawer-open]").forEach((button) => button.addEventListener("click", () => setAccountDrawer(true)));
document.querySelectorAll("[data-account-drawer-close]").forEach((button) => button.addEventListener("click", () => setAccountDrawer(false)));
document.querySelectorAll("[data-login-form]").forEach((form) => form.addEventListener("submit", login));
document.querySelectorAll("[data-login-cancel]").forEach((button) => button.addEventListener("click", closeLogin));
document.querySelectorAll("[data-login-recovery]").forEach((button) => button.addEventListener("click", requestRecovery));
document.querySelectorAll("[data-password-open]").forEach((button) => button.addEventListener("click", openPasswordForm));
document.querySelectorAll("[data-password-form]").forEach((form) => form.addEventListener("submit", setPassword));
document.querySelectorAll("[data-password-cancel]").forEach((button) => button.addEventListener("click", closePasswordForm));
document.querySelectorAll("[data-invite-form]").forEach((form) => form.addEventListener("submit", acceptPendingInvite));
render();
refreshHealth();

window.CreativeAccount = {
  ready,
  current: snapshot,
  authHeaders,
  refreshHealth,
  login: openLogin,
  logout,
  emergencyFallbackEnabled: () => false,
};
