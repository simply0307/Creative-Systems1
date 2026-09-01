import { ROLE_ORDER } from "../../../netlify/functions/lib/identity.mjs";
import { resolveNetlifyIdentity } from "../../../netlify/functions/lib/netlify-identity-provider.mjs";
import { authorizeCreativeOsRoute, classifyCreativeOsRoute } from "../../../netlify/functions/lib/authorization.mjs";
import { databaseDisposition } from "../../../netlify/functions/lib/database-policy.mjs";
import { artifactOrganization, uploadDefaults } from "../../data/artifact-organization.mjs";
import { normalizeArtifactFilters } from "../../lib/artifact-filters.mjs";
import { matchArtifactForUpload, mergeStaticArtifact, rowsEqual, summarizeImportStatus } from "../../../netlify/functions/lib/import-tools.mjs";
import { runtimeEnvironment } from "../runtime/runtime-environment.mjs";
import {
  CANONICAL_SUPABASE_PROJECT_REF,
  CREATIVE_OS_MUTATION_AUTHORITY,
  CREATIVE_OS_SCHEMA_CONTRACT_VERSION,
  getRuntimeReadiness,
  REQUIRED_STORAGE_BUCKETS,
  runRuntimeReadiness,
} from "../../../netlify/functions/lib/runtime-contract.mjs";
import {
  applyCategoryChange,
  applyTagChange,
  applyTypedTagChange,
  artifactSelect,
  ensureCategories,
  ensureProfile,
  ensureTypedTags,
  getArtifact,
  getArtifactMetadata,
  getSupabaseAdmin,
  loadLocalOwnerProfile,
  mapWithConcurrency,
  requireData,
  safeFileName,
  signArtifactPreviews,
  slugify,
  syncControlledTag,
  supabaseConfig,
  writeAudit,
} from "../../../netlify/functions/lib/supabase.mjs";

// Reath recovery deliberately excludes generated repository-import manifests.
// Keep the historical API import routes inert instead of rebuilding an Archive
// catalog from unrelated source material.
const repoImportManifest = Object.freeze({
  version: "reath-recovery-retired",
  counts: Object.freeze({
    artifacts: 0,
    archiveRecords: 0,
    decisions: 0,
    tags: 0,
    categories: 0,
    artifactTags: 0,
    artifactCategories: 0,
    relationships: 0,
    expectedFiles: 0,
    archiveFiles: 0,
    archiveFolders: 0,
  }),
  artifacts: Object.freeze([]),
  archiveRecords: Object.freeze([]),
  decisions: Object.freeze([]),
  tags: Object.freeze([]),
  categories: Object.freeze([]),
  artifactTags: Object.freeze([]),
  artifactCategories: Object.freeze([]),
  relationships: Object.freeze([]),
  expectedFiles: Object.freeze([]),
  archiveFiles: Object.freeze([]),
  archiveFolders: Object.freeze([]),
});

const headers = { "content-type": "application/json", "cache-control": "no-store" };
const json = (status, body) => Response.json(body, { status, headers });
const roleAtLeast = (role, minimum) => ROLE_ORDER.indexOf(role) >= ROLE_ORDER.indexOf(minimum);
const privileged = (role) => ["admin", "owner"].includes(role);
const asArray = (value) => Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
const cleanObject = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};
export { REQUIRED_STORAGE_BUCKETS };
export const DEFAULT_ARTIFACT_PAGE_SIZE = 24;
export const MAX_ARTIFACT_PAGE_SIZE = 50;
export const MAX_BULK_ORGANIZATION_ITEMS = 25;
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

const normalizeFolderPath = (value = "Archive") => {
  const parts = String(value || "Archive")
    .replaceAll("\\", "/")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
  if (!parts.length || parts[0].toLowerCase() !== "archive") parts.unshift("Archive");
  return parts.join("/");
};

const folderSegments = (folderPath) => normalizeFolderPath(folderPath).split("/").filter(Boolean);
const folderTagValues = (folderPath) => folderSegments(folderPath).map((name) => ({ name, tagType: "folder" }));
const folderFromRelativeFilePath = (value = "") => {
  const parts = String(value || "").replaceAll("\\", "/").split("/").map((part) => part.trim()).filter(Boolean);
  if (parts.length <= 1) return "Archive";
  return normalizeFolderPath(parts.slice(0, -1).join("/"));
};

const ensureArchiveFolderTaxonomy = async (supabase, folderPaths = []) => {
  const paths = [...new Set(folderPaths.map(normalizeFolderPath).filter(Boolean))];
  const categories = await ensureCategories(supabase, paths);
  const tags = await ensureTypedTags(supabase, [...new Map(paths.flatMap(folderTagValues).map((tag) => [`${tag.tagType}:${slugify(tag.name)}`, tag])).values()]);
  return {
    categories,
    tags,
    categoryByPath: new Map(categories.map((category) => [category.name, category])),
    tagByName: new Map(tags.map((tag) => [tag.name.toLowerCase(), tag])),
  };
};

const assignArtifactFolder = async (supabase, { artifact, artifactId, folderPath, profile, runtime, updateReason = "indexed" }) => {
  const before = artifact || await getArtifact(supabase, artifactId);
  const normalizedFolderPath = normalizeFolderPath(folderPath);
  const taxonomy = await ensureArchiveFolderTaxonomy(supabase, [normalizedFolderPath]);
  const category = taxonomy.categoryByPath.get(normalizedFolderPath);
  const folderTagIds = [...new Set(folderSegments(normalizedFolderPath)
    .map((segment) => taxonomy.tagByName.get(segment.toLowerCase())?.id)
    .filter(Boolean))];

  const currentFolderCategoryIds = before.categories
    .filter((item) => item.name === "Archive" || String(item.name || "").startsWith("Archive/"))
    .map((item) => item.id);
  if (currentFolderCategoryIds.length) {
    requireData(await supabase.from("artifact_categories").delete().eq("artifact_id", before.id).in("category_id", currentFolderCategoryIds), "Clear old folder categories");
  }

  const currentFolderTagIds = before.tags.filter((tag) => tag.tag_type === "folder").map((tag) => tag.id);
  if (currentFolderTagIds.length) {
    requireData(await supabase.from("artifact_tags").delete().eq("artifact_id", before.id).in("tag_id", currentFolderTagIds), "Clear old folder tags");
  }

  if (category) {
    requireData(await supabase.from("artifact_categories").upsert({ artifact_id: before.id, category_id: category.id, created_by: profile.id }, { onConflict: "artifact_id,category_id" }), "Assign new folder category");
  }
  if (folderTagIds.length) {
    requireData(await supabase.from("artifact_tags").upsert(folderTagIds.map((tagId) => ({ artifact_id: before.id, tag_id: tagId, created_by: profile.id })), { onConflict: "artifact_id,tag_id", ignoreDuplicates: true }), "Assign new folder tags");
  }

  const fileName = before.original_file_name || safeFileName(before.title || "file");
  const indexedPath = `${normalizedFolderPath}/${fileName}`;
  const originalWorkspaceRelativePath = before.provenance?.originalWorkspaceRelativePath
    || before.provenance?.workspaceRelativePath
    || before.legacy_data?.filePath
    || null;
  const provenance = {
    ...(before.provenance || {}),
    originalFolder: before.provenance?.originalFolder || before.provenance?.folder || (originalWorkspaceRelativePath ? folderFromRelativeFilePath(originalWorkspaceRelativePath) : null),
    originalWorkspaceRelativePath,
    folder: normalizedFolderPath,
    indexedPath,
    [`${updateReason}InArchiveIndexAt`]: runtime.now().toISOString(),
  };
  const legacy_data = {
    ...(before.legacy_data || {}),
    folder: normalizedFolderPath,
    filePath: indexedPath,
    virtualFolderMove: updateReason === "moved",
  };
  requireData(await supabase.from("artifacts").update({ provenance, legacy_data, updated_by: profile.id }).eq("id", before.id), "Assign artifact folder in Archive Index");
  return { before, after: await getArtifact(supabase, before.id), folderPath: normalizedFolderPath, indexedPath, category, folderTagIds };
};

const routePath = (request) => {
  const url = new URL(request.url);
  const splat = url.searchParams.get("splat");
  if (splat !== null) return splat.replace(/^\/+|\/+$/g, "") || "health";
  return url.pathname.replace(/^\/(?:api\/creative-os|\.netlify\/functions\/creative-os)\/?/, "").replace(/\/+$/g, "") || "health";
};

const bodyJson = async (request) => {
  try { return cleanObject(await request.json()); }
  catch { throw Object.assign(new Error("A valid JSON request body is required."), { status: 400 }); }
};

const requireRole = (identity, minimum = "contributor") => {
  if (!identity.authenticated) throw Object.assign(new Error("Log in with a Creative OS employee account."), { status: 401 });
  if (!roleAtLeast(identity.userRole, minimum)) throw Object.assign(new Error(`This action requires ${minimum} authority or higher.`), { status: 403 });
};

const createReviewRequest = async (supabase, profile, request) => requireData(await supabase.from("review_requests").insert({
  operation_type: request.operationType,
  target_type: request.targetType || "artifact",
  target_id: request.targetId || null,
  submitted_by: profile.id,
  status: "pending_review",
  risk_level: request.riskLevel || "low",
  intent_summary: request.intentSummary,
  reason: request.reason || "",
  before_snapshot: request.beforeSnapshot || {},
  after_snapshot: request.afterSnapshot || {},
  affected_artifacts: request.affectedArtifacts || [],
  affected_records: request.affectedRecords || [],
  affected_files: request.affectedFiles || [],
}).select("*, submitted_by_profile:profiles!review_requests_submitted_by_fkey(id,email,display_name,role)").single(), "Create review request");

const operationResult = ({ identity, mode, message, riskLevel = "low", audit = null, review = null, artifact = null, extra = {} }) => ({
  ok: true,
  accepted: true,
  committed: mode === "database-applied",
  mode,
  persistence: mode === "database-applied" ? "supabase-canonical" : "supabase-review-request",
  authenticated: identity.authenticated,
  userId: identity.userId,
  userEmail: identity.userEmail,
  userName: identity.userName,
  userRole: identity.userRole,
  roleSource: "Netlify Identity app_metadata.roles",
  approvalMode: mode === "database-applied" ? `${identity.userRole}-applied` : "pending-review",
  riskLevel,
  databaseConfigured: true,
  databaseWriteAttempted: true,
  databaseWriteApplied: mode === "database-applied",
  githubWriteAttempted: false,
  reviewRequestId: review?.id || null,
  auditEventId: audit?.id || null,
  artifact,
  message,
  ...extra,
});

export const runSetupHealthCheck = runRuntimeReadiness;

const listArtifacts = async (supabase, identity, searchParams = new URLSearchParams()) => {
  const filters = normalizeArtifactFilters(searchParams);
  const page = Number(searchParams.get("page") || 1);
  const limit = Number(searchParams.get("limit") || DEFAULT_ARTIFACT_PAGE_SIZE);
  if (!Number.isInteger(page) || page < 1) throw Object.assign(new Error("Artifact page must be a positive integer."), { status: 400 });
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_ARTIFACT_PAGE_SIZE) throw Object.assign(new Error(`Artifact limit must be between 1 and ${MAX_ARTIFACT_PAGE_SIZE}.`), { status: 400 });
  delete filters.page;
  delete filters.limit;
  const data = requireData(await supabase.rpc("creative_os_list_artifacts_page", {
    p_filters: filters,
    p_include_private: privileged(identity.userRole),
    p_limit: limit,
    p_offset: (page - 1) * limit,
  }, { get: true }), "Load artifact page");
  const total = Number(data?.total || 0);
  const artifacts = await signArtifactPreviews(supabase, data?.rows || []);
  return {
    artifacts,
    indexedRefs: data?.indexedRefs || [],
    summary: data?.summary || { available: 0, needs_import: 0 },
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      hasPrevious: page > 1,
      hasNext: page * limit < total,
      order: "updated_at.desc,id.asc",
    },
  };
};

const uploadCandidateFields = "id,title,slug,description,artifact_type,project,intended_use,notes,source_type,storage_bucket,storage_path,original_file_name,mime_type,file_size,file_status,rights_status,canon_status,review_status,lifecycle_status,visibility,ai_generated,ai_model,prompt_used,provenance,legacy_data,created_by,updated_by";
const loadUploadCandidates = async (supabase) => requireData(await supabase.from("artifacts").select(uploadCandidateFields), "Load upload matches");
const uploadMatch = async (supabase, body) => matchArtifactForUpload(await loadUploadCandidates(supabase), {
  fileName: body.fileName || body.originalFileName,
  fileSize: body.fileSize,
  checksumSha256: body.checksumSha256,
  relativePath: body.relativePath || body.originalPath,
});

const valueKeyByTagType = {
  medium: "media",
  project: "projects",
  function: "functions",
  rights: "rightsStatuses",
  review: "reviewStatuses",
  canon: "canonStatuses",
  visibility: "visibilities",
  workflow: "workflowStatuses",
};

const artifactFieldByTagType = {
  medium: "artifact_type",
  project: "project",
  function: "intended_use",
  rights: "rights_status",
  review: "review_status",
  canon: "canon_status",
  visibility: "visibility",
  workflow: "lifecycle_status",
};

const loadOrganizationOptions = async (supabase) => {
  const [tagResult, categoryResult, archiveResult, tagLinkResult, categoryLinkResult] = await Promise.all([
    supabase.from("tags").select("id,name,slug,tag_type,description,is_active,created_at,updated_at").order("tag_type").order("name"),
    supabase.from("categories").select("id,name,slug,parent_id,description,is_active,created_at,updated_at").order("name"),
    supabase.from("archive_records").select("id,title,slug,type,canon_status,review_status").order("title").limit(1000),
    supabase.from("artifact_tags").select("tag_id"),
    supabase.from("artifact_categories").select("category_id"),
  ]);
  const tagUsage = new Map();
  for (const link of requireData(tagLinkResult, "Load tag usage")) tagUsage.set(link.tag_id, (tagUsage.get(link.tag_id) || 0) + 1);
  const categoryUsage = new Map();
  for (const link of requireData(categoryLinkResult, "Load category usage")) categoryUsage.set(link.category_id, (categoryUsage.get(link.category_id) || 0) + 1);
  const allTags = requireData(tagResult, "Load organization tags").map((tag) => ({ ...tag, usageCount: tagUsage.get(tag.id) || 0 }));
  const allCategories = requireData(categoryResult, "Load organization categories").map((category) => ({ ...category, usageCount: categoryUsage.get(category.id) || 0 }));
  const activeTags = allTags.filter((tag) => tag.is_active !== false);
  const values = { ...artifactOrganization };
  for (const [tagType, key] of Object.entries(valueKeyByTagType)) {
    const names = activeTags.filter((tag) => tag.tag_type === tagType).map((tag) => tag.name);
    if (names.length) values[key] = names;
  }
  return {
    values,
    tags: activeTags,
    categories: allCategories.filter((category) => category.is_active !== false),
    managedTags: allTags,
    managedCategories: allCategories,
    archiveRecords: requireData(archiveResult, "Load archive record options"),
  };
};

const findCaseInsensitiveDuplicate = async (supabase, table, name, { id = null, tagType = null } = {}) => {
  const candidateSlug = tagType ? `${slugify(tagType)}-${slugify(name)}` : slugify(name);
  let query = supabase.from(table).select("id,name,slug,is_active").eq("slug", candidateSlug);
  if (id) query = query.neq("id", id);
  return requireData(await query.limit(1), `Check duplicate ${table}`)[0] || null;
};

const handleCreateControlledValue = async ({ request, supabase, identity, profile, kind }) => {
  requireRole(identity, "admin");
  const body = await bodyJson(request);
  const name = String(body.name || "").trim();
  if (!name) throw Object.assign(new Error("A controlled value name is required."), { status: 400 });
  const table = kind === "categories" ? "categories" : kind === "tags" ? "tags" : null;
  if (!table) throw Object.assign(new Error("Controlled value type must be categories or tags."), { status: 404 });
  const tagType = table === "tags" ? String(body.tagType || "freeform").trim().toLowerCase() : null;
  if (tagType && ![...artifactOrganization.controlledTagTypes, "freeform"].includes(tagType)) throw Object.assign(new Error("Unsupported tag family."), { status: 400 });
  const duplicate = await findCaseInsensitiveDuplicate(supabase, table, name, { tagType });
  if (duplicate) throw Object.assign(new Error(`${duplicate.name} already exists${duplicate.is_active === false ? " but is archived; reactivate it instead" : ""}.`), { status: 409 });
  const row = table === "tags"
    ? { name, slug: `${slugify(tagType)}-${slugify(name)}`, tag_type: tagType, description: String(body.description || ""), is_active: true }
    : { name, slug: slugify(name), description: String(body.description || ""), is_active: true };
  const created = requireData(await supabase.from(table).insert(row).select().single(), `Create ${kind}`);
  const singular = table === "tags" ? "tag" : "category";
  const audit = await writeAudit(supabase, profile, { actionType: `${singular}_created`, targetType: "controlled_value", targetId: created.id, intentSummary: `Create ${tagType ? `${tagType} tag` : "category"} ${name}.`, reason: String(body.reason || "Controlled value management"), beforeSnapshot: {}, afterSnapshot: created, result: "applied" });
  return json(201, { ok: true, value: created, auditEventId: audit.id, message: `${name} created and available in selectors.` });
};

const handleUpdateControlledValue = async ({ request, supabase, identity, profile, kind, valueId, runtime }) => {
  requireRole(identity, "admin");
  const body = await bodyJson(request);
  const table = kind === "categories" ? "categories" : kind === "tags" ? "tags" : null;
  if (!table) throw Object.assign(new Error("Controlled value type must be categories or tags."), { status: 404 });
  const before = requireData(await supabase.from(table).select("*").eq("id", valueId).single(), `Load ${kind} value`);
  const name = body.name === undefined ? before.name : String(body.name || "").trim();
  if (!name) throw Object.assign(new Error("A controlled value name is required."), { status: 400 });
  const duplicate = await findCaseInsensitiveDuplicate(supabase, table, name, { id: valueId, tagType: table === "tags" ? before.tag_type : null });
  if (duplicate) throw Object.assign(new Error(`${duplicate.name} already exists.`), { status: 409 });
  const changes = {
    name,
    slug: table === "tags" ? `${slugify(before.tag_type)}-${slugify(name)}` : slugify(name),
    is_active: body.isActive === undefined ? before.is_active : Boolean(body.isActive),
    updated_at: runtime.now().toISOString(),
  };
  if (body.description !== undefined) changes.description = String(body.description || "");
  if (table === "tags" && name !== before.name && artifactFieldByTagType[before.tag_type]) {
    requireData(await supabase.from("artifacts").update({ [artifactFieldByTagType[before.tag_type]]: name, updated_by: profile.id }).eq(artifactFieldByTagType[before.tag_type], before.name), `Rename ${before.tag_type} metadata values`);
  }
  const updated = requireData(await supabase.from(table).update(changes).eq("id", valueId).select().single(), `Update ${kind} value`);
  const action = changes.is_active === false ? "archived" : before.is_active === false && changes.is_active ? "reactivated" : "renamed";
  const singular = table === "tags" ? "tag" : "category";
  const audit = await writeAudit(supabase, profile, { actionType: `${singular}_${action}`, targetType: "controlled_value", targetId: valueId, intentSummary: `${action[0].toUpperCase()}${action.slice(1)} ${before.name}${name !== before.name ? ` to ${name}` : ""}.`, reason: String(body.reason || "Controlled value management"), beforeSnapshot: before, afterSnapshot: updated, result: "applied" });
  return json(200, { ok: true, value: updated, auditEventId: audit.id, message: `${updated.name} ${action}; existing artifact relationships were preserved.` });
};

const syncManifestRows = async ({ supabase, table, incoming, idKey = "id", compareKeys, mapRow = (row) => row }) => {
  const ids = incoming.map((row) => row[idKey]);
  const existingRows = ids.length ? requireData(await supabase.from(table).select("*").in(idKey, ids), `Load existing ${table}`) : [];
  const existing = new Map(existingRows.map((row) => [row[idKey], row]));
  const changed = [];
  let created = 0;
  let updated = 0;
  let skipped = 0;
  for (const source of incoming) {
    const before = existing.get(source[idKey]);
    const row = mapRow(source, before);
    if (!before) { created += 1; changed.push(row); }
    else if (rowsEqual(row, before, compareKeys)) skipped += 1;
    else { updated += 1; changed.push(row); }
  }
  if (changed.length) requireData(await supabase.from(table).upsert(changed, { onConflict: idKey }), `Upsert ${table}`);
  return { created, updated, skipped };
};

const syncManifestLinks = async ({ supabase, table, incoming, select, key, onConflict }) => {
  const existingRows = requireData(await supabase.from(table).select(select), `Load existing ${table}`);
  const existing = new Set(existingRows.map(key));
  const missing = incoming.filter((row) => !existing.has(key(row)));
  if (missing.length) requireData(await supabase.from(table).upsert(missing, { onConflict, ignoreDuplicates: true }), `Attach ${table}`);
  return { created: missing.length, updated: 0, skipped: incoming.length - missing.length };
};

const handleRepoMetadataImport = async ({ supabase, identity, profile, runtime }) => {
  requireRole(identity, "admin");
  const batchId = runtime.randomUUID();
  const source = `repo-static-manifest:${repoImportManifest.version}`;
  requireData(await supabase.from("import_batches").insert({
    id: batchId,
    title: `Repo metadata import ${repoImportManifest.version}`,
    source,
    status: "in_progress",
    created_by: profile.id,
    manifest: { kind: "repo-static-metadata", version: repoImportManifest.version, expected: repoImportManifest.counts },
  }), "Create repo metadata import batch");
  try {
    const artifactKeys = ["id", "title", "slug", "description", "artifact_type", "source_type", "storage_bucket", "storage_path", "original_file_name", "mime_type", "file_size", "file_status", "external_url", "rights_status", "canon_status", "review_status", "lifecycle_status", "visibility", "ai_generated", "ai_model", "prompt_used", "provenance", "legacy_data"];
    const archiveKeys = ["id", "title", "slug", "type", "summary", "body", "canon_status", "review_status", "risk_level", "source_data"];
    const decisionKeys = ["id", "title", "slug", "issue_summary", "why_it_matters", "recommended_fix", "status", "risk_level", "source_data"];
    const results = {};
    results.artifacts = await syncManifestRows({ supabase, table: "artifacts", incoming: repoImportManifest.artifacts, compareKeys: artifactKeys, mapRow: (row, existing) => mergeStaticArtifact(row, existing, profile.id, repoImportManifest.version) });
    results.archiveRecords = await syncManifestRows({ supabase, table: "archive_records", incoming: repoImportManifest.archiveRecords, compareKeys: archiveKeys, mapRow: (row, existing) => existing ? { ...row, canon_status: existing.canon_status, review_status: existing.review_status } : row });
    results.decisions = await syncManifestRows({ supabase, table: "decisions", incoming: repoImportManifest.decisions, compareKeys: decisionKeys, mapRow: (row, existing) => existing ? { ...row, status: existing.status } : row });
    results.tags = await syncManifestRows({ supabase, table: "tags", incoming: repoImportManifest.tags, idKey: "slug", compareKeys: ["name", "slug"] });
    results.categories = await syncManifestRows({ supabase, table: "categories", incoming: repoImportManifest.categories, idKey: "slug", compareKeys: ["name", "slug"] });

    const tags = requireData(await supabase.from("tags").select("id,slug").in("slug", repoImportManifest.tags.map((item) => item.slug)), "Load imported tags");
    const tagBySlug = new Map(tags.map((tag) => [tag.slug, tag.id]));
    const artifactTags = repoImportManifest.artifactTags.map((item) => ({ artifact_id: item.artifact_id, tag_id: tagBySlug.get(item.tag_slug), created_by: profile.id })).filter((item) => item.tag_id);
    results.artifactTags = await syncManifestLinks({ supabase, table: "artifact_tags", incoming: artifactTags, select: "artifact_id,tag_id", key: (row) => `${row.artifact_id}:${row.tag_id}`, onConflict: "artifact_id,tag_id" });
    const categories = requireData(await supabase.from("categories").select("id,slug").in("slug", repoImportManifest.categories.map((item) => item.slug)), "Load imported categories");
    const categoryBySlug = new Map(categories.map((category) => [category.slug, category.id]));
    const artifactCategories = repoImportManifest.artifactCategories.map((item) => ({ artifact_id: item.artifact_id, category_id: categoryBySlug.get(item.category_slug), created_by: profile.id })).filter((item) => item.category_id);
    results.artifactCategories = await syncManifestLinks({ supabase, table: "artifact_categories", incoming: artifactCategories, select: "artifact_id,category_id", key: (row) => `${row.artifact_id}:${row.category_id}`, onConflict: "artifact_id,category_id" });
    const relationships = repoImportManifest.relationships.map((item) => ({ ...item, created_by: profile.id }));
    results.relationships = await syncManifestLinks({ supabase, table: "artifact_archive_records", incoming: relationships, select: "artifact_id,archive_record_id,relationship_type", key: (row) => `${row.artifact_id}:${row.archive_record_id}:${row.relationship_type}`, onConflict: "artifact_id,archive_record_id,relationship_type" });
    const totals = Object.values(results).reduce((sum, item) => ({ created: sum.created + item.created, updated: sum.updated + item.updated, skipped: sum.skipped + item.skipped }), { created: 0, updated: 0, skipped: 0 });
    requireData(await supabase.from("import_batches").update({ status: "applied", manifest: { kind: "repo-static-metadata", version: repoImportManifest.version, expected: repoImportManifest.counts, results, totals } }).eq("id", batchId), "Complete repo metadata import batch");
    const audit = await writeAudit(supabase, profile, {
      actionType: "repo_metadata_import",
      targetType: "import_batch",
      targetId: batchId,
      intentSummary: `Import existing repo metadata manifest ${repoImportManifest.version}.`,
      reason: "Admin/owner browser import of deployed Creative Systems metadata",
      beforeSnapshot: {},
      afterSnapshot: { manifestVersion: repoImportManifest.version, results, totals, sourceFilesChanged: false },
      result: "applied",
    });
    return json(200, operationResult({ identity, profile, mode: "database-applied", audit, message: `${totals.created} records/links created, ${totals.updated} updated, ${totals.skipped} already current. File bytes were not changed.`, extra: { importBatchId: batchId, manifestVersion: repoImportManifest.version, counts: repoImportManifest.counts, results, totals } }));
  } catch (error) {
    await supabase.from("import_batches").update({ status: "failed", manifest: { kind: "repo-static-metadata", version: repoImportManifest.version, error: error.message } }).eq("id", batchId);
    await writeAudit(supabase, profile, { actionType: "repo_metadata_import_failed", targetType: "import_batch", targetId: batchId, intentSummary: "Import existing repo metadata.", reason: error.message, beforeSnapshot: {}, afterSnapshot: { error: error.message }, result: "failed" });
    throw error;
  }
};

const mergeArchiveFolderArtifact = (row, existing, profileId) => ({
  ...row,
  title: existing?.title || row.title,
  description: existing?.description || row.description || "",
  storage_bucket: existing?.storage_bucket || row.storage_bucket,
  storage_path: existing?.storage_path || row.storage_path,
  file_status: existing?.storage_path ? "available" : existing?.file_status === "available" ? "available" : row.file_status,
  rights_status: existing?.rights_status || row.rights_status,
  canon_status: existing?.canon_status || row.canon_status,
  review_status: existing?.review_status || row.review_status,
  lifecycle_status: existing?.lifecycle_status || row.lifecycle_status,
  visibility: existing?.visibility || row.visibility,
  ai_generated: existing?.ai_generated ?? row.ai_generated,
  ai_model: existing?.ai_model || row.ai_model,
  prompt_used: existing?.prompt_used || row.prompt_used,
  provenance: { ...(existing?.provenance || {}), ...(row.provenance || {}), indexedFromArchiveFolder: true },
  legacy_data: { ...(existing?.legacy_data || {}), ...(row.legacy_data || {}), archiveFolderEntry: true },
  created_by: existing?.created_by || profileId,
  updated_by: profileId,
});

const handleArchiveFolderImport = async ({ supabase, identity, profile, runtime }) => {
  requireRole(identity, "admin");
  const folderArtifacts = repoImportManifest.archiveFiles || [];
  if (!folderArtifacts.length) return json(200, { ok: true, message: "No Archive folder files were found in the generated manifest.", counts: { created: 0, updated: 0, skipped: 0 } });
  const batchId = runtime.randomUUID();
  requireData(await supabase.from("import_batches").insert({
    id: batchId,
    title: `Archive folder index ${repoImportManifest.version}`,
    source: `repo-archive-folder:${repoImportManifest.version}`,
    status: "applied",
    created_by: profile.id,
    manifest: { kind: "archive-folder-index", version: repoImportManifest.version, files: folderArtifacts.length, folders: repoImportManifest.archiveFolders?.length || 0 },
  }), "Create archive folder import batch");
  const artifactKeys = ["id", "title", "slug", "description", "artifact_type", "source_type", "storage_bucket", "storage_path", "original_file_name", "mime_type", "file_size", "file_status", "external_url", "rights_status", "canon_status", "review_status", "lifecycle_status", "visibility", "ai_generated", "ai_model", "prompt_used", "provenance", "legacy_data"];
  const counts = await syncManifestRows({
    supabase,
    table: "artifacts",
    incoming: folderArtifacts,
    compareKeys: artifactKeys,
    mapRow: (row, existing) => mergeArchiveFolderArtifact(row, existing, profile.id),
  });
  const folderPaths = [...new Set(folderArtifacts.map((item) => item.provenance?.folder).filter(Boolean))];
  const taxonomy = await ensureArchiveFolderTaxonomy(supabase, folderPaths);
  const folderCategoryLinks = [];
  const folderTagLinks = [];
  for (const artifact of folderArtifacts) {
    const category = taxonomy.categoryByPath.get(normalizeFolderPath(artifact.provenance?.folder));
    if (category) folderCategoryLinks.push({ artifact_id: artifact.id, category_id: category.id, created_by: profile.id });
    for (const segment of artifact.provenance?.folderSegments || folderSegments(artifact.provenance?.folder)) {
      const tag = taxonomy.tagByName.get(String(segment).toLowerCase());
      if (tag) folderTagLinks.push({ artifact_id: artifact.id, tag_id: tag.id, created_by: profile.id });
    }
  }
  const uniqueCategoryLinks = [...new Map(folderCategoryLinks.map((link) => [`${link.artifact_id}:${link.category_id}`, link])).values()];
  const uniqueTagLinks = [...new Map(folderTagLinks.map((link) => [`${link.artifact_id}:${link.tag_id}`, link])).values()];
  if (uniqueCategoryLinks.length) requireData(await supabase.from("artifact_categories").upsert(uniqueCategoryLinks, { onConflict: "artifact_id,category_id", ignoreDuplicates: true }), "Attach folder categories");
  if (uniqueTagLinks.length) requireData(await supabase.from("artifact_tags").upsert(uniqueTagLinks, { onConflict: "artifact_id,tag_id", ignoreDuplicates: true }), "Attach folder tags");
  const audit = await writeAudit(supabase, profile, {
    actionType: "archive_folder_indexed",
    targetType: "archive_folder",
    targetId: "Archive",
    intentSummary: `Indexed ${folderArtifacts.length} files from the Archive folder manifest.`,
    reason: "Simplified folder-first archive index redux.",
    beforeSnapshot: {},
    afterSnapshot: { counts, manifestVersion: repoImportManifest.version, folders: repoImportManifest.archiveFolders?.length || 0, folderCategoryLinks: uniqueCategoryLinks.length, folderTagLinks: uniqueTagLinks.length },
    result: "applied",
  });
  return json(200, operationResult({
    identity,
    mode: "database-applied",
    audit,
    message: `Archive folder index imported: ${counts.created} created, ${counts.updated} updated, ${counts.skipped} skipped. Folder categories/tags were attached.`,
    extra: { importBatchId: batchId, counts, folderCategoryLinks: uniqueCategoryLinks.length, folderTagLinks: uniqueTagLinks.length, manifest: { version: repoImportManifest.version, files: folderArtifacts.length, folders: repoImportManifest.archiveFolders?.length || 0 } },
  }));
};

const handleCreateFolder = async ({ request, supabase, identity, profile }) => {
  requireRole(identity, "contributor");
  const body = await bodyJson(request);
  const folderPath = normalizeFolderPath(body.path || body.folderPath || body.name);
  const taxonomy = await ensureArchiveFolderTaxonomy(supabase, [folderPath]);
  const category = taxonomy.categoryByPath.get(folderPath);
  const audit = await writeAudit(supabase, profile, {
    actionType: "archive_folder_created",
    targetType: "archive_folder",
    targetId: folderPath,
    intentSummary: `Create Archive Index folder ${folderPath}.`,
    reason: String(body.reason || "Archive Index folder organization"),
    beforeSnapshot: {},
    afterSnapshot: { folderPath, categoryId: category?.id || null, folderTags: folderSegments(folderPath) },
    result: "applied",
  });
  return json(201, operationResult({
    identity,
    mode: "database-applied",
    audit,
    message: `Folder ${folderPath} is available as a virtual index folder and standardized folder tags.`,
    extra: { folder: { path: folderPath, category, tags: taxonomy.tags } },
  }));
};

const handleMoveArtifact = async ({ request, supabase, identity, profile, artifactId, runtime }) => {
  requireRole(identity, "contributor");
  const body = await bodyJson(request);
  const before = await getArtifact(supabase, artifactId);
  const { after, folderPath, indexedPath } = await assignArtifactFolder(supabase, {
    artifact: before,
    artifactId,
    folderPath: body.folderPath || body.path || body.folder,
    profile,
    runtime,
    updateReason: "moved",
  });
  const audit = await writeAudit(supabase, profile, {
    actionType: "archive_folder_move",
    targetType: "artifact",
    targetId: artifactId,
    intentSummary: `Move ${before.title} to ${folderPath}.`,
    reason: String(body.reason || "Archive Index folder move"),
    beforeSnapshot: { folder: before.provenance?.folder || null, path: before.provenance?.indexedPath || before.provenance?.workspaceRelativePath || null, categories: before.categories, folderTags: before.tags.filter((tag) => tag.tag_type === "folder") },
    afterSnapshot: { folder: folderPath, path: indexedPath, categories: after.categories, folderTags: after.tags.filter((tag) => tag.tag_type === "folder") },
    result: "applied",
  });
  return json(200, operationResult({ identity, mode: "database-applied", audit, artifact: after, message: `Moved ${after.title} to ${folderPath} in the Archive Index. Source files on disk were not renamed or moved.` }));
};

const handleImportStatus = async ({ supabase, identity }) => {
  requireRole(identity, "contributor");
  const artifacts = requireData(await supabase.from("artifacts").select("id,title,slug,original_file_name,mime_type,file_size,file_status,storage_bucket,storage_path,provenance,legacy_data"), "Load import artifact status");
  const batches = requireData(await supabase.from("import_batches").select("id,title,source,status,manifest,created_at,updated_at").order("created_at", { ascending: false }).limit(25), "Load import batches");
  return json(200, { ok: true, authenticated: true, userRole: identity.userRole, manifest: { version: repoImportManifest.version, counts: repoImportManifest.counts }, status: summarizeImportStatus({ artifacts, batches, expectedFiles: privileged(identity.userRole) ? repoImportManifest.expectedFiles : [] }) });
};

const loadAuthorizedBatch = async (supabase, batchId, identity, profile) => {
  const batch = requireData(await supabase.from("import_batches").select("*").eq("id", batchId).single(), "Load import batch");
  if (!privileged(identity.userRole) && batch.created_by !== profile.id) throw Object.assign(new Error("This import batch belongs to another employee."), { status: 403 });
  return batch;
};

const handleCreateBrowserImportBatch = async ({ request, supabase, identity, profile, runtime }) => {
  requireRole(identity, "contributor");
  const body = await bodyJson(request);
  const fileCount = Math.max(0, Math.min(2000, Number(body.fileCount || 0)));
  if (!fileCount) throw Object.assign(new Error("The import batch must include at least one file."), { status: 400 });
  const id = runtime.randomUUID();
  const manifest = { kind: "browser-multi-file", fileCount, defaults: cleanObject(body.defaults), notes: String(body.notes || ""), files: [], counts: { queued: fileCount, applied: 0, pending_review: 0, duplicate: 0, failed: 0 } };
  const batch = requireData(await supabase.from("import_batches").insert({ id, title: String(body.title || `Browser file import ${runtime.now().toISOString().slice(0, 10)}`), source: "browser-multi-file", status: "in_progress", created_by: profile.id, manifest }).select().single(), "Create browser import batch");
  const audit = await writeAudit(supabase, profile, { actionType: "import_batch_started", targetType: "import_batch", targetId: id, intentSummary: `Start browser import of ${fileCount} files.`, reason: body.notes || "Browser multi-file import", beforeSnapshot: {}, afterSnapshot: { fileCount, defaults: manifest.defaults }, result: "in_progress" });
  return json(201, operationResult({ identity, profile, mode: privileged(identity.userRole) ? "database-applied" : "pending-review", audit, message: `Import batch created for ${fileCount} files.`, extra: { importBatch: batch } }));
};

const handleImportBatchFileStatus = async ({ request, supabase, identity, profile, batchId, runtime }) => {
  requireRole(identity, "contributor");
  const batch = await loadAuthorizedBatch(supabase, batchId, identity, profile);
  const body = await bodyJson(request);
  const allowed = ["queued", "uploading", "applied", "pending_review", "duplicate", "failed"];
  const status = allowed.includes(body.status) ? body.status : "failed";
  const manifest = cleanObject(batch.manifest);
  const files = Array.isArray(manifest.files) ? [...manifest.files] : [];
  const key = String(body.clientFileId || `${body.relativePath || ""}:${body.fileName || ""}`);
  const entry = { clientFileId: key, fileName: safeFileName(body.fileName), relativePath: String(body.relativePath || ""), fileSize: Number(body.fileSize || 0), status, artifactId: body.artifactId || null, matchedArtifactId: body.matchedArtifactId || null, matchedBy: body.matchedBy || null, error: body.error || null, updatedAt: runtime.now().toISOString() };
  const index = files.findIndex((item) => item.clientFileId === key);
  if (index >= 0) files[index] = entry; else files.push(entry);
  const counts = Object.fromEntries(allowed.map((name) => [name, files.filter((item) => item.status === name).length]));
  counts.queued += Math.max(0, Number(manifest.fileCount || 0) - files.length);
  requireData(await supabase.from("import_batches").update({ manifest: { ...manifest, files, counts } }).eq("id", batchId), "Update import file status");
  const audit = await writeAudit(supabase, profile, { actionType: "import_file_status", targetType: "import_batch", targetId: batchId, intentSummary: `${entry.fileName}: ${status}.`, reason: entry.error || entry.matchedBy || "Browser upload progress", beforeSnapshot: {}, afterSnapshot: entry, result: status });
  return json(200, { ok: true, status, counts, auditEventId: audit.id });
};

const handleCompleteBrowserImportBatch = async ({ supabase, identity, profile, batchId, runtime }) => {
  requireRole(identity, "contributor");
  const batch = await loadAuthorizedBatch(supabase, batchId, identity, profile);
  const manifest = cleanObject(batch.manifest);
  const files = Array.isArray(manifest.files) ? manifest.files : [];
  const failed = files.filter((item) => item.status === "failed").length;
  const pending = files.filter((item) => item.status === "pending_review").length;
  const status = failed ? "completed_with_errors" : pending ? "pending_review" : "applied";
  requireData(await supabase.from("import_batches").update({ status, manifest: { ...manifest, completedAt: runtime.now().toISOString() } }).eq("id", batchId), "Complete browser import batch");
  const audit = await writeAudit(supabase, profile, { actionType: "import_batch_completed", targetType: "import_batch", targetId: batchId, intentSummary: `Complete browser import batch with ${files.length} processed files.`, reason: manifest.notes || "Browser multi-file import", beforeSnapshot: { status: batch.status }, afterSnapshot: { status, counts: manifest.counts || {}, fileCount: files.length }, result: status });
  return json(200, operationResult({ identity, profile, mode: pending ? "pending-review" : "database-applied", audit, message: failed ? `Batch completed with ${failed} failed file(s). Retry is available in this browser session.` : pending ? "Batch uploaded and awaits admin review." : "Batch imported and applied immediately.", extra: { importBatchId: batchId, importBatchStatus: status, counts: manifest.counts || {} } }));
};

const handleUploadSign = async ({ request, supabase, config, identity, runtime }) => {
  requireRole(identity, "contributor");
  const body = await bodyJson(request);
  const fileName = safeFileName(body.fileName);
  const fileSize = Number(body.fileSize || 0);
  if (!fileName || !fileSize || fileSize < 1) throw Object.assign(new Error("File name and file size are required."), { status: 400 });
  if (fileSize > MAX_UPLOAD_BYTES) throw Object.assign(new Error("Files larger than 50 MB exceed the configured Supabase upload limit."), { status: 413 });
  const checksumSha256 = String(body.checksumSha256 || "").toLowerCase();
  if (checksumSha256 && !/^[a-f0-9]{64}$/.test(checksumSha256)) throw Object.assign(new Error("Checksum must be a SHA-256 hex value."), { status: 400 });
  const match = await uploadMatch(supabase, { ...body, fileName, fileSize, checksumSha256 });
  if (match.ambiguous) throw Object.assign(new Error(`Upload matches multiple existing artifacts (${match.candidates.join(", ")}). Use the original folder path or resolve the duplicate metadata first.`), { status: 409 });
  if (match.duplicate) return json(200, {
    ok: true,
    duplicate: true,
    uploadRequired: false,
    matchedArtifactId: match.artifact.id,
    matchedBy: match.matchedBy,
    artifact: await getArtifact(supabase, match.artifact.id),
    message: `Skipped duplicate file; it already belongs to ${match.artifact.title}.`,
  });
  const date = runtime.now();
  const path = `${identity.userId}/${date.getUTCFullYear()}/${String(date.getUTCMonth() + 1).padStart(2, "0")}/${checksumSha256 ? `${checksumSha256.slice(0, 12)}-` : ""}${runtime.randomUUID()}-${fileName}`;
  const signed = requireData(await supabase.storage.from(config.artifactsBucket).createSignedUploadUrl(path, { upsert: false }), "Create signed upload");
  return json(200, {
    ok: true,
    upload: { bucket: config.artifactsBucket, path, token: signed.token, signedUrl: signed.signedUrl },
    supabase: { url: config.url, anonKey: config.anonKey },
    expiresIn: 7200,
    duplicate: false,
    uploadRequired: true,
    matchedArtifactId: match.artifact?.id || null,
    matchedBy: match.matchedBy,
  });
};

const handleUploadComplete = async ({ request, supabase, config, identity, profile, runtime }) => {
  requireRole(identity, "contributor");
  const body = await bodyJson(request);
  const storagePath = String(body.storagePath || "");
  if (!storagePath.startsWith(`${identity.userId}/`)) throw Object.assign(new Error("The uploaded object does not belong to this employee session."), { status: 403 });
  const title = String(body.title || body.originalFileName || "Untitled artifact").trim();
  const match = await uploadMatch(supabase, body);
  if (match.ambiguous) {
    await supabase.storage.from(config.artifactsBucket).remove([storagePath]);
    throw Object.assign(new Error(`Uploaded file matches multiple artifacts (${match.candidates.join(", ")}); the temporary object was removed.`), { status: 409 });
  }
  if (match.duplicate) {
    await supabase.storage.from(config.artifactsBucket).remove([storagePath]);
    const artifact = await getArtifact(supabase, match.artifact.id);
    const audit = await writeAudit(supabase, profile, { actionType: "artifact_upload_duplicate_skipped", targetType: "artifact", targetId: artifact.id, intentSummary: `Skip duplicate upload ${body.originalFileName}.`, reason: String(body.reason || "Browser upload"), beforeSnapshot: { fileStatus: artifact.file_status }, afterSnapshot: { duplicate: true, matchedBy: match.matchedBy }, result: "duplicate" });
    return json(200, operationResult({ identity, profile, mode: "database-applied", artifact, audit, message: `Duplicate skipped; file is already attached to ${artifact.title}.`, extra: { duplicate: true, matchedArtifactId: artifact.id, matchedBy: match.matchedBy } }));
  }
  const slugBase = slugify(title);
  const id = match.artifact?.id || `artifact.${slugBase}-${runtime.randomUUID().slice(0, 8)}`;
  const slug = match.artifact?.slug || `${slugBase}-${id.slice(-8)}`;
  const defaults = uploadDefaults(body.originalFileName, body.mimeType);
  const uploadFolderPath = normalizeFolderPath(body.folderPath || body.folder || folderFromRelativeFilePath(body.relativePath || body.originalFileName));
  const uploadRiskLevel = body.visibility === "public" || body.canonStatus === "foundation-canon" || body.rightsStatus === "public-cleared" ? "high" : "low";
  const appliesImmediately = databaseDisposition({ role: identity.userRole, operationType: "artifact_upload", riskLevel: uploadRiskLevel }).mode === "apply";
  const existing = match.artifact;
  const provenance = { ...(existing?.provenance || {}), ...cleanObject(body.provenance), workspaceRelativePath: body.relativePath || existing?.provenance?.workspaceRelativePath || existing?.legacy_data?.filePath || null, folder: uploadFolderPath, checksumSha256: body.checksumSha256 || existing?.provenance?.checksumSha256 || null, uploadedAt: runtime.now().toISOString(), importBatchId: body.importBatchId || null };
  const row = existing ? {
    storage_bucket: config.artifactsBucket,
    storage_path: storagePath,
    original_file_name: safeFileName(body.originalFileName),
    mime_type: String(body.mimeType || "application/octet-stream"),
    file_size: Number(body.fileSize || 0),
    file_status: "available",
    description: body.description === undefined ? existing.description : String(body.description || ""),
    artifact_type: String(body.artifactType || existing.artifact_type || defaults.artifact_type),
    project: String(body.project || existing.project || defaults.project),
    intended_use: String(body.intendedUse || existing.intended_use || defaults.intended_use),
    notes: body.notes === undefined ? existing.notes || "" : String(body.notes || ""),
    rights_status: String(body.rightsStatus || existing.rights_status || defaults.rights_status),
    canon_status: String(body.canonStatus || existing.canon_status || defaults.canon_status),
    review_status: appliesImmediately ? String(body.reviewStatus || existing.review_status || defaults.review_status) : "needs-review",
    lifecycle_status: appliesImmediately ? String(body.workflowStatus || existing.lifecycle_status || defaults.lifecycle_status) : "needs-metadata",
    visibility: String(body.visibility || existing.visibility || defaults.visibility),
    provenance,
    updated_by: profile.id,
  } : {
    id, title, slug,
    description: String(body.description || ""),
    artifact_type: String(body.artifactType || defaults.artifact_type),
    project: String(body.project || defaults.project),
    intended_use: String(body.intendedUse || defaults.intended_use),
    notes: String(body.notes || ""),
    source_type: "browser-upload",
    storage_bucket: config.artifactsBucket,
    storage_path: storagePath,
    original_file_name: safeFileName(body.originalFileName),
    mime_type: String(body.mimeType || "application/octet-stream"),
    file_size: Number(body.fileSize || 0),
    file_status: "available",
    rights_status: String(body.rightsStatus || defaults.rights_status),
    canon_status: String(body.canonStatus || defaults.canon_status),
    review_status: appliesImmediately ? String(body.reviewStatus || defaults.review_status) : "needs-review",
    lifecycle_status: appliesImmediately ? String(body.workflowStatus || defaults.lifecycle_status) : "needs-metadata",
    visibility: String(body.visibility || defaults.visibility),
    ai_generated: body.aiGenerated === true ? true : body.aiGenerated === false ? false : null,
    ai_model: body.aiModel || null,
    prompt_used: body.promptUsed || null,
    provenance,
    created_by: profile.id,
    updated_by: profile.id,
  };
  let folderAssignment = null;
  try {
    if (existing) requireData(await supabase.from("artifacts").update(row).eq("id", id), "Attach file to existing artifact");
    else requireData(await supabase.from("artifacts").insert(row), "Create artifact");
    if (appliesImmediately) {
      const metadataTags = [
        { tagType: "medium", name: row.artifact_type },
        { tagType: "project", name: row.project },
        { tagType: "function", name: row.intended_use },
        { tagType: "rights", name: row.rights_status },
        { tagType: "review", name: row.review_status },
        { tagType: "canon", name: row.canon_status },
        { tagType: "visibility", name: row.visibility },
        { tagType: "workflow", name: row.lifecycle_status },
      ];
      await applyTypedTagChange(supabase, { artifactId: id, addTags: [...metadataTags, ...asArray(body.freeformTags || body.tags).map((name) => ({ tagType: "freeform", name })), ...(Array.isArray(body.controlledTags) ? body.controlledTags : [])], profile });
    }
    const categories = await ensureCategories(supabase, asArray(body.categories));
    if (appliesImmediately && categories.length) requireData(await supabase.from("artifact_categories").upsert(categories.map((category) => ({ artifact_id: id, category_id: category.id, created_by: profile.id })), { onConflict: "artifact_id,category_id", ignoreDuplicates: true }), "Attach upload categories");
    if (appliesImmediately && body.categoryId) requireData(await supabase.from("artifact_categories").upsert({ artifact_id: id, category_id: String(body.categoryId), created_by: profile.id }, { onConflict: "artifact_id,category_id", ignoreDuplicates: true }), "Attach selected upload category");
    if (appliesImmediately && body.relatedEntityId) requireData(await supabase.from("artifact_archive_records").upsert({ artifact_id: id, archive_record_id: String(body.relatedEntityId), relationship_type: "organized-as", notes: "Assigned through artifact organization", created_by: profile.id }, { onConflict: "artifact_id,archive_record_id,relationship_type" }), "Attach related archive record");
    if (appliesImmediately) {
      folderAssignment = await assignArtifactFolder(supabase, { artifactId: id, folderPath: uploadFolderPath, profile, runtime, updateReason: "uploaded" });
    }
  } catch (error) {
    await supabase.storage.from(config.artifactsBucket).remove([storagePath]);
    throw error;
  }
  const artifact = await getArtifact(supabase, id);
  let review = null;
  if (!appliesImmediately) review = await createReviewRequest(supabase, profile, {
    operationType: "artifact_upload", targetType: "artifact", targetId: id,
    riskLevel: uploadRiskLevel, intentSummary: `Review uploaded file ${title}.`, reason: String(body.reason || "Browser upload"),
    beforeSnapshot: existing || {}, afterSnapshot: { artifactId: id, fileStatus: "available", reviewStatus: "needs-review", organization: row, addFreeformTags: asArray(body.freeformTags || body.tags), addControlledTags: Array.isArray(body.controlledTags) ? body.controlledTags : [], addCategories: asArray(body.categories), ...(body.categoryId ? { setCategoryId: String(body.categoryId) } : {}), relatedEntityId: body.relatedEntityId || null, matchedExistingArtifact: Boolean(existing), matchedBy: match.matchedBy },
    affectedArtifacts: [id], affectedFiles: [storagePath],
  });
  const audit = await writeAudit(supabase, profile, {
    actionType: existing ? "artifact_file_attached" : "artifact_upload", targetType: "artifact", targetId: id,
    intentSummary: existing ? `Attach uploaded file to ${existing.title}.` : `Upload ${title}.`, reason: String(body.reason || "Browser upload"), beforeSnapshot: existing || {},
    afterSnapshot: { id, storageBucket: config.artifactsBucket, storagePath, reviewStatus: row.review_status, folder: folderAssignment?.folderPath || uploadFolderPath, indexedPath: folderAssignment?.indexedPath || null, matchedExistingArtifact: Boolean(existing), matchedBy: match.matchedBy, importBatchId: body.importBatchId || null },
    result: appliesImmediately ? "applied" : "pending_review",
  });
  return json(201, operationResult({ identity, profile, mode: appliesImmediately ? "database-applied" : "pending-review", riskLevel: uploadRiskLevel, artifact, review, audit,
    message: appliesImmediately ? existing ? `File uploaded and attached to existing artifact ${existing.title}.` : "File uploaded and artifact created immediately. No GitHub PR was used." : existing ? `File attached to ${existing.title} and marked for admin review.` : "File uploaded. The artifact is stored and awaits admin review.",
    extra: { duplicate: false, matchedExistingArtifact: Boolean(existing), matchedArtifactId: existing?.id || null, matchedBy: match.matchedBy, importBatchId: body.importBatchId || null },
  }));
};

const handleTagChange = async ({ request, supabase, identity, profile, artifactId }) => {
  requireRole(identity, "contributor");
  const body = await bodyJson(request);
  const addTags = asArray(body.addTags);
  const removeTags = asArray(body.removeTags);
  if (!addTags.length && !removeTags.length) throw Object.assign(new Error("Add or remove at least one tag."), { status: 400 });
  const before = await getArtifact(supabase, artifactId);
  const beforeNames = before.tags.map((tag) => tag.name);
  const afterNames = [...new Set([...beforeNames.filter((name) => !removeTags.map(slugify).includes(slugify(name))), ...addTags])];
  const intent = [addTags.length ? `Add ${addTags.map((tag) => `“${tag}”`).join(", ")} to ${before.title}` : "", removeTags.length ? `remove ${removeTags.map((tag) => `“${tag}”`).join(", ")} from ${before.title}` : ""].filter(Boolean).join("; ") + ".";
  const appliesImmediately = databaseDisposition({ role: identity.userRole, operationType: "artifact_tag_update", riskLevel: "low" }).mode === "apply";
  if (!appliesImmediately) {
    const review = await createReviewRequest(supabase, profile, {
      operationType: "artifact_tag_update", targetType: "artifact", targetId: artifactId, riskLevel: "low", intentSummary: intent,
      reason: String(body.reason || ""), beforeSnapshot: { tags: beforeNames }, afterSnapshot: { tags: afterNames, addTags, removeTags }, affectedArtifacts: [artifactId],
    });
    const audit = await writeAudit(supabase, profile, { actionType: "artifact_tag_proposed", targetType: "artifact", targetId: artifactId, intentSummary: intent, reason: body.reason, beforeSnapshot: { tags: beforeNames }, afterSnapshot: { tags: afterNames }, result: "pending_review" });
    return json(202, operationResult({ identity, profile, mode: "pending-review", riskLevel: "low", review, audit, artifact: before, message: "Tag proposal saved to the legacy review queue. Canonical tags are unchanged until approval." }));
  }
  const { afterArtifact } = await applyTagChange(supabase, { artifactId, addTags, removeTags, profile });
  const audit = await writeAudit(supabase, profile, { actionType: "artifact_tag_update", targetType: "artifact", targetId: artifactId, intentSummary: intent, reason: body.reason, beforeSnapshot: { tags: beforeNames }, afterSnapshot: { tags: afterArtifact.tags.map((tag) => tag.name) }, result: "applied" });
  return json(200, operationResult({ identity, profile, mode: "database-applied", audit, artifact: afterArtifact, message: `${identity.userRole === "owner" ? "Owner" : identity.userRole === "admin" ? "Admin" : "Editor"} tag change applied immediately and audited. No GitHub PR was used.` }));
};

const handleCategoryChange = async ({ request, supabase, identity, profile, artifactId }) => {
  requireRole(identity, "contributor");
  const body = await bodyJson(request);
  const addCategories = asArray(body.addCategories);
  const removeCategories = asArray(body.removeCategories);
  if (!addCategories.length && !removeCategories.length) throw Object.assign(new Error("Add or remove at least one category."), { status: 400 });
  const before = await getArtifact(supabase, artifactId);
  const beforeNames = before.categories.map((category) => category.name);
  const afterNames = [...new Set([...beforeNames.filter((name) => !removeCategories.map(slugify).includes(slugify(name))), ...addCategories])];
  const intent = `Update categories for ${before.title}: ${afterNames.join(", ") || "none"}.`;
  const appliesImmediately = databaseDisposition({ role: identity.userRole, operationType: "artifact_category_update", riskLevel: "low" }).mode === "apply";
  if (!appliesImmediately) {
    const review = await createReviewRequest(supabase, profile, { operationType: "artifact_category_update", targetType: "artifact", targetId: artifactId, riskLevel: "low", intentSummary: intent, reason: body.reason, beforeSnapshot: { categories: beforeNames }, afterSnapshot: { categories: afterNames, addCategories, removeCategories }, affectedArtifacts: [artifactId] });
    const audit = await writeAudit(supabase, profile, { actionType: "artifact_category_proposed", targetType: "artifact", targetId: artifactId, intentSummary: intent, reason: body.reason, beforeSnapshot: { categories: beforeNames }, afterSnapshot: { categories: afterNames }, result: "pending_review" });
    return json(202, operationResult({ identity, profile, mode: "pending-review", review, audit, artifact: before, message: "Category proposal saved to the legacy review queue." }));
  }
  const { afterArtifact } = await applyCategoryChange(supabase, { artifactId, addCategories, removeCategories, profile });
  const audit = await writeAudit(supabase, profile, { actionType: "artifact_category_update", targetType: "artifact", targetId: artifactId, intentSummary: intent, reason: body.reason, beforeSnapshot: { categories: beforeNames }, afterSnapshot: { categories: afterArtifact.categories.map((category) => category.name) }, result: "applied" });
  return json(200, operationResult({ identity, profile, mode: "database-applied", audit, artifact: afterArtifact, message: "Category change applied immediately and audited." }));
};

const metadataFields = ["title", "description", "artifact_type", "project", "intended_use", "rights_status", "canon_status", "review_status", "lifecycle_status", "visibility", "file_status", "notes"];
const highRiskMetadata = (changes) => changes.canon_status === "foundation-canon" || changes.visibility === "public" || Object.hasOwn(changes, "rights_status") || Object.hasOwn(changes, "file_status");
const controlledFieldTagTypes = {
  artifact_type: "medium",
  project: "project",
  intended_use: "function",
  rights_status: "rights",
  review_status: "review",
  canon_status: "canon",
  visibility: "visibility",
  lifecycle_status: "workflow",
};

const typedTags = (value, fallbackType = "freeform") => (Array.isArray(value) ? value : asArray(value)).map((item) => typeof item === "string"
  ? { name: item, tagType: fallbackType }
  : { id: String(item?.id || "").trim() || undefined, name: String(item?.name || "").trim(), tagType: String(item?.tagType || fallbackType).trim().toLowerCase() })
  .filter((item) => item.id || (item.name && item.tagType));

const organizationPayload = (body) => {
  const sourceChanges = cleanObject(body.changes);
  const changes = Object.fromEntries(Object.entries(sourceChanges).filter(([key]) => metadataFields.includes(key)));
  return {
    changes,
    addControlledTags: typedTags(body.addControlledTags, "style"),
    removeControlledTags: typedTags(body.removeControlledTags, "style"),
    addFreeformTags: typedTags(body.addFreeformTags, "freeform"),
    removeFreeformTags: typedTags(body.removeFreeformTags, "freeform"),
    addCategories: asArray(body.addCategories),
    removeCategories: asArray(body.removeCategories),
    setCategory: Object.hasOwn(body, "setCategory") ? String(body.setCategory || "") : undefined,
    setCategoryId: Object.hasOwn(body, "setCategoryId") ? String(body.setCategoryId || "") : undefined,
    relatedEntityId: Object.hasOwn(body, "relatedEntityId") ? String(body.relatedEntityId || "") : undefined,
    folderPath: Object.hasOwn(body, "folderPath") ? normalizeFolderPath(body.folderPath) : undefined,
  };
};

const payloadHasControlledChanges = (payload) => Object.keys(payload.changes).length > 0
  || payload.addControlledTags.length > 0
  || payload.removeControlledTags.length > 0
  || payload.addCategories.length > 0
  || payload.removeCategories.length > 0
  || payload.setCategory !== undefined
  || payload.setCategoryId !== undefined
  || payload.relatedEntityId !== undefined
  || payload.folderPath !== undefined;

export const organizationDisposition = ({ role, controlled }) => privileged(role)
  || (!controlled && databaseDisposition({ role, operationType: "artifact_tag_update", riskLevel: "low" }).mode === "apply")
  ? "apply"
  : "review";

const applyOrganizationPayload = async (supabase, artifactId, payload, profile) => {
  if (Object.keys(payload.changes).length) {
    requireData(await supabase.from("artifacts").update({ ...payload.changes, updated_by: profile.id }).eq("id", artifactId), "Update artifact organization");
    for (const [field, tagType] of Object.entries(controlledFieldTagTypes)) {
      if (Object.hasOwn(payload.changes, field)) await syncControlledTag(supabase, { artifactId, tagType, value: payload.changes[field], profile });
    }
  }
  await applyTypedTagChange(supabase, { artifactId, addTags: [...payload.addControlledTags, ...payload.addFreeformTags], removeTags: [...payload.removeControlledTags, ...payload.removeFreeformTags], profile });
  if (payload.setCategoryId !== undefined) {
    requireData(await supabase.from("artifact_categories").delete().eq("artifact_id", artifactId), "Clear artifact category");
    if (payload.setCategoryId) requireData(await supabase.from("artifact_categories").upsert({ artifact_id: artifactId, category_id: payload.setCategoryId, created_by: profile.id }, { onConflict: "artifact_id,category_id" }), "Assign artifact category");
  } else if (payload.setCategory !== undefined) {
    const current = await getArtifact(supabase, artifactId);
    await applyCategoryChange(supabase, { artifactId, addCategories: payload.setCategory ? [payload.setCategory] : [], removeCategories: current.categories.map((item) => item.name), profile });
  } else if (payload.addCategories.length || payload.removeCategories.length) {
    await applyCategoryChange(supabase, { artifactId, addCategories: payload.addCategories, removeCategories: payload.removeCategories, profile });
  }
  if (payload.relatedEntityId !== undefined) {
    requireData(await supabase.from("artifact_archive_records").delete().eq("artifact_id", artifactId).eq("relationship_type", "organized-as"), "Clear organized archive record");
    if (payload.relatedEntityId) requireData(await supabase.from("artifact_archive_records").upsert({
      artifact_id: artifactId,
      archive_record_id: payload.relatedEntityId,
      relationship_type: "organized-as",
      notes: "Assigned through artifact organization",
      created_by: profile.id,
    }, { onConflict: "artifact_id,archive_record_id,relationship_type" }), "Assign archive record");
  }
  requireData(await supabase.from("artifacts").update({ updated_by: profile.id }).eq("id", artifactId), "Touch organized artifact");
  return { afterArtifact: await getArtifact(supabase, artifactId) };
};

const handleOrganizationChange = async ({ request, supabase, identity, profile, artifactIds }) => {
  requireRole(identity, "contributor");
  const body = await bodyJson(request);
  const payload = organizationPayload(body);
  const ids = [...new Set((artifactIds || asArray(body.artifactIds)).filter(Boolean))];
  if (!ids.length) throw Object.assign(new Error("Choose at least one artifact."), { status: 400 });
  if (ids.length > MAX_BULK_ORGANIZATION_ITEMS) throw Object.assign(new Error(`Choose no more than ${MAX_BULK_ORGANIZATION_ITEMS} artifacts per organization request.`), { status: 400 });
  const hasChange = payloadHasControlledChanges(payload) || payload.addFreeformTags.length || payload.removeFreeformTags.length;
  if (!hasChange) throw Object.assign(new Error("No organization changes were supplied."), { status: 400 });
  const controlled = payloadHasControlledChanges(payload);
  const appliesImmediately = organizationDisposition({ role: identity.userRole, controlled }) === "apply";
  const batch = requireData(await supabase.rpc("creative_os_bulk_organize_artifacts", {
    p_apply: appliesImmediately,
    p_artifact_ids: ids,
    p_payload: payload,
    p_profile_id: profile.id,
    p_reason: String(body.reason || ""),
    p_risk_level: highRiskMetadata(payload.changes) ? "high" : "low",
  }), "Organize artifact batch");
  const results = batch?.results || [];
  if (results.length !== ids.length) throw new Error("Bulk organization did not return every requested artifact result; the transaction was rejected.");
  const mode = appliesImmediately ? "database-applied" : "pending-review";
  return json(appliesImmediately ? 200 : 202, operationResult({ identity, mode, artifact: results.length === 1 ? results[0].artifact : null, message: appliesImmediately ? `${results.length} artifact organization change${results.length === 1 ? "" : "s"} applied immediately and audited.` : `${results.length} organization proposal${results.length === 1 ? "" : "s"} sent to the legacy review queue.`, extra: { results, affectedCount: results.length } }));
};

const handleMetadataChange = async ({ request, supabase, identity, profile, artifactId }) => {
  requireRole(identity, "contributor");
  const body = await bodyJson(request);
  const changes = Object.fromEntries(Object.entries(cleanObject(body.changes)).filter(([key]) => metadataFields.includes(key)));
  if (!Object.keys(changes).length) throw Object.assign(new Error("No supported artifact fields were supplied."), { status: 400 });
  const before = await getArtifact(supabase, artifactId);
  const riskLevel = highRiskMetadata(changes) ? "high" : "low";
  const appliesImmediately = databaseDisposition({ role: identity.userRole, operationType: "artifact_metadata_update", riskLevel }).mode === "apply";
  const intent = `Update ${Object.keys(changes).join(", ")} for ${before.title}.`;
  if (!appliesImmediately) {
    const review = await createReviewRequest(supabase, profile, { operationType: "artifact_metadata_update", targetType: "artifact", targetId: artifactId, riskLevel, intentSummary: intent, reason: body.reason, beforeSnapshot: Object.fromEntries(Object.keys(changes).map((key) => [key, before[key]])), afterSnapshot: changes, affectedArtifacts: [artifactId] });
    const audit = await writeAudit(supabase, profile, { actionType: "artifact_metadata_proposed", targetType: "artifact", targetId: artifactId, intentSummary: intent, reason: body.reason, beforeSnapshot: review.before_snapshot, afterSnapshot: changes, result: "pending_review" });
    return json(202, operationResult({ identity, profile, mode: "pending-review", riskLevel, review, audit, artifact: before, message: riskLevel === "high" ? "High-risk metadata change recorded for explicit review; canonical data is unchanged." : "Metadata proposal saved for review." }));
  }
  requireData(await supabase.from("artifacts").update({ ...changes, updated_by: profile.id }).eq("id", artifactId), "Update artifact metadata");
  const after = await getArtifact(supabase, artifactId);
  const audit = await writeAudit(supabase, profile, { actionType: "artifact_metadata_update", targetType: "artifact", targetId: artifactId, intentSummary: intent, reason: body.reason, beforeSnapshot: Object.fromEntries(Object.keys(changes).map((key) => [key, before[key]])), afterSnapshot: changes, result: "applied" });
  return json(200, operationResult({ identity, profile, mode: "database-applied", audit, artifact: after, message: "Metadata updated in Supabase immediately and audited." }));
};

const applyReview = async (supabase, review, profile) => {
  const after = cleanObject(review.after_snapshot);
  if (review.operation_type === "artifact_organization_update") return requireData(await supabase.rpc("creative_os_bulk_organize_artifacts", {
    p_apply: true,
    p_artifact_ids: [review.target_id],
    p_payload: cleanObject(after.organization),
    p_profile_id: profile.id,
    p_reason: review.reason || "Approved organization proposal",
    p_risk_level: review.risk_level || "low",
  }), "Apply approved organization proposal");
  if (review.operation_type === "artifact_tag_update") return applyTagChange(supabase, { artifactId: review.target_id, addTags: asArray(after.addTags), removeTags: asArray(after.removeTags), profile });
  if (review.operation_type === "artifact_category_update") return applyCategoryChange(supabase, { artifactId: review.target_id, addCategories: asArray(after.addCategories), removeCategories: asArray(after.removeCategories), profile });
  if (review.operation_type === "artifact_metadata_update") {
    const changes = Object.fromEntries(Object.entries(after).filter(([key]) => metadataFields.includes(key)));
    requireData(await supabase.from("artifacts").update({ ...changes, updated_by: profile.id }).eq("id", review.target_id), "Apply reviewed metadata");
    return { afterArtifact: await getArtifact(supabase, review.target_id) };
  }
  if (review.operation_type === "artifact_upload") {
    const organization = cleanObject(after.organization);
    if (Object.keys(organization).length) {
      const uploadPayload = organizationPayload({
        changes: organization,
        addControlledTags: after.addControlledTags,
        addFreeformTags: after.addFreeformTags,
        addCategories: after.addCategories,
        ...(after.setCategoryId ? { setCategoryId: after.setCategoryId } : {}),
        ...(after.relatedEntityId ? { relatedEntityId: after.relatedEntityId } : {}),
      });
      await applyOrganizationPayload(supabase, review.target_id, uploadPayload, profile);
    } else if (asArray(after.addTags).length) await applyTagChange(supabase, { artifactId: review.target_id, addTags: asArray(after.addTags), profile });
    if (asArray(after.addCategories).length) await applyCategoryChange(supabase, { artifactId: review.target_id, addCategories: asArray(after.addCategories), profile });
    requireData(await supabase.from("artifacts").update({ updated_by: profile.id }).eq("id", review.target_id), "Approve upload");
    return { afterArtifact: await getArtifact(supabase, review.target_id) };
  }
  if (review.operation_type === "import_batch") {
    if (review.affected_artifacts?.length) requireData(await supabase.from("artifacts").update({ review_status: "reviewed", lifecycle_status: "imported", updated_by: profile.id }).in("id", review.affected_artifacts), "Approve imported artifacts");
    requireData(await supabase.from("import_batches").update({ status: "approved" }).eq("id", review.target_id), "Approve import batch");
    return { importBatchId: review.target_id, artifactCount: review.affected_artifacts?.length || 0 };
  }
  if (review.operation_type === "decision_resolution") {
    const resolutionId = after.resolutionId;
    const resolution = requireData(await supabase.from("decision_resolutions").select("*").eq("id", resolutionId).single(), "Load decision resolution");
    let canonicalEffect = resolution.canonical_effect;
    if (resolution.application_type === "structured_update" && resolution.affected_records.length && after.structuredUpdate) {
      const updates = {};
      if (after.structuredUpdate.canonStatus) updates.canon_status = after.structuredUpdate.canonStatus;
      if (after.structuredUpdate.reviewStatus) updates.review_status = after.structuredUpdate.reviewStatus;
      if (Object.keys(updates).length) {
        requireData(await supabase.from("archive_records").update(updates).in("id", resolution.affected_records), "Apply structured archive update");
        canonicalEffect = "structured archive records changed";
      }
    }
    requireData(await supabase.from("decision_resolutions").update({ status: "applied", reviewed_by: profile.id, canonical_effect: canonicalEffect }).eq("id", resolutionId), "Apply decision resolution");
    requireData(await supabase.from("decisions").update({ status: canonicalEffect === "structured archive records changed" ? "resolved" : resolution.application_type === "rewrite_request" ? "rewrite-requested" : "decision-recorded" }).eq("id", resolution.decision_id), "Update decision state");
    return { resolutionId, canonicalEffect, sourceFilesChanged: false };
  }
  if (review.operation_type === "revert_audit") {
    const originalAction = after.originalAction;
    const restore = cleanObject(after.restore);
    if (review.target_type === "artifact" && originalAction === "artifact_tag_update") {
      const current = await getArtifact(supabase, review.target_id);
      const desired = asArray(restore.tags);
      return applyTagChange(supabase, { artifactId: review.target_id, addTags: desired.filter((tag) => !current.tags.some((item) => slugify(item.name) === slugify(tag))), removeTags: current.tags.map((item) => item.name).filter((tag) => !desired.some((item) => slugify(item) === slugify(tag))), profile });
    }
    if (review.target_type === "artifact" && originalAction === "artifact_category_update") {
      const current = await getArtifact(supabase, review.target_id);
      const desired = asArray(restore.categories);
      return applyCategoryChange(supabase, { artifactId: review.target_id, addCategories: desired.filter((name) => !current.categories.some((item) => slugify(item.name) === slugify(name))), removeCategories: current.categories.map((item) => item.name).filter((name) => !desired.some((item) => slugify(item) === slugify(name))), profile });
    }
    if (review.target_type === "artifact" && originalAction === "artifact_metadata_update") {
      const changes = Object.fromEntries(Object.entries(restore).filter(([key]) => metadataFields.includes(key)));
      requireData(await supabase.from("artifacts").update({ ...changes, updated_by: profile.id }).eq("id", review.target_id), "Revert artifact metadata");
      return { afterArtifact: await getArtifact(supabase, review.target_id) };
    }
    if (review.target_type === "artifact" && originalAction === "artifact_upload") {
      requireData(await supabase.from("artifacts").update({ lifecycle_status: "archived", file_status: "archived", updated_by: profile.id }).eq("id", review.target_id), "Archive reverted upload");
      return { afterArtifact: await getArtifact(supabase, review.target_id) };
    }
    throw new Error(`Audit action ${originalAction} does not have an automatic revert adapter.`);
  }
  throw new Error(`Review operation ${review.operation_type} cannot be applied automatically.`);
};

const handleReviewAction = async ({ request, supabase, identity, profile, reviewId }) => {
  requireRole(identity, "admin");
  const body = await bodyJson(request);
  const action = String(body.action || "");
  const review = requireData(await supabase.from("review_requests").select("*, submitted_by_profile:profiles!review_requests_submitted_by_fkey(id,email,display_name,role)").eq("id", reviewId).single(), "Load review request");
  if (body.note) requireData(await supabase.from("review_notes").insert({ review_request_id: reviewId, author_id: profile.id, note: String(body.note) }), "Add review note");
  if (action === "add_note") {
    const audit = await writeAudit(supabase, profile, { actionType: "review_note_added", targetType: "review_request", targetId: reviewId, intentSummary: `Add note to: ${review.intent_summary}`, reason: body.note || "", beforeSnapshot: { status: review.status }, afterSnapshot: { status: review.status, noteAdded: true }, result: "note_added" });
    return json(200, { ok: true, accepted: true, mode: "review-resolved", status: review.status, auditEventId: audit.id, message: "Admin note saved and audited." });
  }
  const statusMap = { approve: "applied", apply: "applied", reject: "rejected", request_changes: "changes_requested", cancel: "cancelled" };
  if (!statusMap[action]) throw Object.assign(new Error("Action must be approve, apply, reject, request_changes, cancel, or add_note."), { status: 400 });
  if (!["pending_review", "changes_requested", "failed"].includes(review.status) && !["cancel"].includes(action)) throw Object.assign(new Error(`This request is already ${review.status}.`), { status: 409 });
  let applied = null;
  try {
    if (["approve", "apply"].includes(action)) applied = await applyReview(supabase, review, profile);
    requireData(await supabase.from("review_requests").update({ status: statusMap[action], reviewed_by: profile.id, error_message: null }).eq("id", reviewId), "Update review status");
  } catch (error) {
    requireData(await supabase.from("review_requests").update({ status: "failed", reviewed_by: profile.id, error_message: error.message }).eq("id", reviewId), "Record review failure");
    await writeAudit(supabase, profile, { actionType: "review_failed", targetType: "review_request", targetId: reviewId, intentSummary: review.intent_summary, reason: body.note || action, beforeSnapshot: { status: review.status }, afterSnapshot: { status: "failed", error: error.message }, result: "failed" });
    throw error;
  }
  const audit = await writeAudit(supabase, profile, { actionType: `review_${action}`, targetType: "review_request", targetId: reviewId, intentSummary: review.intent_summary, reason: body.note || action, beforeSnapshot: { status: review.status, proposal: review.after_snapshot }, afterSnapshot: { status: statusMap[action], applied }, result: statusMap[action] });
  return json(200, operationResult({ identity, profile, mode: ["approve", "apply"].includes(action) ? "database-applied" : "review-resolved", riskLevel: review.risk_level, audit, artifact: applied?.afterArtifact || null, message: ["approve", "apply"].includes(action) ? "Review approved and the database change is live immediately." : `Review request ${statusMap[action].replaceAll("_", " ")}.`, extra: { reviewRequestId: reviewId, reviewStatus: statusMap[action], sourceFilesChanged: applied?.sourceFilesChanged || false, canonicalEffect: applied?.canonicalEffect || null } }));
};

const handleDecisionResolution = async ({ request, supabase, identity, profile, decisionId }) => {
  requireRole(identity, "contributor");
  const body = await bodyJson(request);
  const applicationType = ["record_only", "structured_update", "rewrite_request", "source_rewrite"].includes(body.applicationType) ? body.applicationType : body.rewriteRequested ? "rewrite_request" : "record_only";
  const riskLevel = body.criticalDecision || applicationType === "source_rewrite" || /foundation|canon|legal|monetization|public/i.test(String(body.workType || "")) ? "high" : applicationType === "rewrite_request" ? "medium" : "low";
  const appliesImmediately = databaseDisposition({ role: identity.userRole, operationType: "decision_resolution", riskLevel }).mode === "apply";
  const resolution = requireData(await supabase.from("decision_resolutions").insert({
    decision_id: decisionId,
    selected_resolution: String(body.selectedResolution || body.resolution?.selected || "custom"),
    custom_resolution: String(body.customResolution || body.resolution?.custom || ""),
    rationale: String(body.rationale || body.reason || ""),
    application_type: applicationType,
    canonical_effect: "unchanged",
    source_effect: "source prose unchanged",
    submitted_by: profile.id,
    reviewed_by: appliesImmediately ? profile.id : null,
    status: appliesImmediately ? "applied" : "pending_review",
    affected_records: asArray(body.affectedRecords || body.affectedArchiveRecords),
    affected_files: asArray(body.affectedFiles || body.affectedSourceFiles),
    follow_up_tasks: asArray(body.followUpTasks || body.followUp),
    source_files_changed: false,
  }).select().single(), "Create decision resolution");
  let review = null;
  const intent = `Record resolution for ${decisionId}: ${resolution.custom_resolution || resolution.selected_resolution}.`;
  const structuredUpdate = { canonStatus: body.canonStatusResult || null, reviewStatus: body.reviewStatusResult || null };
  if (appliesImmediately) {
    requireData(await supabase.from("decisions").update({ status: "decision-recorded" }).eq("id", decisionId), "Update decision state");
  } else {
    review = await createReviewRequest(supabase, profile, { operationType: "decision_resolution", targetType: "decision", targetId: decisionId, riskLevel, intentSummary: intent, reason: resolution.rationale, beforeSnapshot: { status: "open" }, afterSnapshot: { resolutionId: resolution.id, applicationType, structuredUpdate, sourceFilesChanged: false }, affectedRecords: resolution.affected_records, affectedFiles: resolution.affected_files });
  }
  const audit = await writeAudit(supabase, profile, { actionType: "decision_resolution", targetType: "decision", targetId: decisionId, intentSummary: intent, reason: resolution.rationale, beforeSnapshot: { status: "open" }, afterSnapshot: { resolutionId: resolution.id, applicationType, sourceFilesChanged: false, canonicalEffect: "unchanged" }, result: appliesImmediately ? "decision_recorded" : "pending_review" });
  return json(appliesImmediately ? 201 : 202, operationResult({ identity, profile, mode: appliesImmediately ? "database-applied" : "pending-review", riskLevel, audit, review, message: appliesImmediately ? "Decision record saved. Source prose and canonical archive data are unchanged." : "Resolution saved for review. Source prose and canonical archive data are unchanged.", extra: { decisionResolution: resolution, sourceFilesChanged: false, canonicalEffect: "unchanged", sourceEffect: "source prose unchanged" } }));
};

const handleCreateRevert = async ({ request, supabase, identity, profile, auditId }) => {
  requireRole(identity, "admin");
  const body = await bodyJson(request);
  const original = requireData(await supabase.from("audit_events").select("*").eq("id", auditId).single(), "Load audit event");
  if (!["applied", "decision_recorded"].includes(original.result)) throw Object.assign(new Error("Only applied audit events can produce a revert request."), { status: 409 });
  const review = await createReviewRequest(supabase, profile, {
    operationType: "revert_audit", targetType: original.target_type, targetId: original.target_id,
    riskLevel: /canon|rights|visibility|source/i.test(original.action_type) ? "high" : "medium",
    intentSummary: `Revert ${original.action_type} on ${original.target_id}.`, reason: String(body.reason || "Admin revert request"),
    beforeSnapshot: original.after_snapshot,
    afterSnapshot: { auditId, originalAction: original.action_type, restore: original.before_snapshot },
    affectedArtifacts: original.target_type === "artifact" ? [original.target_id] : [],
  });
  const audit = await writeAudit(supabase, profile, { actionType: "revert_requested", targetType: original.target_type, targetId: original.target_id, intentSummary: review.intent_summary, reason: body.reason, beforeSnapshot: original.after_snapshot, afterSnapshot: original.before_snapshot, result: "pending_review" });
  return json(201, operationResult({ identity, profile, mode: "pending-review", riskLevel: review.risk_level, review, audit, message: "Revert request created. It remains separate from the original audit history." }));
};

const handleCreateExport = async ({ request, supabase, config, identity, profile, runtime }) => {
  requireRole(identity, "contributor");
  const body = await bodyJson(request);
  const exportType = String(body.exportType || "artifact-index");
  const title = String(body.title || exportType.replaceAll("-", " "));
  const artifactIds = asArray(body.artifactIds);
  let artifactsQuery = supabase.from("artifacts").select(artifactSelect).order("title");
  if (artifactIds.length) artifactsQuery = artifactsQuery.in("id", artifactIds);
  const artifacts = requireData(await artifactsQuery, "Build artifact export").map((artifact) => ({
    ...artifact,
    tags: (artifact.artifact_tags || []).map((link) => link.tags?.name).filter(Boolean),
    categories: (artifact.artifact_categories || []).map((link) => link.categories?.name).filter(Boolean),
    artifact_tags: undefined, artifact_categories: undefined,
  }));
  const payload = { schemaVersion: "1.0", generatedAt: runtime.now().toISOString(), exportType, generatedBy: profile.email, artifacts };
  if (["full-creative-os", "decision-queue", "remediation-report"].includes(exportType)) {
    payload.archiveRecords = requireData(await supabase.from("archive_records").select("*").order("title"), "Export archive records");
    payload.decisions = requireData(await supabase.from("decisions").select("*").order("id"), "Export decisions");
    payload.decisionResolutions = requireData(await supabase.from("decision_resolutions").select("*").order("created_at"), "Export resolutions");
  }
  const id = runtime.randomUUID();
  const path = `${runtime.now().toISOString().slice(0, 10)}/${id}-${slugify(exportType)}.json`;
  const content = JSON.stringify(payload, null, 2);
  requireData(await supabase.storage.from(config.exportsBucket).upload(path, content, { contentType: "application/json", upsert: false }), "Store export");
  const record = requireData(await supabase.from("exports").insert({ id, title, export_type: exportType, status: "available", storage_bucket: config.exportsBucket, storage_path: path, manifest: { artifactCount: artifacts.length, bytes: Buffer.byteLength(content) }, created_by: profile.id }).select().single(), "Record export");
  const signed = requireData(await supabase.storage.from(config.exportsBucket).createSignedUrl(path, 3600, { download: `${slugify(title)}.json` }), "Sign export download");
  const audit = await writeAudit(supabase, profile, { actionType: "export_created", targetType: "export", targetId: id, intentSummary: `Create ${title} export.`, reason: body.reason, beforeSnapshot: {}, afterSnapshot: { exportType, artifactCount: artifacts.length, storagePath: path }, result: "applied" });
  return json(201, operationResult({ identity, profile, mode: "database-applied", audit, message: "Export generated from Supabase and stored as a downloadable file.", extra: { export: { ...record, signedUrl: signed.signedUrl } } }));
};

/**
 * @param {Record<string, unknown>} services
 * @returns {(request: Request, runtime: import("../runtime/runtime-adapter.ts").RuntimeAdapter) => Promise<Response>}
 */
export const createCreativeOsHandler = (services = {}) => async (request, runtime) => {
  if (!runtime?.name) throw new Error("Creative OS requires an identified RuntimeAdapter.");
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...headers, "access-control-allow-methods": "GET,POST,PATCH,OPTIONS", "access-control-allow-headers": "authorization,content-type" } });
  const requestUrl = new URL(request.url);
  const path = requestUrl.searchParams.get("resource") || routePath(request);
  const routePolicy = classifyCreativeOsRoute(request.method, path);
  const environment = runtimeEnvironment(runtime);
  const deployment = runtime.deploymentMetadata();
  const config = services.config || supabaseConfig(environment);
  if (request.method === "GET" && path === "health") return json(200, {
    ok: true,
    health: "reachable",
    architecture: "creative-os-authoritative-runtime",
    runtimeContext: config.runtimeContext || null,
    declaredProjectRef: config.projectRef || null,
    derivedProjectRef: config.derivedProjectRef || null,
    canonicalProductionProjectRef: CANONICAL_SUPABASE_PROJECT_REF,
    requiredSchemaContractVersion: CREATIVE_OS_SCHEMA_CONTRACT_VERSION,
    requiredMutationAuthority: CREATIVE_OS_MUTATION_AUTHORITY,
    supabaseConfigured: config.configured,
    configurationValid: config.configured,
    environment: {
      supabaseUrlConfigured: Boolean(config.url),
      projectRefConfigured: Boolean(config.projectRef),
      runtimeContextConfigured: Boolean(config.runtimeContext),
      anonKeyConfigured: Boolean(config.anonKey),
      serviceRoleConfigured: Boolean(config.serviceRoleKey),
    },
    missing: config.missing,
    configurationErrors: (config.configurationErrors || []).map(({ code, message }) => ({ code, message })),
    githubRoutineWrites: false,
    requiredStorageBuckets: REQUIRED_STORAGE_BUCKETS,
    readinessEndpoint: "/api/creative-os/ready",
    deployedBranch: deployment.branch,
    deployId: deployment.deployId,
    commitRef: deployment.commitRef,
  });
  if (path === "health/audit-probe") return json(410, { ok: false, error: "The mutating health audit probe was removed. Use the read-only readiness endpoint.", readinessEndpoint: "/api/creative-os/ready" });

  let supabase;
  let readiness;
  try {
    if (config.configured) supabase = services.supabase || getSupabaseAdmin(environment, config);
    const forceReadiness = request.method === "GET" && ["ready", "health/full"].includes(path);
    readiness = services.readiness || await getRuntimeReadiness({ supabase, config, now: runtime.now(), force: forceReadiness });
  } catch {
    readiness = { ready: false, failures: [{ component: "runtime", code: "readiness_check_failed", message: "Creative OS readiness verification could not complete." }], checks: { configurationValid: config.configured } };
  }

  if (request.method === "GET" && ["ready", "health/full"].includes(path)) return json(readiness.ready ? 200 : 503, {
    ok: readiness.ready,
    ready: readiness.ready,
    architecture: "creative-os-authoritative-runtime",
    runtimeContext: config.runtimeContext || null,
    declaredProjectRef: config.projectRef || null,
    derivedProjectRef: config.derivedProjectRef || null,
    requiredSchemaContractVersion: CREATIVE_OS_SCHEMA_CONTRACT_VERSION,
    requiredMutationAuthority: CREATIVE_OS_MUTATION_AUTHORITY,
    checks: readiness.checks,
    failures: readiness.failures,
    githubRoutineWrites: false,
  });

  if (!readiness.ready) return json(503, {
    ok: false,
    ready: false,
    error: "Creative OS runtime is not ready for application requests.",
    failures: readiness.failures,
  });

  const identity = services.identity || await resolveNetlifyIdentity(request, environment);
  try { authorizeCreativeOsRoute(identity, routePolicy); }
  catch (error) {
    return json(error.status || 401, {
      ok: false,
      error: error.message,
      authenticated: Boolean(identity?.authenticated),
      userRole: identity?.authenticated ? identity.userRole : "viewer",
      authFailure: error.authFailure || null,
      databaseWriteAttempted: false,
      databaseWriteApplied: false,
    });
  }
  let profile;
  try {
    profile = services.profile || (identity.authMethod === "explicit-local-owner"
      ? await loadLocalOwnerProfile(supabase, identity)
      : await ensureProfile(supabase, identity));
  } catch (error) {
    return json(503, { ok: false, error: error.message, authenticated: true, userRole: identity.userRole, databaseWriteAttempted: false, databaseWriteApplied: false });
  }

  try {
    if (request.method === "GET" && path === "artifacts") {
      const pendingRequests = requireData(await supabase.from("review_requests").select("id,operation_type,target_id,status,risk_level,intent_summary,reason,before_snapshot,after_snapshot,created_at").eq("submitted_by", profile.id).in("status", ["pending_review", "changes_requested", "failed"]).order("created_at", { ascending: false }), "Load employee proposals");
      const page = await listArtifacts(supabase, identity, requestUrl.searchParams);
      return json(200, { ok: true, authenticated: true, userRole: identity.userRole, ...page, pendingRequests });
    }
    if (request.method === "GET" && path === "organization/options") {
      return json(200, { ok: true, ...(await loadOrganizationOptions(supabase)) });
    }
    const controlledValuesMatch = path.match(/^controlled-values\/(categories|tags)$/);
    if (request.method === "POST" && controlledValuesMatch) return await handleCreateControlledValue({ request, supabase, identity, profile, kind: controlledValuesMatch[1] });
    const controlledValueMatch = path.match(/^controlled-values\/(categories|tags)\/([0-9a-f-]+)$/i);
    if (request.method === "PATCH" && controlledValueMatch) return await handleUpdateControlledValue({ request, supabase, identity, profile, kind: controlledValueMatch[1], valueId: controlledValueMatch[2], runtime });
    if (request.method === "GET" && path === "categories") return json(200, { ok: true, categories: requireData(await supabase.from("categories").select("*").order("name"), "Load categories") });
    if (request.method === "GET" && path === "review-requests") {
      requireRole(identity, "admin");
      const requests = requireData(await supabase.from("review_requests").select("*, submitted_by_profile:profiles!review_requests_submitted_by_fkey(id,email,display_name,role), reviewed_by_profile:profiles!review_requests_reviewed_by_fkey(id,email,display_name,role), review_notes(*, author:profiles!review_notes_author_id_fkey(display_name,email,role))").order("created_at", { ascending: false }).limit(250), "Load review queue");
      const audits = requireData(await supabase.from("audit_events").select("*").order("created_at", { ascending: false }).limit(100), "Load audit history");
      return json(200, { ok: true, requests, audits, diagnostics: { databaseQueueLoaded: true, supabaseConfigured: true, pendingReviews: requests.filter((item) => item.status === "pending_review").length, failed: requests.filter((item) => item.status === "failed").length, auditEvents: audits.length, errors: [] } });
    }
    if (request.method === "GET" && path === "exports") {
      const records = requireData(await supabase.from("exports").select("*").order("created_at", { ascending: false }).limit(100), "Load exports");
      const exports = records.map((record) => ({ ...record, signedUrl: null, storageError: null }));
      const byBucket = new Map();
      for (const record of exports) {
        if (!record.storage_bucket || !record.storage_path) continue;
        const group = byBucket.get(record.storage_bucket) || [];
        group.push(record);
        byBucket.set(record.storage_bucket, group);
      }
      await mapWithConcurrency([...byBucket.entries()], 6, async ([bucket, group]) => {
        const signed = await supabase.storage.from(bucket).createSignedUrls(group.map((record) => record.storage_path), 3600);
        const signedByPath = new Map((signed.data || []).map((item) => [item.path, item]));
        for (const record of group) {
          record.signedUrl = signedByPath.get(record.storage_path)?.signedUrl || null;
          record.storageError = signed.error?.message || signedByPath.get(record.storage_path)?.error || null;
        }
      });
      return json(200, { ok: true, exports });
    }
    if (request.method === "GET" && path === "imports/status") return await handleImportStatus({ supabase, identity, profile });
    if (request.method === "POST" && path === "imports/repo-metadata") return await handleRepoMetadataImport({ supabase, identity, profile, runtime });
    if (request.method === "POST" && path === "imports/archive-folder") return await handleArchiveFolderImport({ supabase, identity, profile, runtime });
    if (request.method === "POST" && path === "folders") return await handleCreateFolder({ request, supabase, identity, profile });
    if (request.method === "POST" && path === "import-batches") return await handleCreateBrowserImportBatch({ request, supabase, identity, profile, runtime });
    const importFileMatch = path.match(/^import-batches\/([0-9a-f-]+)\/files$/i);
    if (request.method === "PATCH" && importFileMatch) return await handleImportBatchFileStatus({ request, supabase, identity, profile, batchId: importFileMatch[1], runtime });
    const importCompleteMatch = path.match(/^import-batches\/([0-9a-f-]+)\/complete$/i);
    if (request.method === "POST" && importCompleteMatch) return await handleCompleteBrowserImportBatch({ supabase, identity, profile, batchId: importCompleteMatch[1], runtime });
    if (request.method === "POST" && path === "uploads/sign") return await handleUploadSign({ request, supabase, config, identity, profile, runtime });
    if (request.method === "POST" && path === "uploads/complete") return await handleUploadComplete({ request, supabase, config, identity, profile, runtime });
    const tagMatch = path.match(/^artifacts\/(.+)\/tags$/);
    if (request.method === "POST" && tagMatch) return await handleTagChange({ request, supabase, identity, profile, artifactId: decodeURIComponent(tagMatch[1]) });
    const categoryMatch = path.match(/^artifacts\/(.+)\/categories$/);
    if (request.method === "POST" && categoryMatch) return await handleCategoryChange({ request, supabase, identity, profile, artifactId: decodeURIComponent(categoryMatch[1]) });
    const moveMatch = path.match(/^artifacts\/(.+)\/move$/);
    if (request.method === "POST" && moveMatch) return await handleMoveArtifact({ request, supabase, identity, profile, artifactId: decodeURIComponent(moveMatch[1]), runtime });
    if (request.method === "POST" && path === "artifacts/bulk/organization") return await handleOrganizationChange({ request, supabase, identity, profile });
    const organizationMatch = path.match(/^artifacts\/(.+)\/organization$/);
    if (request.method === "POST" && organizationMatch) return await handleOrganizationChange({ request, supabase, identity, profile, artifactIds: [decodeURIComponent(organizationMatch[1])] });
    const downloadMatch = path.match(/^artifacts\/(.+)\/download$/);
    if (request.method === "GET" && downloadMatch) return await handleArtifactDownloadGrant({ supabase, identity, artifactId: decodeURIComponent(downloadMatch[1]) });
    const artifactMatch = path.match(/^artifacts\/(.+)$/);
    if (request.method === "PATCH" && artifactMatch) return await handleMetadataChange({ request, supabase, identity, profile, artifactId: decodeURIComponent(artifactMatch[1]) });
    const reviewMatch = path.match(/^review-requests\/([0-9a-f-]+)\/action$/i);
    if (request.method === "POST" && reviewMatch) return await handleReviewAction({ request, supabase, identity, profile, reviewId: reviewMatch[1] });
    const revertMatch = path.match(/^audit-events\/([0-9a-f-]+)\/revert$/i);
    if (request.method === "POST" && revertMatch) return await handleCreateRevert({ request, supabase, identity, profile, auditId: revertMatch[1] });
    const decisionMatch = path.match(/^decisions\/(.+)\/resolutions$/);
    if (request.method === "POST" && decisionMatch) return await handleDecisionResolution({ request, supabase, identity, profile, decisionId: decodeURIComponent(decisionMatch[1]).toUpperCase() });
    if (request.method === "POST" && path === "exports") return await handleCreateExport({ request, supabase, config, identity, profile, runtime });
    return json(404, { ok: false, error: `No Creative OS API route for ${request.method} /${path}` });
  } catch (error) {
    return json(error.status || 500, { ok: false, accepted: false, mode: "failed", error: error.message || "Creative OS database operation failed.", authenticated: true, userRole: identity.userRole, databaseConfigured: true, databaseWriteAttempted: request.method !== "GET", databaseWriteApplied: false, githubWriteAttempted: false });
  }
};

const handleArtifactDownloadGrant = async ({ supabase, identity, artifactId }) => {
  const artifact = await getArtifactMetadata(supabase, artifactId);
  if (artifact.visibility === "private" && !privileged(identity.userRole)) {
    throw Object.assign(new Error("Private artifacts require admin or owner authority."), { status: 403 });
  }
  if (artifact.file_status !== "available" || !artifact.storage_bucket || !artifact.storage_path) {
    throw Object.assign(new Error("This artifact does not have an available private Storage object."), { status: 409 });
  }
  const expiresIn = 300;
  const signed = requireData(await supabase.storage.from(artifact.storage_bucket).createSignedUrl(
    artifact.storage_path,
    expiresIn,
    { download: artifact.original_file_name || true },
  ), "Create artifact download grant");
  return json(200, {
    ok: true,
    artifactId: artifact.id,
    object: { bucket: artifact.storage_bucket, path: artifact.storage_path },
    downloadUrl: signed.signedUrl,
    expiresIn,
  });
};

export const handleCreativeOs = createCreativeOsHandler();

export default handleCreativeOs;
