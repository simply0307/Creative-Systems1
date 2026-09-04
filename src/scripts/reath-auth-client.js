import { acceptInvite, getUser, handleAuthCallback, login, logout, onAuthChange } from "@netlify/identity";
import { readApiResponse, TEMPORARY_SERVICE_MESSAGE } from "./reath-api-response.js";

let currentUser = null;
let pendingInviteToken = null;
let readyResolve;
const ready = new Promise((resolve) => { readyResolve = resolve; });

const render = (user) => {
  currentUser = user;
  const acceptingInvite = Boolean(pendingInviteToken) && !user;
  document.querySelectorAll("[data-auth-loading]").forEach((element) => { element.hidden = true; });
  document.querySelectorAll("[data-auth-guest]").forEach((element) => { element.hidden = Boolean(user); });
  document.querySelectorAll("[data-login-form]").forEach((element) => { element.hidden = Boolean(user) || acceptingInvite; });
  document.querySelectorAll("[data-invite-form]").forEach((element) => { element.hidden = Boolean(user) || !acceptingInvite; });
  document.querySelectorAll("[data-user-panel]").forEach((element) => { element.hidden = !user; });
  document.querySelectorAll("[data-user-name]").forEach((element) => { element.textContent = user?.name || "Editor"; });
  document.querySelectorAll("[data-user-email]").forEach((element) => { element.textContent = user?.email || ""; });
  document.querySelectorAll("[data-user-role]").forEach((element) => { element.textContent = user?.roles?.[0] || user?.appMetadata?.roles?.[0] || "viewer"; });
  window.dispatchEvent(new CustomEvent("reath-auth-changed", { detail: user }));
};

document.querySelectorAll("[data-login-form]").forEach((form) => form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(form);
  const error = form.querySelector("[data-login-error]");
  error.textContent = "";
  try {
    const user = await login(String(data.get("email")), String(data.get("password")));
    render(user);
    form.reset();
  } catch (cause) {
    error.textContent = cause instanceof Error ? cause.message : "Sign-in failed.";
  }
}));

document.querySelectorAll("[data-invite-form]").forEach((form) => form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(form);
  const password = String(data.get("password") || "");
  const confirmation = String(data.get("password_confirmation") || "");
  const error = form.querySelector("[data-invite-error]");
  const submit = form.querySelector('button[type="submit"]');
  error.textContent = "";
  if (!pendingInviteToken) {
    error.textContent = "This invitation is no longer available. Open the invitation link again.";
    return;
  }
  if (password !== confirmation) {
    error.textContent = "Passwords do not match.";
    return;
  }
  submit.disabled = true;
  try {
    const user = await acceptInvite(pendingInviteToken, password);
    pendingInviteToken = null;
    form.reset();
    render(user);
  } catch (cause) {
    error.textContent = cause instanceof Error ? cause.message : "Invitation acceptance failed.";
  } finally {
    submit.disabled = false;
  }
}));

document.querySelectorAll("[data-logout]").forEach((button) => button.addEventListener("click", async () => {
  await logout();
  render(null);
}));

onAuthChange((_event, user) => render(user));

const initialize = async () => {
  try {
    const callback = await handleAuthCallback();
    if (callback?.type === "invite" && callback.token) pendingInviteToken = callback.token;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "The account link could not be processed.";
    document.querySelectorAll("[data-login-error]").forEach((element) => { element.textContent = message; });
  }
  render(await getUser());
  readyResolve(currentUser);
};
initialize();

window.ReathAuth = {
  ready,
  current: () => currentUser,
  api: async (path, options = {}) => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(path, {
        ...options,
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", ...(options.headers || {}) },
        signal: options.signal || controller.signal,
      });
      return await readApiResponse(response);
    } catch (error) {
      if (error?.name === "AbortError") throw new Error(TEMPORARY_SERVICE_MESSAGE);
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
  },
};
window.dispatchEvent(new CustomEvent("reath-auth-client-ready"));
