import {
  bearerToken,
  parseUnverifiedJwt,
  tokenState,
  unauthenticatedIdentity,
} from "../../../src/server/auth/identity.mjs";

const verifiedSupabaseIdentity = (user, token) => {
  const claims = parseUnverifiedJwt(token) || {};
  const emailVerified = Boolean(user?.email && (user.email_confirmed_at || user.confirmed_at));
  return {
    authenticated: true,
    identityVerified: true,
    provider: "supabase_auth",
    subject: user.id,
    verifiedEmail: emailVerified ? user.email : null,
    trustedClaims: {
      aal: claims.aal || null,
      amr: Array.isArray(claims.amr) ? claims.amr : [],
      sessionId: claims.session_id || null,
      appMetadata: user.app_metadata || {},
    },
    sessionStrength: claims.aal || "verified-session",
    userId: user.id,
    userEmail: emailVerified ? user.email : "",
    userName: user.user_metadata?.full_name || user.user_metadata?.name || user.email || "Employee",
    userRole: "viewer",
    roleSource: "unprovisioned",
    authMethod: "supabase-auth",
    authFailure: null,
    authFailureStatus: null,
  };
};

/** @implements {import("../../../src/server/auth/auth-provider.ts").AuthProvider} */
export class SupabaseAuthProvider {
  name = "supabase-auth";

  async authenticate(request, { supabase } = {}) {
    const bearer = bearerToken(request);
    if (bearer.state !== "present") return unauthenticatedIdentity(bearer.state, 401);
    const state = tokenState(bearer.token);
    if (state !== "present") return unauthenticatedIdentity(state, 401);
    if (!supabase?.auth?.getUser) return unauthenticatedIdentity("verification-unavailable", 503);

    try {
      const { data, error } = await supabase.auth.getUser(bearer.token);
      if (error) {
        const status = Number(error.status || error.statusCode || 0);
        return unauthenticatedIdentity([400, 401, 403, 422].includes(status) ? "invalid" : "verification-unavailable", [400, 401, 403, 422].includes(status) ? 401 : 503);
      }
      return data?.user?.id ? verifiedSupabaseIdentity(data.user, bearer.token) : unauthenticatedIdentity("invalid", 401);
    } catch {
      return unauthenticatedIdentity("verification-unavailable", 503);
    }
  }
}
