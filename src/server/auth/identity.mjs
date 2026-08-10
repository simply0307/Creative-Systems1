export const ROLE_ORDER = ["viewer", "contributor", "editor", "admin", "owner"];

export const normalizeRole = (roles) => {
  const valid = (Array.isArray(roles) ? roles : [])
    .map((role) => String(role).toLowerCase())
    .filter((role) => ROLE_ORDER.includes(role));
  return valid.sort((left, right) => ROLE_ORDER.indexOf(right) - ROLE_ORDER.indexOf(left))[0] || "viewer";
};

export const unauthenticatedIdentity = (authFailure = "missing", authFailureStatus = 401) => ({
  authenticated: false,
  identityVerified: false,
  provider: null,
  subject: null,
  verifiedEmail: null,
  trustedClaims: {},
  sessionStrength: null,
  userId: null,
  userEmail: null,
  userName: null,
  userRole: "viewer",
  roleSource: "none",
  authMethod: "none",
  authFailure,
  authFailureStatus,
});

export const headerValue = (request, name) => {
  if (request?.headers?.get) return request.headers.get(name);
  return request?.headers?.[name] || request?.headers?.[name.toLowerCase()] || request?.headers?.[name.toUpperCase()] || null;
};

export const cookieValue = (request, name) => {
  const cookie = headerValue(request, "cookie") || "";
  const match = cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  if (!match) return null;
  try { return decodeURIComponent(match.slice(name.length + 1)); }
  catch { return "malformed-cookie"; }
};

export const bearerToken = (request) => {
  const authorization = headerValue(request, "authorization");
  if (!authorization) return { token: null, state: "missing" };
  if (!/^Bearer\s+\S+$/i.test(authorization)) return { token: null, state: "malformed" };
  return { token: authorization.replace(/^Bearer\s+/i, ""), state: "present" };
};

export const parseUnverifiedJwt = (token) => {
  const parts = String(token || "").split(".");
  if (parts.length !== 3 || parts.some((part) => !part)) return null;
  try { return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")); }
  catch { return null; }
};

export const tokenState = (token, now = Date.now()) => {
  const payload = parseUnverifiedJwt(token);
  if (!payload || typeof payload.exp !== "number") return "malformed";
  return payload.exp * 1000 <= now ? "expired" : "present";
};

export const withProfileAuthority = (identity, profile) => {
  const role = String(profile?.role || "").toLowerCase();
  if (!ROLE_ORDER.includes(role)) {
    throw Object.assign(new Error("This Creative OS profile has no recognized role."), {
      status: 403,
      code: "profile_role_invalid",
    });
  }
  return {
    ...identity,
    userRole: role,
    roleSource: "public.profiles.role",
    profileId: profile?.id || null,
  };
};
