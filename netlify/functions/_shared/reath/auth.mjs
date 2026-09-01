import { getUser } from "@netlify/identity";
import { reathConfig } from "./config.mjs";

export const ROLE_ORDER = ["viewer", "contributor", "editor", "admin", "owner"];

export const highestRole = (roles) => {
  const valid = (Array.isArray(roles) ? roles : []).map((role) => String(role).toLowerCase()).filter((role) => ROLE_ORDER.includes(role));
  return valid.sort((left, right) => ROLE_ORDER.indexOf(right) - ROLE_ORDER.indexOf(left))[0] || "viewer";
};

export const normalizeIdentityUser = (user) => {
  if (!user?.id) return null;
  const appRoles = Array.isArray(user.appMetadata?.roles) ? user.appMetadata.roles : [];
  const roles = [...(Array.isArray(user.roles) ? user.roles : []), ...appRoles];
  return {
    id: user.id,
    email: user.email || "",
    name: user.name || user.email || "Editor",
    role: highestRole(roles),
  };
};

export const authorizeIdentity = (identity, minimumRole = "viewer") => {
  if (!identity) return { allowed: false, status: 401, message: "Sign in with an invited Reath editorial account." };
  if (ROLE_ORDER.indexOf(identity.role) < ROLE_ORDER.indexOf(minimumRole)) {
    return { allowed: false, status: 403, message: `This action requires ${minimumRole} authority or higher.` };
  }
  return { allowed: true, identity };
};

export const requireIdentity = async (minimumRole = "viewer") => {
  const identity = normalizeIdentityUser(await getUser());
  const authorization = authorizeIdentity(identity, minimumRole);
  if (!authorization.allowed) {
    const error = new Error(authorization.message);
    error.status = authorization.status;
    throw error;
  }
  return identity;
};

export const requireSameOrigin = (request, env = process.env) => {
  const requestOrigin = new URL(request.url).origin;
  const origin = request.headers.get("origin");
  const configured = reathConfig(env).allowedOrigin;
  const allowed = new Set([requestOrigin, configured].filter(Boolean));
  if (!origin || !allowed.has(origin)) {
    const error = new Error("Cross-origin state change rejected.");
    error.status = 403;
    throw error;
  }
};
