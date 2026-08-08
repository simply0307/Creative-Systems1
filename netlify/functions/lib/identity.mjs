export const ROLE_ORDER = ["viewer", "contributor", "editor", "admin", "owner"];

const LOCAL_OWNER_FLAG = "CREATIVE_OS_LOCAL_OWNER_MODE";

const envValue = (name, env = process.env) => {
  try {
    return globalThis.Netlify?.env?.get?.(name) || env[name] || "";
  } catch {
    return env[name] || "";
  }
};

const unauthenticatedIdentity = (authFailure = "missing", authFailureStatus = 401) => ({
  authenticated: false,
  identityVerified: false,
  userId: null,
  userEmail: null,
  userName: null,
  userRole: "viewer",
  authMethod: "none",
  authFailure,
  authFailureStatus,
});

export const localOwnerIdentity = {
  authenticated: true,
  identityVerified: false,
  userId: "local-archive-operator",
  userEmail: "archive-operator@creative-os.local",
  userName: "Archive operator",
  userRole: "owner",
  authMethod: "explicit-local-owner",
  authFailure: null,
  authFailureStatus: null,
};

export const normalizeRole = (roles) => {
  const valid = (Array.isArray(roles) ? roles : []).map((role) => String(role).toLowerCase()).filter((role) => ROLE_ORDER.includes(role));
  return valid.sort((a, b) => ROLE_ORDER.indexOf(b) - ROLE_ORDER.indexOf(a))[0] || "viewer";
};

const normalizeUser = (user) => {
  if (!user?.id && !user?.sub) return null;
  const metadata = user.user_metadata || user.userMetadata || {};
  const appMetadata = user.app_metadata || user.appMetadata || {};
  return {
    authenticated: true,
    identityVerified: true,
    userId: user.id || user.sub,
    userEmail: user.email || "",
    userName: metadata.full_name || metadata.name || user.name || user.email || "Employee",
    userRole: normalizeRole(appMetadata.roles),
    authMethod: "netlify-identity",
    authFailure: null,
    authFailureStatus: null,
  };
};

const headerValue = (request, name) => {
  if (request?.headers?.get) return request.headers.get(name);
  return request?.headers?.[name] || request?.headers?.[name.toLowerCase()] || request?.headers?.[name.toUpperCase()] || null;
};

const cookieValue = (request, name) => {
  const cookie = headerValue(request, "cookie") || "";
  const match = cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  if (!match) return null;
  try { return decodeURIComponent(match.slice(name.length + 1)); }
  catch { return "malformed-cookie"; }
};

const tokenState = (token, now = Date.now()) => {
  const parts = String(token || "").split(".");
  if (parts.length !== 3 || parts.some((part) => !part)) return "malformed";
  try {
    const payload = JSON.parse(Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64url").toString("utf8"));
    if (typeof payload.exp !== "number") return "malformed";
    return payload.exp * 1000 <= now ? "expired" : "present";
  } catch {
    return "malformed";
  }
};

export const localOwnerModeEnabled = (env = process.env) => envValue("CREATIVE_OS_RUNTIME_CONTEXT", env) === "local"
  && envValue(LOCAL_OWNER_FLAG, env).toLowerCase() === "true";

export const resolveIdentity = async (request, context = {}, fetchImpl = globalThis.fetch, env = process.env) => {
  const trusted = context?.clientContext?.user || request?.clientContext?.user || request?.requestContext?.authorizer?.user;
  const normalized = normalizeUser(trusted);
  if (normalized) return normalized;

  const authorization = headerValue(request, "authorization");
  if (authorization && !/^Bearer\s+\S+$/i.test(authorization)) return unauthenticatedIdentity("malformed", 401);

  const bearerToken = authorization ? authorization.replace(/^Bearer\s+/i, "") : cookieValue(request, "nf_jwt");
  if (!bearerToken) return localOwnerModeEnabled(env) ? localOwnerIdentity : unauthenticatedIdentity("missing", 401);

  const state = tokenState(bearerToken);
  if (state !== "present") return unauthenticatedIdentity(state, 401);

  const host = headerValue(request, "host");
  const protocol = headerValue(request, "x-forwarded-proto") || "https";
  const rawUrl = request?.rawUrl || request?.url;
  let origin = null;
  try { origin = rawUrl ? new URL(rawUrl).origin : host ? `${protocol}://${host}` : null; }
  catch { return unauthenticatedIdentity("malformed-request-origin", 401); }
  if (!origin) return unauthenticatedIdentity("verification-unavailable", 503);

  try {
    const response = await fetchImpl(`${origin}/.netlify/identity/user`, { headers: { authorization: `Bearer ${bearerToken}` } });
    if ([401, 403, 422].includes(response.status)) return unauthenticatedIdentity("invalid", 401);
    if (!response.ok) return unauthenticatedIdentity("verification-unavailable", 503);
    return normalizeUser(await response.json()) || unauthenticatedIdentity("invalid", 401);
  } catch {
    return unauthenticatedIdentity("verification-unavailable", 503);
  }
};

export const roleAuthority = ({ identity, operationType, riskLevel, explicitConfirmation, autoApproveConfigured }) => {
  const role = identity.userRole;
  if (!identity.authenticated && identity.authMethod !== "emergency-admin-key") return { allowed: false, approvalMode: "local-draft", reason: "Sign in with an employee account to submit operations." };
  if (role === "viewer") return { allowed: false, approvalMode: "local-draft", reason: "Viewer accounts are read-only." };
  if (operationType === "review_action" && !["admin","owner"].includes(role)) return { allowed:false, approvalMode:"local-draft", reason:"Legacy review actions require an admin or owner." };

  const metadataOperations = ["artifact_metadata_update", "bulk_artifact_metadata_update", "change_log_entry"];
  if (role === "contributor" && !metadataOperations.includes(operationType)) return { allowed: false, approvalMode: "local-draft", reason: "Contributors may submit metadata proposals only." };
  if (role === "editor" && ![...metadataOperations, "revert_operation"].includes(operationType)) return { allowed: false, approvalMode: "local-draft", reason: "This operation requires an admin or owner." };

  if (riskLevel === "high") {
    return { allowed: true, autoMerge: false, draft: true, approvalMode: role === "owner" && explicitConfirmation ? "owner-review-required" : "manual-review-required", reason: "High-risk operations always require manual review." };
  }
  if (riskLevel === "medium") {
    const privilegedApproval = ["admin", "owner"].includes(role) && explicitConfirmation;
    return privilegedApproval
      ? { allowed:true, autoMerge:false, draft:false, approvalMode:`${role}-approved-pr`, reason:`${role === "owner" ? "Owner" : "Admin"} approved - manual merge required.` }
      : { allowed:true, autoMerge:false, draft:true, approvalMode:"review-required", reason:"Medium-risk operation requires review or explicit admin/owner confirmation." };
  }
  if (role === "contributor") return { allowed: true, autoMerge: false, draft: true, approvalMode: "pending-admin-review", reason: "Submitted for editor/admin review." };
  if (role === "editor") return { allowed: true, autoMerge: false, draft: false, approvalMode: "editor-approved", reason: "Editor approved - PR created for merge." };
  if (["admin", "owner"].includes(role)) {
    const autoMerge = autoApproveConfigured;
    return { allowed:true, autoMerge, draft:false, approvalMode:autoMerge ? `${role}-auto-approved` : `${role}-approved-pr`, reason:autoMerge ? `${role === "owner" ? "Owner" : "Admin"} auto-approved and merged.` : `${role === "owner" ? "Owner" : "Admin"} approved - PR created. Manual merge required.` };
  }
  return { allowed: false, approvalMode: "local-draft", reason: "Role has no operation authority." };
};
