import { mediaKind, slugify } from "./supabase.mjs";

const normalizeName = (value) => String(value || "").trim().toLowerCase().replaceAll("\\", "/").split("/").at(-1) || "";
const normalizePath = (value) => String(value || "").trim().replaceAll("\\", "/").replace(/^\.\//, "").toLowerCase();
const normalizeChecksum = (value) => String(value || "").trim().toLowerCase();
const baseSlug = (fileName) => slugify(normalizeName(fileName).replace(/\.[^.]+$/, ""));

export const matchArtifactForUpload = (artifacts, file = {}) => {
  const checksum = normalizeChecksum(file.checksumSha256);
  const relativePath = normalizePath(file.relativePath || file.originalPath);
  const fileName = normalizeName(file.fileName || file.originalFileName);
  const size = Number(file.fileSize || 0);
  const slug = baseSlug(fileName);
  const scored = (artifacts || []).flatMap((artifact) => {
    const provenance = artifact.provenance && typeof artifact.provenance === "object" ? artifact.provenance : {};
    const legacy = artifact.legacy_data && typeof artifact.legacy_data === "object" ? artifact.legacy_data : {};
    const artifactChecksum = normalizeChecksum(provenance.checksumSha256);
    const artifactPath = normalizePath(provenance.workspaceRelativePath || legacy.filePath);
    const artifactName = normalizeName(artifact.original_file_name || legacy.fileName || artifactPath);
    const artifactSize = Number(artifact.file_size || 0);
    let score = 0;
    let matchedBy = null;
    if (checksum && artifactChecksum && checksum === artifactChecksum) { score = 100; matchedBy = "checksum"; }
    else if (relativePath && artifactPath && relativePath === artifactPath) { score = 90; matchedBy = "original path"; }
    else if (fileName && artifactName && fileName === artifactName && size && artifactSize && size === artifactSize) { score = 80; matchedBy = "filename and size"; }
    else if (fileName && artifactName && fileName === artifactName) { score = 70; matchedBy = "filename"; }
    else if (slug && (artifact.slug === slug || slugify(artifact.id?.replace(/^artifact\./, "")) === slug)) { score = 50; matchedBy = "slug"; }
    return score ? [{ artifact, score, matchedBy, artifactChecksum, artifactName, artifactSize }] : [];
  }).sort((left, right) => right.score - left.score);
  if (!scored.length) return { artifact: null, matchedBy: null, duplicate: false, ambiguous: false, candidates: [] };
  const top = scored.filter((item) => item.score === scored[0].score);
  if (top.length > 1) return { artifact: null, matchedBy: top[0].matchedBy, duplicate: false, ambiguous: true, candidates: top.map((item) => item.artifact.id) };
  const match = top[0];
  const duplicate = match.artifact.file_status === "available" && (
    (checksum && match.artifactChecksum === checksum)
    || (fileName && match.artifactName === fileName && size && match.artifactSize === size)
  );
  return { artifact: match.artifact, matchedBy: match.matchedBy, duplicate, ambiguous: false, candidates: [match.artifact.id] };
};

const stable = (value) => {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
};

export const rowsEqual = (left, right, keys) => JSON.stringify(stable(Object.fromEntries(keys.map((key) => [key, left?.[key] ?? null])))) === JSON.stringify(stable(Object.fromEntries(keys.map((key) => [key, right?.[key] ?? null]))));

export const mergeStaticArtifact = (incoming, existing, profileId, manifestVersion) => {
  if (!existing) return { ...incoming, provenance: { ...(incoming.provenance || {}), repoManifestVersion: manifestVersion }, created_by: profileId, updated_by: profileId };
  const hasStoredFile = existing.file_status === "available" && existing.storage_bucket && existing.storage_path;
  return {
    ...incoming,
    rights_status: existing.rights_status || incoming.rights_status,
    canon_status: existing.canon_status || incoming.canon_status,
    review_status: existing.review_status || incoming.review_status,
    lifecycle_status: existing.lifecycle_status || incoming.lifecycle_status,
    visibility: existing.visibility || incoming.visibility,
    ...(hasStoredFile ? {
      storage_bucket: existing.storage_bucket,
      storage_path: existing.storage_path,
      original_file_name: existing.original_file_name || incoming.original_file_name,
      mime_type: existing.mime_type || incoming.mime_type,
      file_size: existing.file_size || incoming.file_size,
      file_status: "available",
    } : {}),
    provenance: { ...(incoming.provenance || {}), ...(existing.provenance || {}), repoManifestVersion: manifestVersion },
    created_by: existing.created_by || profileId,
    updated_by: profileId,
  };
};

export const summarizeImportStatus = ({ artifacts = [], batches = [], expectedFiles = [] }) => {
  const available = artifacts.filter((item) => item.file_status === "available");
  const duplicateGroups = new Map();
  for (const artifact of artifacts) {
    const checksum = normalizeChecksum(artifact.provenance?.checksumSha256);
    const nameSize = `${normalizeName(artifact.original_file_name)}:${Number(artifact.file_size || 0)}`;
    const key = checksum ? `checksum:${checksum}` : artifact.original_file_name && artifact.file_size ? `name-size:${nameSize}` : null;
    if (key) duplicateGroups.set(key, [...(duplicateGroups.get(key) || []), artifact.id]);
  }
  const duplicateWarnings = [...duplicateGroups.entries()].filter(([, ids]) => ids.length > 1).map(([key, artifactIds]) => ({ key, artifactIds }));
  const artifactById = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
  const expected = expectedFiles.map((file) => {
    const artifact = artifactById.get(file.artifactId);
    return { ...file, databaseRecordExists: Boolean(artifact), status: artifact?.file_status === "available" ? "available" : artifact ? "needs-upload" : "metadata-not-imported" };
  });
  return {
    totalArtifacts: artifacts.length,
    importedFiles: available.length,
    metadataOnly: artifacts.filter((item) => item.file_status === "metadata_only").length,
    filesNeedingUpload: artifacts.filter((item) => ["needs_import", "internal_only", "missing"].includes(item.file_status)).length,
    availableImages: available.filter((item) => mediaKind(item.mime_type, item.original_file_name) === "image").length,
    availablePdfs: available.filter((item) => mediaKind(item.mime_type, item.original_file_name) === "pdf").length,
    availableTextDocs: available.filter((item) => mediaKind(item.mime_type, item.original_file_name) === "text").length,
    duplicateWarnings,
    failedImports: batches.filter((item) => ["failed", "completed_with_errors"].includes(item.status)).length,
    recentBatches: batches,
    expectedFiles: expected,
  };
};
