import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";

const slugify = (value) => String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "untitled";
const readJsonDirectory = (root, relative) => fs.readdirSync(path.join(root, relative)).filter((name) => name.endsWith(".json")).map((name) => JSON.parse(fs.readFileSync(path.join(root, relative, name), "utf8")));
const readMarkdownDirectory = (root, relative) => fs.readdirSync(path.join(root, relative)).filter((name) => name.endsWith(".md")).map((name) => ({ name, ...matter(fs.readFileSync(path.join(root, relative, name), "utf8")) }));
const riskLevel = (flags = []) => flags.some((flag) => /legal|rights|gambling|public|historical|mental-health/i.test(flag)) ? "high" : flags.length ? "medium" : "low";
const mimeFor = (name = "") => ({
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".svg": "image/svg+xml",
  ".pdf": "application/pdf", ".txt": "text/plain", ".md": "text/markdown", ".markdown": "text/markdown", ".json": "application/json", ".csv": "text/csv",
  ".doc": "application/msword", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint", ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}[path.extname(name).toLowerCase()] || "application/octet-stream");
const checksum = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

export const buildRepoMetadataManifest = (root) => {
  const artifactSources = readJsonDirectory(root, "src/content/artifacts");
  const archiveSources = readMarkdownDirectory(root, "src/content/archive");
  const artifacts = artifactSources.map((item) => {
    const relativePath = item.filePath ? String(item.filePath).replaceAll("\\", "/") : null;
    const filePath = relativePath ? path.resolve(root, relativePath) : null;
    const fileExists = Boolean(filePath && fs.existsSync(filePath));
    const fileChecksum = fileExists ? checksum(filePath) : null;
    const fileStatus = item.sourceUrl && !relativePath ? "external_only" : !relativePath ? "metadata_only" : fileExists ? "needs_import" : "missing";
    return {
      id: item.id,
      title: item.title,
      slug: slugify(item.id.replace(/^artifact\./, "")),
      description: item.notes || "",
      artifact_type: item.type || "other",
      source_type: item.sourceType || "legacy-static-content",
      storage_bucket: null,
      storage_path: null,
      original_file_name: item.fileName || (relativePath ? path.basename(relativePath) : null),
      mime_type: relativePath ? mimeFor(relativePath) : null,
      file_size: fileExists ? fs.statSync(filePath).size : null,
      file_status: fileStatus,
      external_url: item.sourceUrl || null,
      rights_status: item.rightsStatus || "unknown",
      canon_status: item.canonStatus || "experimental",
      review_status: item.reviewStatus || "needs-review",
      lifecycle_status: String(item.lifecycleStage || "imported").toLowerCase(),
      visibility: item.rightsStatus === "public-cleared" ? "public" : "internal",
      ai_generated: item.aiGenerated ?? null,
      ai_model: item.aiModel || null,
      prompt_used: item.promptUsed || null,
      provenance: {
        creator: item.creator || null,
        sourceUrl: item.sourceUrl || null,
        importedAt: item.importedAt || null,
        importBatch: item.importBatch || null,
        workspaceRelativePath: relativePath,
        checksumSha256: fileChecksum,
      },
      legacy_data: item,
    };
  });

  const archiveRecords = archiveSources.map(({ name, data, content }) => ({
    id: path.basename(name, ".md"),
    title: data.title || path.basename(name, ".md"),
    slug: slugify(path.basename(name, ".md")),
    type: data.entityType || "archive-record",
    summary: data.summary || "",
    body: content.trim(),
    canon_status: data.canonStatus || "experimental",
    review_status: (data.reviewFlags || []).length ? "needs-review" : "reviewed",
    risk_level: riskLevel(data.riskFlags || data.reviewFlags || []),
    source_data: data,
  }));

  const backlog = fs.readFileSync(path.join(root, "REMEDIATION_BACKLOG.md"), "utf8");
  const decisionPattern = /^###\s+([A-Z]{2,4}-\d+)\s+\u2014\s+(.+?)\r?\n([\s\S]*?)(?=^###\s+|^##\s+|(?![\s\S]))/gm;
  const value = (block, label) => block.match(new RegExp(`^- \\*\\*${label}:\\*\\*\\s*(.+)$`, "mi"))?.[1]?.trim() || "";
  const decisions = [...backlog.matchAll(decisionPattern)].map((match) => {
    const id = match[1];
    const title = match[2];
    const block = match[3];
    const priority = value(block, "Priority");
    return {
      id,
      title,
      slug: slugify(id),
      issue_summary: value(block, "Problem"),
      why_it_matters: value(block, "Why it matters"),
      recommended_fix: value(block, "Recommended fix"),
      status: "open",
      risk_level: /critical/i.test(priority) ? "high" : /high/i.test(priority) ? "medium" : "low",
      source_data: { priority, affected: value(block, "Affected concepts/files"), output: value(block, "Output needed"), workType: value(block, "Work type"), needsDecision: value(block, "Needs user decision before proceeding") },
    };
  });

  const tags = [...new Set(artifactSources.flatMap((item) => item.tags || []))].map((name) => ({ name, slug: slugify(name) }));
  const artifactTags = artifactSources.flatMap((item) => (item.tags || []).map((name) => ({ artifact_id: item.id, tag_slug: slugify(name) })));
  const categoryNames = [...new Set(artifactSources.map((item) => item.type).filter(Boolean))];
  const categories = categoryNames.map((name) => ({ name, slug: slugify(name) }));
  const artifactCategories = artifactSources.filter((item) => item.type).map((item) => ({ artifact_id: item.id, category_slug: slugify(item.type) }));
  const archiveIds = new Set(archiveRecords.map((record) => record.id));
  const relationships = artifactSources.flatMap((item) => (item.relatedArchiveRecords || []).filter((id) => archiveIds.has(id)).map((archiveRecordId) => ({ artifact_id: item.id, archive_record_id: archiveRecordId, relationship_type: "references", notes: "Imported from static artifact metadata." })));
  const artifactById = new Map(artifacts.map((item) => [item.id, item]));
  const expectedFiles = artifactSources.filter((item) => item.filePath).map((item) => {
    const artifact = artifactById.get(item.id);
    return {
      artifactId: item.id,
      title: item.title,
      originalFileName: artifact.original_file_name,
      originalPath: artifact.provenance.workspaceRelativePath,
      checksumSha256: artifact.provenance.checksumSha256,
      fileSize: artifact.file_size,
      mimeType: artifact.mime_type,
      filePresentInBuildWorkspace: artifact.file_status === "needs_import",
    };
  });
  const core = { artifacts, archiveRecords, decisions, tags, artifactTags, categories, artifactCategories, relationships, expectedFiles };
  const version = createHash("sha256").update(JSON.stringify(core)).digest("hex").slice(0, 16);
  return {
    schemaVersion: "1.0",
    version,
    generatedAt: new Date().toISOString(),
    counts: Object.fromEntries(Object.entries(core).map(([name, rows]) => [name, rows.length])),
    ...core,
  };
};
