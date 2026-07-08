export const DATABASE_ROLES = ["viewer", "contributor", "editor", "admin", "owner"];

export const databaseDisposition = ({ role, operationType, riskLevel = "low" }) => {
  if (!DATABASE_ROLES.includes(role) || role === "viewer") return { allowed: false, mode: "denied", reason: "Viewer accounts are read-only." };
  if (riskLevel === "high") return { allowed: true, mode: "review", reason: "High-risk canon, rights, public, legal, or source changes require explicit review." };
  if (operationType === "artifact_upload") return ["admin", "owner"].includes(role)
    ? { allowed: true, mode: "apply", reason: "Admin/owner upload applies immediately." }
    : { allowed: true, mode: "review", reason: "Employee upload requires admin/owner review." };
  if (["artifact_tag_update", "artifact_category_update", "artifact_metadata_update"].includes(operationType)) return ["editor", "admin", "owner"].includes(role)
    ? { allowed: true, mode: "apply", reason: "Low-risk metadata applies immediately for editor/admin/owner." }
    : { allowed: true, mode: "review", reason: "Contributor metadata is proposed for review." };
  if (operationType === "decision_resolution") return ["admin", "owner"].includes(role)
    ? { allowed: true, mode: "apply", reason: "Low-risk decision record applies immediately for admin/owner." }
    : { allowed: true, mode: "review", reason: "Decision resolution requires review for this role." };
  return ["admin", "owner"].includes(role)
    ? { allowed: true, mode: "apply", reason: "Privileged database operation." }
    : { allowed: true, mode: "review", reason: "Operation requires review." };
};

export const canViewArtifact = ({ role, visibility }) => visibility !== "private" || ["admin", "owner"].includes(role);
