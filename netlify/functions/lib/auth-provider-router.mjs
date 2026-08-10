import {
  bearerToken,
  cookieValue,
  parseUnverifiedJwt,
  unauthenticatedIdentity,
} from "../../../src/server/auth/identity.mjs";
import { NetlifyAuthProvider } from "./netlify-identity-provider.mjs";
import { SupabaseAuthProvider } from "./supabase-auth-provider.mjs";

export const AUTH_MODES = ["netlify", "dual", "supabase"];

const configuredMode = (environment = {}) => {
  const value = String(environment.CREATIVE_OS_AUTH_MODE || "netlify").toLowerCase();
  return AUTH_MODES.includes(value) ? value : null;
};

const issuerProvider = (request, environment, token) => {
  const issuer = String(parseUnverifiedJwt(token)?.iss || "").replace(/\/$/, "");
  if (!issuer) return null;
  const supabaseIssuer = `${String(environment.SUPABASE_URL || "").replace(/\/$/, "")}/auth/v1`;
  if (supabaseIssuer !== "/auth/v1" && issuer === supabaseIssuer) return "supabase";
  let requestOrigin = "";
  try { requestOrigin = new URL(request.url || request.rawUrl).origin; } catch { requestOrigin = ""; }
  const configuredNetlifyIssuer = String(environment.NETLIFY_IDENTITY_URL || "").replace(/\/$/, "");
  if ((configuredNetlifyIssuer && issuer === configuredNetlifyIssuer) || (requestOrigin && issuer === `${requestOrigin}/.netlify/identity`)) return "netlify";
  return null;
};

/** @implements {import("../../../src/server/auth/auth-provider.ts").AuthProvider} */
export class RoutedAuthProvider {
  name = "routed-auth";
  #context;
  #netlify;
  #supabase;

  constructor({ netlifyContext = {}, netlifyProvider, supabaseProvider } = {}) {
    this.#context = netlifyContext;
    this.#netlify = netlifyProvider || new NetlifyAuthProvider({ context: netlifyContext });
    this.#supabase = supabaseProvider || new SupabaseAuthProvider();
  }

  async authenticate(request, context = {}) {
    const mode = configuredMode(context.environment);
    if (!mode) return unauthenticatedIdentity("invalid-auth-mode", 503);

    const bearer = bearerToken(request);
    if (bearer.state === "malformed") return unauthenticatedIdentity("malformed", 401);
    const netlifyCookie = cookieValue(request, "nf_jwt");
    const trustedNetlifyUser = this.#context?.clientContext?.user || request?.clientContext?.user || request?.requestContext?.authorizer?.user;
    const issuerSelection = bearer.token ? issuerProvider(request, context.environment, bearer.token) : null;
    const selected = !bearer.token
      ? "netlify"
      : mode === "dual"
        ? issuerSelection
        : mode === "netlify"
          ? issuerSelection === "supabase" ? "supabase" : "netlify"
          : issuerSelection === "netlify" ? "netlify" : "supabase";

    if (bearer.token && netlifyCookie && bearer.token !== netlifyCookie) return unauthenticatedIdentity("conflicting-credentials", 401);
    if (trustedNetlifyUser && selected === "supabase") return unauthenticatedIdentity("conflicting-credentials", 401);
    if (bearer.token && !selected) return unauthenticatedIdentity("unknown-token-issuer", 401);
    if ((mode === "netlify" && selected !== "netlify") || (mode === "supabase" && selected !== "supabase")) return unauthenticatedIdentity("provider-disabled", 401);

    return selected === "supabase"
      ? this.#supabase.authenticate(request, context)
      : this.#netlify.authenticate(request, context);
  }
}

export const authModeForEnvironment = configuredMode;
