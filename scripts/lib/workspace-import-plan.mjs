import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const slugify = (value) => String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "untitled";
const mimeFor = (name) => ({
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".svg": "image/svg+xml",
  ".pdf": "application/pdf", ".txt": "text/plain", ".md": "text/markdown", ".json": "application/json", ".csv": "text/csv", ".url": "text/plain",
  ".doc": "application/msword", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint", ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}[path.extname(name).toLowerCase()] || "application/octet-stream");
const typeFor = (mime) => mime.startsWith("image/") ? "image" : mime === "application/pdf" ? "pdf" : mime.startsWith("text/") ? "prose" : "other";
const checksum = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

export const buildWorkspaceImportPlan = ({ root, bucket = "artifacts" }) => {
  const sourceRoot = path.join(root, "Archive");
  if (!fs.existsSync(sourceRoot)) return { plan: [], warnings: ["Archive/ source folder was not found."], indexed: new Map() };
  const files = fs.readdirSync(sourceRoot, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath || entry.path, entry.name));
  const artifactDirectory = path.join(root, "src", "content", "artifacts");
  const indexed = new Map(fs.readdirSync(artifactDirectory).filter((name) => name.endsWith(".json")).map((name) => {
    const item = JSON.parse(fs.readFileSync(path.join(artifactDirectory, name), "utf8"));
    return [String(item.filePath || "").replaceAll("\\", "/").toLowerCase(), item];
  }));
  const relativeWorkspace = (file) => path.relative(root, file).replaceAll("\\", "/");
  const safeParts = (relative) => relative.split("/").map((part) => part.replace(/[^a-zA-Z0-9._ -]+/g, "-"));
  const immutableStoragePath = (relative, hash) => {
    const parts = safeParts(relative);
    const name = parts.pop();
    const extension = path.extname(name);
    const base = path.basename(name, extension);
    return ["workspace", ...parts, `${base}.${hash.slice(0, 12)}${extension}`].join("/");
  };

  const plan = files.map((file) => {
    const relative = relativeWorkspace(file);
    const legacy = indexed.get(relative.toLowerCase());
    const idHash = createHash("sha256").update(relative.toLowerCase()).digest("hex").slice(0, 12);
    const contentHash = checksum(file);
    const mime = mimeFor(file);
    const stat = fs.statSync(file);
    const title = legacy?.title || path.basename(file, path.extname(file)).replaceAll(/[_-]+/g, " ");
    const objectPath = immutableStoragePath(relative, contentHash);
    return {
      file,
      relative,
      checksum: contentHash,
      objectPath,
      artifact: {
        id: legacy?.id || `artifact.workspace.${idHash}`,
        title,
        slug: legacy ? slugify(legacy.id.replace(/^artifact\./, "")) : `${slugify(title)}-${idHash.slice(0, 6)}`,
        description: legacy?.notes || `Imported from ${relative}.`,
        artifact_type: legacy?.type || typeFor(mime),
        source_type: legacy?.sourceType || "workspace-folder-import",
        storage_bucket: bucket,
        storage_path: objectPath,
        original_file_name: path.basename(file),
        mime_type: mime,
        file_size: stat.size,
        file_status: "available",
        rights_status: legacy?.rightsStatus || "unknown-needs-review",
        canon_status: legacy?.canonStatus || "experimental",
        review_status: "needs-review",
        lifecycle_status: "imported",
        visibility: "internal",
        ai_generated: legacy?.aiGenerated ?? null,
        ai_model: legacy?.aiModel || null,
        prompt_used: legacy?.promptUsed || null,
        provenance: { workspaceRelativePath: relative, checksumSha256: contentHash, importedBy: "workspace-import-script" },
        legacy_data: legacy || { filePath: relative, generatedFromWorkspaceScan: true },
      },
    };
  });
  const warnings = plan.filter((item) => item.artifact.mime_type === "application/octet-stream").map((item) => `Unknown MIME type: ${item.relative}`);
  return { plan, warnings, indexed };
};

export const summarizeWorkspacePlan = ({ plan, indexed, warnings = [], mode = "dry-run", remoteById = new Map() }) => {
  const actionFor = (item) => {
    const remote = remoteById.get(item.artifact.id);
    if (!remote) return "create";
    if (remote.provenance?.checksumSha256 === item.checksum && remote.storage_path === item.objectPath) return "skip";
    return "update";
  };
  const actions = plan.map((item) => actionFor(item));
  return {
    mode,
    files: plan.length,
    images: plan.filter((item) => item.artifact.mime_type.startsWith("image/")).length,
    pdfs: plan.filter((item) => item.artifact.mime_type === "application/pdf").length,
    text: plan.filter((item) => item.artifact.mime_type.startsWith("text/")).length,
    alreadyIndexed: plan.filter((item) => indexed.has(item.relative.toLowerCase())).length,
    newArtifactRecords: actions.filter((action) => action === "create").length,
    updatedArtifactRecords: actions.filter((action) => action === "update").length,
    unchangedFilesSkipped: actions.filter((action) => action === "skip").length,
    filesWouldBeUploaded: actions.filter((action) => action !== "skip").length,
    warnings,
    visibility: "internal private bucket",
  };
};
