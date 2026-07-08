export const ROLE_ORDER = ["viewer", "contributor", "editor", "admin", "owner"];

export const localOwnerIdentity = {
  authenticated: true,
  userId: "local-archive-operator",
  userEmail: "archive-operator@creative-os.local",
  userName: "Archive operator",
  userRole: "owner",
  authMethod: "open-archive-tool",
};

export const normalizeRole = (roles) => {
  const valid = (Array.isArray(roles) ? roles : []).map((role) => String(role).toLowerCase()).filter((role) => ROLE_ORDER.includes(role));
  return valid.sort((a, b) => ROLE_ORDER.indexOf(b) - ROLE_ORDER.indexOf(a))[0] || "viewer";
};

const normalizeUser = (user) => {
  if (!user?.id && !user?.sub) return null;
  const metadata = user.user_metadata || {};
  const appMetadata = user.app_metadata || {};
  return {
    authenticated: true,
    userId: user.id || user.sub,
    userEmail: user.email || "",
    userName: metadata.full_name || metadata.name || user.email || "Employee",
    userRole: normalizeRole(appMetadata.roles),
    authMethod: "netlify-identity",
  };
};

export const resolveIdentity = async (request, context = {}, fetchImpl = globalThis.fetch) => {
  const trusted = context?.clientContext?.user || request?.clientContext?.user || request?.requestContext?.authorizer?.user;
  const normalized = normalizeUser(trusted);
  if (normalized) return normalized;

  const authorization = request?.headers?.authorization || request?.headers?.Authorization;
  if (!authorization?.startsWith("Bearer ")) return localOwnerIdentity;

  const host = request?.headers?.host || request?.headers?.Host;
  const protocol = request?.headers?.["x-forwarded-proto"] || "https";
  const rawUrl = request?.rawUrl || request?.url;
  const origin = rawUrl ? new URL(rawUrl).origin : host ? `${protocol}://${host}` : null;
  if (!origin) return { authenticated: false, userId: null, userEmail: null, userName: null, userRole: "viewer", authMethod: "none" };

  try {
    const response = await fetchImpl(`${origin}/.netlify/identity/user`, { headers: { authorization } });
    if (!response.ok) return localOwnerIdentity;
    return normalizeUser(await response.json()) || localOwnerIdentity;
  } catch {
    return localOwnerIdentity;
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
