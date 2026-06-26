export const artifactOrganization = Object.freeze({
  media: ["image", "pdf", "text", "markdown", "doc", "lore", "rules", "reference", "export", "other"],
  projects: [
    "creative-systems",
    "para-poker",
    "para-profiles",
    "gauntlet",
    "time-twister",
    "merch",
    "lore-pages",
    "achievement-cards",
    "unassigned",
  ],
  functions: [
    "lore-page",
    "profile-art",
    "profile-background",
    "card-art",
    "achievement",
    "badge",
    "sigil",
    "merch-design",
    "rules-reference",
    "game-data",
    "admin-doc",
    "marketing",
    "reference-only",
    "unassigned",
  ],
  rightsStatuses: [
    "internal-only",
    "public-safe",
    "unknown",
    "original",
    "ai-generated",
    "third-party-reference",
    "needs-review",
  ],
  reviewStatuses: ["needs-tagging", "needs-categorization", "needs-rights", "needs-review", "approved", "rejected"],
  canonStatuses: ["approved", "draft", "working", "deprecated", "conflict", "non-canon", "reference-only"],
  visibilities: ["private", "internal", "team", "public", "exportable"],
  workflowStatuses: ["uploaded", "imported", "needs-metadata", "categorized", "reviewed", "export-ready", "archived"],
  controlledTagTypes: ["medium", "project", "entity", "function", "rights", "review", "canon", "visibility", "workflow", "style"],
  starterFreeformTags: ["favorite", "possible-drop", "needs-case", "strong-direction", "weird", "revisit"],
  requiredFields: ["artifact_type", "rights_status", "review_status", "visibility", "lifecycle_status"],
  recommendedFields: ["project", "category", "related_entity", "intended_use"],
});

export function mediumForFile(fileName = "", mimeType = "") {
  const name = String(fileName).toLowerCase();
  const mime = String(mimeType).toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (name.endsWith(".md") || name.endsWith(".mdx") || mime === "text/markdown") return "markdown";
  if (mime.startsWith("text/") || /\.(txt|csv|json|ya?ml)$/i.test(name)) return "text";
  if (/\.(doc|docx|odt|rtf)$/i.test(name)) return "doc";
  return "other";
}

export function uploadDefaults(fileName = "", mimeType = "") {
  return {
    artifact_type: mediumForFile(fileName, mimeType),
    project: "unassigned",
    intended_use: "unassigned",
    rights_status: "needs-review",
    review_status: "needs-tagging",
    canon_status: "draft",
    visibility: "internal",
    lifecycle_status: "uploaded",
  };
}

export function controlledTagSlug(tagType, name) {
  return `${slugify(tagType)}-${slugify(name)}`;
}

export function slugify(value = "") {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
