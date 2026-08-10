import {
  AUTH_EVENTS,
  acceptInvite,
  getUser as getNetlifyUser,
  handleAuthCallback,
  login as netlifyLogin,
  logout as netlifyLogout,
  onAuthChange as onNetlifyAuthChange,
  requestPasswordRecovery as requestNetlifyRecovery,
  updateUser as updateNetlifyUser,
} from "@netlify/identity";
import { createClient } from "@supabase/supabase-js";

const env = import.meta.env || {};
export const AUTH_MODE = String(env.PUBLIC_CREATIVE_OS_AUTH_MODE || "netlify").toLowerCase();
const VALID_MODES = new Set(["netlify", "dual", "supabase"]);
const STORAGE_KEY = "creative-os.auth-provider";

const assertMode = () => {
  if (!VALID_MODES.has(AUTH_MODE)) throw new Error("Creative OS browser auth mode is invalid.");
};

const normalizeNetlify = (user) => user?.id ? ({
  id: user.id,
  email: user.email || "",
  name: user.name || user.email || "Employee",
  provider: "netlify",
}) : null;

const normalizeSupabase = (user) => user?.id ? ({
  id: user.id,
  email: user.email || "",
  name: user.user_metadata?.full_name || user.user_metadata?.name || user.email || "Employee",
  provider: "supabase",
}) : null;

const supabaseUrl = String(env.PUBLIC_SUPABASE_URL || "");
const supabaseKey = String(env.PUBLIC_SUPABASE_PUBLISHABLE_KEY || "");
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
}) : null;

class NetlifyBrowserAuthProvider {
  name = "netlify";

  async restore() {
    const callback = await handleAuthCallback();
    if (callback?.type === "invite") return { type: "invite", token: callback.token, user: null };
    return { type: callback?.type || "session", user: normalizeNetlify(callback?.user || await getNetlifyUser()) };
  }

  async login(email, password) { return normalizeNetlify(await netlifyLogin(email, password)); }
  logout() { return netlifyLogout(); }
  async updatePassword(password) { return normalizeNetlify(await updateNetlifyUser({ password })); }
  recover(email) { return requestNetlifyRecovery(email); }
  async acceptInvite(token, password) { return normalizeNetlify(await acceptInvite(token, password)); }
  authHeaders() { return {}; }
  onChange(callback) { return onNetlifyAuthChange((event, user) => callback(event, normalizeNetlify(user))); }
}

class SupabaseBrowserAuthProvider {
  name = "supabase";

  #require() {
    if (!supabase) throw new Error("Supabase browser auth is not configured for this deploy.");
    return supabase;
  }

  async restore() {
    const { data, error } = await this.#require().auth.getSession();
    if (error) throw error;
    return { type: "session", user: normalizeSupabase(data.session?.user) };
  }

  async login(email, password) {
    const { data, error } = await this.#require().auth.signInWithPassword({ email, password });
    if (error) throw error;
    return normalizeSupabase(data.user);
  }

  async logout() {
    const { error } = await this.#require().auth.signOut();
    if (error) throw error;
  }

  async updatePassword(password) {
    const { data, error } = await this.#require().auth.updateUser({ password });
    if (error) throw error;
    return normalizeSupabase(data.user);
  }

  async recover(email) {
    const { error } = await this.#require().auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}${window.location.pathname}` });
    if (error) throw error;
  }

  async authHeaders(target = "/api/creative-os") {
    const url = new URL(target, window.location.href);
    if (url.origin !== window.location.origin) throw new Error("Creative OS credentials may only be sent to the current site origin.");
    const { data, error } = await this.#require().auth.getSession();
    if (error) throw error;
    return data.session?.access_token ? { authorization: `Bearer ${data.session.access_token}` } : {};
  }

  onChange(callback) {
    if (!supabase) return () => {};
    const { data } = supabase.auth.onAuthStateChange((event, session) => callback(event, normalizeSupabase(session?.user)));
    return () => data.subscription.unsubscribe();
  }
}

const providers = {
  netlify: new NetlifyBrowserAuthProvider(),
  supabase: new SupabaseBrowserAuthProvider(),
};

export const providerAvailable = (name) => name === "netlify" || (name === "supabase" && Boolean(supabase));
export const providerAllowed = (name) => AUTH_MODE === "dual" || AUTH_MODE === name;
export const defaultProvider = () => {
  assertMode();
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored && providerAllowed(stored) && providerAvailable(stored)) return stored;
  return AUTH_MODE === "supabase" ? "supabase" : "netlify";
};

export const selectProvider = (name) => {
  assertMode();
  if (!providerAllowed(name) || !providerAvailable(name)) throw new Error(`${name} authentication is not available in this deploy.`);
  window.localStorage.setItem(STORAGE_KEY, name);
  return providers[name];
};

export const providerByName = (name) => providers[name] || null;
export { AUTH_EVENTS };
