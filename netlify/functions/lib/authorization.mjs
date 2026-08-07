import { ROLE_ORDER } from "./identity.mjs";

export const ACCESS_CLASSES = {
  PUBLIC: "public-health",
  AUTHENTICATED_READ: "authenticated-read",
  AUTHENTICATED_MUTATION: "authenticated-mutation",
  PRIVILEGED: "privileged",
};

const route = (accessClass, minimumRole = null) => ({ accessClass, minimumRole });

export const classifyCreativeOsRoute = (method, path) => {
  const normalizedMethod = String(method || "GET").toUpperCase();
  if (normalizedMethod === "GET" && ["health", "ready", "health/full"].includes(path)) return route(ACCESS_CLASSES.PUBLIC);
  if (path === "health/audit-probe") return route(ACCESS_CLASSES.PUBLIC);

  if (normalizedMethod === "GET") {
    if (path === "review-requests") return route(ACCESS_CLASSES.PRIVILEGED, "admin");
    if (path === "imports/status") return route(ACCESS_CLASSES.AUTHENTICATED_READ, "contributor");
    return route(ACCESS_CLASSES.AUTHENTICATED_READ, "viewer");
  }

  if (/^controlled-values\/(categories|tags)(?:\/|$)/.test(path)) return route(ACCESS_CLASSES.PRIVILEGED, "admin");
  if (["imports/repo-metadata", "imports/archive-folder"].includes(path)) return route(ACCESS_CLASSES.PRIVILEGED, "admin");
  if (/^review-requests\/[0-9a-f-]+\/action$/i.test(path)) return route(ACCESS_CLASSES.PRIVILEGED, "admin");
  return route(ACCESS_CLASSES.AUTHENTICATED_MUTATION, "contributor");
};

export const authorizeCreativeOsRoute = (identity, policy) => {
  if (policy.accessClass === ACCESS_CLASSES.PUBLIC) return policy;
  if (!identity?.authenticated) {
    const unavailable = identity?.authFailureStatus === 503;
    throw Object.assign(new Error(unavailable
      ? "Creative OS identity verification is unavailable."
      : "Log in with a Creative OS employee account."), {
      status: unavailable ? 503 : 401,
      authFailure: identity?.authFailure || "missing",
    });
  }
  const actual = ROLE_ORDER.indexOf(identity.userRole);
  const required = ROLE_ORDER.indexOf(policy.minimumRole || "viewer");
  if (actual < required) throw Object.assign(new Error(`This action requires ${policy.minimumRole} authority or higher.`), { status: 403 });
  return policy;
};
