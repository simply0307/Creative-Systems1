const MEDIA_VALUES = new Set(["image", "pdf", "text", "markdown", "doc"]);
const REQUIRED_METADATA = ["artifact_type", "rights_status", "review_status", "visibility", "lifecycle_status"];

export const artifactFilterAliases = Object.freeze({
  medium: "artifact_type",
  file_type: "artifact_type",
  workflow: "lifecycle_status",
  workflow_status: "lifecycle_status",
  review_state: "review_status",
  category_id: "category",
  category_slug: "category",
  tags: "tag",
  tag_slug: "tag",
  function: "intended_use",
  file_availability: "file",
});

const text = (value) => String(value ?? "").trim();
const lower = (value) => text(value).toLowerCase();

export function normalizeArtifactFilters(filters = {}) {
  const normalized = {};
  const entries = filters instanceof URLSearchParams ? [...filters.entries()] : Object.entries(filters);
  for (const [rawKey, rawValue] of entries) {
    const key = artifactFilterAliases[rawKey] || rawKey;
    const value = text(rawValue);
    if (value) normalized[key] = value;
  }
  return normalized;
}

export function effectiveArtifactType(artifact = {}) {
  const mime = lower(artifact.mime_type);
  const name = lower(artifact.original_file_name || artifact.storage_path);
  if (mime.startsWith("image/") || /\.(png|jpe?g|gif|webp|avif|svg)$/.test(name)) return "image";
  if (mime === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (mime === "text/markdown" || /\.(md|markdown|mdx)$/.test(name)) return "markdown";
  if (mime.startsWith("text/") || /\.(txt|csv|json|ya?ml)$/.test(name)) return "text";
  if (/\.(doc|docx|odt|rtf)$/.test(name)) return "doc";
  return lower(artifact.artifact_type) || "other";
}

const relationMatch = (items, expected, keys) => {
  const needle = lower(expected);
  return (items || []).some((item) => keys.some((key) => lower(item?.[key]) === needle));
};

export function artifactMatchesFilters(artifact, rawFilters = {}) {
  const filters = normalizeArtifactFilters(rawFilters);
  const selectedType = lower(filters.artifact_type);
  if (selectedType) {
    const actual = MEDIA_VALUES.has(selectedType) ? effectiveArtifactType(artifact) : lower(artifact.artifact_type);
    if (actual !== selectedType) return false;
  }

  for (const field of ["project", "intended_use", "rights_status", "review_status", "canon_status", "visibility", "lifecycle_status", "file_status"]) {
    if (filters[field] && lower(artifact[field]) !== lower(filters[field])) return false;
  }

  if (filters.file) {
    if (filters.file === "preview" && !artifact.fileAvailable) return false;
    else if (filters.file !== "preview" && lower(artifact.file_status) !== lower(filters.file)) return false;
  }
  if (filters.category && !relationMatch(artifact.categories, filters.category, ["id", "slug", "name"])) return false;
  if (filters.entity && !relationMatch(artifact.archiveRecords, filters.entity, ["id", "slug", "title"])) return false;
  if (filters.tag && !relationMatch(artifact.tags, filters.tag, ["id", "slug", "name"])) return false;
  if (filters.controlled_tag && !(artifact.tags || []).some((tag) => tag.tag_type !== "freeform" && relationMatch([tag], filters.controlled_tag, ["id", "slug", "name"]))) return false;
  if (filters.freeform_tag && !(artifact.tags || []).some((tag) => tag.tag_type === "freeform" && relationMatch([tag], filters.freeform_tag, ["id", "slug", "name"]))) return false;

  const missingMetadata = REQUIRED_METADATA.some((field) => !artifact[field] || ["unknown", "needs-review"].includes(lower(artifact[field])));
  if (filters.metadata === "needs" && !missingMetadata) return false;
  if (filters.metadata === "complete" && missingMetadata) return false;

  if (filters.search) {
    const haystack = [
      artifact.title,
      artifact.description,
      artifact.original_file_name,
      artifact.notes,
      ...(artifact.tags || []).map((item) => item.name),
      ...(artifact.categories || []).map((item) => item.name),
      ...(artifact.archiveRecords || []).map((item) => item.title),
    ].map(lower).join(" ");
    if (!haystack.includes(lower(filters.search))) return false;
  }
  return true;
}

export const filterArtifacts = (artifacts = [], filters = {}) => artifacts.filter((artifact) => artifactMatchesFilters(artifact, filters));
