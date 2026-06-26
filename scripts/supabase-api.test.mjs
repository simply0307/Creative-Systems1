import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { databaseDisposition, canViewArtifact } from "../netlify/functions/lib/database-policy.mjs";
import { matchArtifactForUpload, mergeStaticArtifact, summarizeImportStatus } from "../netlify/functions/lib/import-tools.mjs";
import { mediaKind, presentArtifact, slugify, supabaseConfig } from "../netlify/functions/lib/supabase.mjs";
import { handleCreativeOsRequest, organizationDisposition, REQUIRED_STORAGE_BUCKETS, runSetupHealthCheck } from "../netlify/functions/creative-os.mjs";
import { controlledTagSlug, mediumForFile, uploadDefaults } from "../src/data/artifact-organization.mjs";
import { effectiveArtifactType, filterArtifacts, normalizeArtifactFilters } from "../src/lib/artifact-filters.mjs";
import repoImportManifest from "../src/generated/repo-import-manifest.json" with { type: "json" };

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("owner low-risk tag changes apply directly", () => assert.equal(databaseDisposition({ role: "owner", operationType: "artifact_tag_update", riskLevel: "low" }).mode, "apply"));
test("admin low-risk tag changes apply directly", () => assert.equal(databaseDisposition({ role: "admin", operationType: "artifact_tag_update", riskLevel: "low" }).mode, "apply"));
test("editor low-risk tag changes apply directly", () => assert.equal(databaseDisposition({ role: "editor", operationType: "artifact_tag_update", riskLevel: "low" }).mode, "apply"));
test("contributor tag changes enter review", () => assert.equal(databaseDisposition({ role: "contributor", operationType: "artifact_tag_update", riskLevel: "low" }).mode, "review"));
test("contributor uploads enter review", () => assert.equal(databaseDisposition({ role: "contributor", operationType: "artifact_upload", riskLevel: "low" }).mode, "review"));
test("owner uploads apply directly", () => assert.equal(databaseDisposition({ role: "owner", operationType: "artifact_upload", riskLevel: "low" }).mode, "apply"));
test("high-risk owner decision still requires review", () => assert.equal(databaseDisposition({ role: "owner", operationType: "decision_resolution", riskLevel: "high" }).mode, "review"));
test("private files require admin or owner", () => { assert.equal(canViewArtifact({ role: "contributor", visibility: "private" }), false); assert.equal(canViewArtifact({ role: "admin", visibility: "private" }), true); });

test("organization governance applies admin changes and reviews contributor controlled metadata", () => {
  assert.equal(organizationDisposition({ role: "owner", controlled: true }), "apply");
  assert.equal(organizationDisposition({ role: "admin", controlled: true }), "apply");
  assert.equal(organizationDisposition({ role: "contributor", controlled: true }), "review");
  assert.equal(organizationDisposition({ role: "editor", controlled: true }), "review");
  assert.equal(organizationDisposition({ role: "editor", controlled: false }), "apply");
});

test("upload defaults standardize medium and required metadata", () => {
  assert.equal(mediumForFile("reference.png", "image/png"), "image");
  assert.equal(mediumForFile("notes.md", ""), "markdown");
  assert.deepEqual(uploadDefaults("guide.pdf", "application/pdf"), {
    artifact_type: "pdf", project: "unassigned", intended_use: "unassigned", rights_status: "needs-review",
    review_status: "needs-tagging", canon_status: "draft", visibility: "internal", lifecycle_status: "uploaded",
  });
  assert.equal(controlledTagSlug("review", "approved"), "review-approved");
});

test("artifact filters use MIME truth for image and PDF media", () => {
  const artifacts = [
    { id: "image", artifact_type: "pdf", mime_type: "image/webp", original_file_name: "image.webp", tags: [], categories: [], archiveRecords: [] },
    { id: "pdf", artifact_type: "image", mime_type: "application/pdf", original_file_name: "guide.pdf", tags: [], categories: [], archiveRecords: [] },
  ];
  assert.equal(effectiveArtifactType(artifacts[0]), "image");
  assert.deepEqual(filterArtifacts(artifacts, { artifact_type: "pdf" }).map((item) => item.id), ["pdf"]);
  assert.deepEqual(filterArtifacts(artifacts, { medium: "image" }).map((item) => item.id), ["image"]);
});

test("search, category, tag, and controlled metadata filters combine with AND semantics", () => {
  const artifacts = [
    { id: "match", title: "Para rules", artifact_type: "pdf", mime_type: "application/pdf", project: "para-poker", rights_status: "public-safe", review_status: "approved", visibility: "exportable", lifecycle_status: "export-ready", intended_use: "rules-reference", tags: [{ id: "tag-1", slug: "style-bold", name: "bold", tag_type: "style" }], categories: [{ id: "cat-1", slug: "rules", name: "Rules" }], archiveRecords: [] },
    { id: "wrong-medium", title: "Para rules image", artifact_type: "image", mime_type: "image/png", project: "para-poker", rights_status: "public-safe", review_status: "approved", visibility: "exportable", lifecycle_status: "export-ready", intended_use: "rules-reference", tags: [{ id: "tag-1", slug: "style-bold", name: "bold", tag_type: "style" }], categories: [{ id: "cat-1", slug: "rules", name: "Rules" }], archiveRecords: [] },
  ];
  const filters = { search: "para", artifact_type: "pdf", category: "cat-1", tag: "tag-1", project: "para-poker", rights_status: "public-safe", review_status: "approved", visibility: "exportable" };
  assert.deepEqual(filterArtifacts(artifacts, filters).map((item) => item.id), ["match"]);
  assert.deepEqual(filterArtifacts(artifacts, { ...filters, category: "missing" }), []);
});

test("artifact filter aliases normalize frontend and API field names", () => {
  assert.deepEqual(normalizeArtifactFilters({ medium: "pdf", workflow: "reviewed", review_state: "approved", category_slug: "rules", tag_slug: "bold", function: "reference-only" }), {
    artifact_type: "pdf", lifecycle_status: "reviewed", review_status: "approved", category: "rules", tag: "bold", intended_use: "reference-only",
  });
});

test("Supabase config reports all required secrets", () => {
  const config = supabaseConfig({});
  assert.deepEqual(config.missing.sort(), ["SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_URL"]);
});

test("health route is available before authentication", async () => {
  const config = { configured: true, missing: [], url: "https://project.supabase.co", anonKey: "publishable-test-value", serviceRoleKey: "secret-test-value", artifactsBucket: "artifacts", exportsBucket: "exports" };
  const response = await handleCreativeOsRequest(new Request("https://example.test/api/creative-os/health"), {}, { config });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.architecture, "supabase-operational");
  assert.equal(body.githubRoutineWrites, false);
  assert.deepEqual(body.environment, { supabaseUrlConfigured: true, anonKeyConfigured: true, serviceRoleConfigured: true });
  assert.deepEqual(body.requiredStorageBuckets, REQUIRED_STORAGE_BUCKETS);
  assert.equal(JSON.stringify(body).includes(config.serviceRoleKey), false);
  assert.equal(JSON.stringify(body).includes(config.anonKey), false);
});

test("deep health check proves database reads and all private buckets", async () => {
  const query = (result) => ({
    select() { return this; }, eq() { return this; }, order() { return this; }, limit() { return this; },
    then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); },
  });
  const supabase = {
    from(table) { return query(table === "artifacts" ? { data: null, count: 23, error: null } : { data: [{ id: "audit-1", created_at: "2026-06-18T12:00:00Z" }], error: null }); },
    storage: { listBuckets: async () => ({ data: REQUIRED_STORAGE_BUCKETS.map((name) => ({ id: name, name, public: false })), error: null }) },
  };
  const checks = await runSetupHealthCheck({ supabase, config: { url: "https://project.supabase.co", anonKey: "publishable", serviceRoleKey: "secret", artifactsBucket: "artifacts", exportsBucket: "exports" }, identity: { authenticated: true, userRole: "owner" } });
  assert.equal(checks.databaseConnected, true);
  assert.equal(checks.artifactsReadable, true);
  assert.equal(checks.artifactCount, 23);
  assert.equal(checks.storageBucketsReady, true);
  assert.equal(checks.auditWriteVerified, true);
  assert.equal(checks.userRole, "owner");
  assert.deepEqual(checks.errors, []);
});

test("deep health check reports missing or public buckets", async () => {
  const query = (result) => ({ select() { return this; }, eq() { return this; }, order() { return this; }, limit() { return this; }, then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); } });
  const supabase = { from: () => query({ data: [], count: 0, error: null }), storage: { listBuckets: async () => ({ data: [{ id: "artifacts", name: "artifacts", public: true }], error: null }) } };
  const checks = await runSetupHealthCheck({ supabase, config: { url: "url", anonKey: "anon", serviceRoleKey: "secret", artifactsBucket: "artifacts", exportsBucket: "exports" }, identity: { authenticated: true, userRole: "admin" } });
  assert.equal(checks.storageBucketsReady, false);
  assert.deepEqual(checks.nonPrivateBuckets, ["artifacts"]);
  assert.ok(checks.missingBuckets.includes("exports"));
});

test("admin audit probe writes one real health-check event without exposing keys", async () => {
  const inserted = [];
  const supabase = {
    from(table) {
      let insertMode = false;
      const chain = {
        insert(row) { insertMode = true; inserted.push(row); return this; },
        select() { return this; }, eq() { return this; }, order() { return this; }, limit() { return this; },
        single() { return Promise.resolve({ data: { id: "audit-probe-1", ...(insertMode ? inserted.at(-1) : {}) }, error: null }); },
        then(resolve, reject) { return Promise.resolve(table === "artifacts" ? { data: null, count: 1, error: null } : { data: [{ id: "audit-probe-1", created_at: "2026-06-18T12:00:00Z" }], error: null }).then(resolve, reject); },
      };
      return chain;
    },
    storage: { listBuckets: async () => ({ data: REQUIRED_STORAGE_BUCKETS.map((name) => ({ id: name, name, public: false })), error: null }) },
  };
  const config = { configured: true, missing: [], url: "https://project.supabase.co", anonKey: "publishable", serviceRoleKey: "secret", artifactsBucket: "artifacts", exportsBucket: "exports" };
  const identity = { authenticated: true, userId: "identity-owner", userEmail: "owner@example.test", userName: "Owner", userRole: "owner", authMethod: "netlify-identity" };
  const profile = { id: "profile-owner", email: identity.userEmail, role: "owner" };
  const response = await handleCreativeOsRequest(new Request("https://example.test/api/creative-os/health/audit-probe", { method: "POST", body: "{}", headers: { "content-type": "application/json" } }), {}, { config, identity, profile, supabase });
  const body = await response.json();
  assert.equal(response.status, 201);
  assert.equal(body.auditEventId, "audit-probe-1");
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].action_type, "health_check");
  assert.equal(JSON.stringify(body).includes(config.serviceRoleKey), false);
});

test("database routes reject unauthenticated requests", async () => {
  const response = await handleCreativeOsRequest(new Request("https://example.test/api/creative-os/artifacts"), {}, { config: { configured: true, missing: [], artifactsBucket: "artifacts", exportsBucket: "exports" }, identity: { authenticated: false, userRole: "viewer" } });
  assert.equal(response.status, 401);
});

test("available image artifact receives preview and download URLs", async () => {
  const fake = { storage: { from: () => ({ createSignedUrl: async (_path, _seconds, options) => ({ data: { signedUrl: options?.download ? "https://files.test/download" : "https://files.test/preview" }, error: null }) }) } };
  const artifact = await presentArtifact(fake, { id: "artifact.image", file_status: "available", storage_bucket: "artifacts", storage_path: "owner/image.png", original_file_name: "image.png", mime_type: "image/png", artifact_tags: [], artifact_categories: [], artifact_archive_records: [] });
  assert.equal(artifact.mediaKind, "image");
  assert.equal(artifact.fileAvailable, true);
  assert.equal(artifact.signedUrl, "https://files.test/preview");
  assert.equal(artifact.downloadUrl, "https://files.test/download");
});

test("missing artifact never invents a file URL", async () => {
  const fake = { storage: { from: () => { throw new Error("Storage should not be called"); } } };
  const artifact = await presentArtifact(fake, { id: "artifact.missing", file_status: "missing", artifact_tags: [], artifact_categories: [], artifact_archive_records: [] });
  assert.equal(artifact.fileAvailable, false);
  assert.equal(artifact.signedUrl, null);
});

test("media kinds cover image, PDF, and browser-readable text", () => {
  assert.equal(mediaKind("image/png", "x"), "image");
  assert.equal(mediaKind("application/pdf", "x"), "pdf");
  assert.equal(mediaKind("text/markdown", "x"), "text");
});

test("migration defines required operational tables and private buckets", () => {
  const sql = read("supabase/migrations/202606180001_creative_os.sql");
  for (const table of ["profiles", "artifacts", "tags", "artifact_tags", "categories", "archive_records", "decisions", "decision_resolutions", "review_requests", "audit_events", "import_batches", "exports"]) assert.match(sql, new RegExp(`create table if not exists public\\.${table}`));
  for (const bucket of ["artifacts", "imports-raw", "imports-processed", "exports", "thumbnails"]) assert.match(sql, new RegExp(`'${bucket}'`));
  assert.match(sql, /on conflict \(id\) do update set public = false/);
  assert.match(sql, /enable row level security/g);
});

test("organization migration is idempotent and seeds controlled tags without slug collisions", () => {
  const sql = read("supabase/migrations/20260620032504_artifact_organization_phase1.sql");
  assert.match(sql, /add column if not exists project/);
  assert.match(sql, /add column if not exists intended_use/);
  assert.match(sql, /add column if not exists notes/);
  assert.match(sql, /on conflict \(slug\) do update/);
  for (const family of ["medium", "project", "function", "rights", "review", "canon", "visibility", "workflow", "freeform"]) assert.match(sql, new RegExp(`'${family}'`));
  const slugs = [...sql.matchAll(/\('[^']+','([^']+)','[^']+'/g)].map((match) => match[1]);
  assert.equal(new Set(slugs).size, slugs.length);
});

test("controlled-value migration prevents case duplicates and archives without deleting relationships", () => {
  const sql = read("supabase/migrations/20260620040133_controlled_values_management.sql");
  assert.match(sql, /add column if not exists is_active boolean not null default true/);
  assert.match(sql, /categories_name_ci_unique[\s\S]*lower\(btrim\(name\)\)/);
  assert.match(sql, /tags_type_name_ci_unique[\s\S]*lower\(btrim\(tag_type\)\), lower\(btrim\(name\)\)/);
  assert.doesNotMatch(sql, /delete from public\.(tags|categories)/i);
});

test("routine browser client targets Supabase API and not operations PR endpoint", () => {
  const client = read("src/scripts/creative-os-client.js");
  assert.match(client, /\/api\/creative-os\//);
  assert.doesNotMatch(client, /fetch\("\/api\/operations"/);
  assert.equal(slugify("Alien Principle"), "alien-principle");
});

test("uploads, reviews, exports, and Admin Portal use the Supabase client", () => {
  const client = read("src/scripts/creative-os-client.js");
  const upload = read("src/pages/pipeline/import.astro");
  const admin = read("src/pages/admin.astro");
  assert.match(client, /uploads\/sign/);
  assert.match(client, /uploads\/complete/);
  assert.match(client, /review-requests\/\$\{reviewId\}\/action/);
  assert.match(client, /createExport/);
  assert.match(upload, /image\/\*,application\/pdf,text\/\*/);
  assert.match(admin, /CreativeDatabase\.listReviews/);
  assert.doesNotMatch(admin, /api\/operations/);
});

test("setup guide covers keys, migration, buckets, imports, deploy, health, and acceptance", () => {
  const guide = read("docs/OPERATIONS_API.md");
  for (const phrase of ["Settings → API Keys", "SUPABASE_SERVICE_ROLE_KEY", "SQL Editor", "imports-raw", "npm run supabase:seed", "npm run supabase:files:dry", "npm run supabase:files", "Trigger deploy", "/api/creative-os/health/full", "Final live acceptance checklist"]) assert.match(guide, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("artifact library renders real previews and truthful missing states", () => {
  const page = read("src/pages/pipeline/artifacts.astro");
  assert.match(page, /artifact\.signedUrl/);
  assert.match(page, /artifact-thumbnail/);
  assert.match(page, /Expected repo file is indexed; upload it through Import Center/);
  assert.match(page, /Database write failed/);
});

test("artifact organization UI exposes metadata, bulk editing, warnings, and all requested filters", () => {
  const page = read("src/pages/pipeline/artifacts.astro");
  for (const phrase of ["Controlled tags", "Freeform tags", "Needs metadata", "Bulk organize", "Related entity", "Workflow", "organizeArtifacts", "artifact_organization_update"]) assert.match(page, new RegExp(phrase));
  for (const filter of ["artifact_type", "project", "category", "entity", "intended_use", "rights_status", "review_status", "canon_status", "visibility", "lifecycle_status", "controlled_tag", "freeform_tag", "metadata", "file"]) assert.match(page, new RegExp(`data-filter=[\\\"']${filter}[\\\"']`));
});

test("artifact filters persist in the URL and empty results remain truthful", () => {
  const page = read("src/pages/pipeline/artifacts.astro");
  assert.match(page, /syncFilterUrl/);
  assert.match(page, /restoreFilterUrl/);
  assert.match(page, /No artifacts match these filters/);
  assert.match(page, /CreativeDatabase\.filterArtifacts/);
  assert.match(page, /effectiveArtifactType/);
});

test("category and tag selectors reuse stable database IDs across import, edit, and bulk", () => {
  const artifacts = read("src/pages/pipeline/artifacts.astro");
  const imports = read("src/pages/pipeline/import.astro");
  for (const source of [artifacts, imports]) {
    assert.match(source, /categoryId|setCategoryId/);
    assert.match(source, /multiple/);
    assert.match(source, /Search tags/);
  }
  assert.match(artifacts, /addTagIds/);
  assert.match(artifacts, /removeTagIds/);
  assert.match(imports, /name="tagIds"/);
});

test("Admin Portal creates, renames, archives, and reports controlled-value usage", () => {
  const admin = read("src/pages/admin.astro");
  const api = read("netlify/functions/creative-os.mjs");
  for (const phrase of ["Manage categories and tags", "Create", "Rename", "Archive", "usageCount", "updateControlledValue"]) assert.match(`${admin}\n${api}`, new RegExp(phrase));
  assert.match(api, /controlled-values/);
  assert.match(api, /controlledValuesMatch/);
  assert.match(api, /artifactFieldByTagType/);
});

test("upload form accepts standardized batch organization metadata", () => {
  const page = read("src/pages/pipeline/import.astro");
  for (const field of ["title", "description", "project", "categoryId", "relatedEntityId", "intendedUse", "rightsStatus", "reviewStatus", "canonStatus", "visibility", "workflowStatus", "tagIds", "notes"]) assert.match(page, new RegExp(`name=[\\\"']${field}[\\\"']`));
  assert.match(page, /selectedType==='auto'\?detectType\(file\):selectedType/);
});

test("organization API supports audited single and bulk writes plus reusable filters", () => {
  const api = read("netlify/functions/creative-os.mjs");
  assert.match(api, /artifacts\/bulk\/organization/);
  assert.match(api, /artifact_organization_update/);
  assert.match(api, /artifact_organization_proposed/);
  assert.match(api, /writeAudit/);
  for (const parameter of ["project", "rights_status", "review_status", "visibility", "intended_use", "lifecycle_status"]) assert.match(api, new RegExp(`${parameter}: \\\"`));
  assert.match(api, /normalizeArtifactFilters/);
  assert.match(api, /filterArtifacts/);
  assert.match(api, /filters\.ready_for_export/);
});

test("admin approval path applies the proposal before marking it applied", () => {
  const api = read("netlify/functions/creative-os.mjs");
  const applyIndex = api.indexOf('applied = await applyReview');
  const statusIndex = api.indexOf('status: statusMap[action]');
  assert.ok(applyIndex > -1 && statusIndex > applyIndex);
  assert.match(api, /Review approved and the database change is live immediately/);
});

test("decision records state that source prose remains unchanged", () => {
  const api = read("netlify/functions/creative-os.mjs");
  assert.match(api, /source prose unchanged/);
  assert.match(api, /source_files_changed: false/);
});

test("protected repo manifest contains the expected existing content", () => {
  assert.equal(repoImportManifest.artifacts.length, 16);
  assert.equal(repoImportManifest.archiveRecords.length, 22);
  assert.equal(repoImportManifest.decisions.length, 81);
  assert.equal(repoImportManifest.expectedFiles.length, 16);
  assert.ok(repoImportManifest.expectedFiles.every((file) => file.artifactId && file.originalFileName && file.originalPath));
});

test("browser uploads reconnect by checksum, path, filename-size, then slug", () => {
  const artifacts = [
    { id: "artifact.bizi", title: "Bizi Constantinople Reference", slug: "bizi-constantinople", original_file_name: "bizi.png", file_size: 42, file_status: "needs_import", provenance: { checksumSha256: "a".repeat(64), workspaceRelativePath: "Archive/Art/Bizi/bizi.png" }, legacy_data: {} },
  ];
  assert.equal(matchArtifactForUpload(artifacts, { fileName: "renamed.png", fileSize: 50, checksumSha256: "a".repeat(64) }).matchedBy, "checksum");
  assert.equal(matchArtifactForUpload(artifacts, { fileName: "renamed.png", relativePath: "Archive/Art/Bizi/bizi.png" }).matchedBy, "original path");
  assert.equal(matchArtifactForUpload(artifacts, { fileName: "bizi.png", fileSize: 42 }).matchedBy, "filename and size");
  assert.equal(matchArtifactForUpload(artifacts, { fileName: "bizi-constantinople.png" }).matchedBy, "slug");
});

test("available checksum match is skipped as duplicate", () => {
  const artifacts = [{ id: "artifact.image", title: "Image", slug: "image", original_file_name: "image.png", file_size: 10, file_status: "available", provenance: { checksumSha256: "b".repeat(64) } }];
  const match = matchArtifactForUpload(artifacts, { fileName: "image-copy.png", fileSize: 10, checksumSha256: "b".repeat(64) });
  assert.equal(match.duplicate, true);
  assert.equal(match.artifact.id, "artifact.image");
});

test("ambiguous filename match stops instead of creating another artifact", () => {
  const artifacts = ["one", "two"].map((id) => ({ id: `artifact.${id}`, title: id, slug: id, original_file_name: "same.png", file_size: 10, file_status: "needs_import", provenance: {} }));
  const match = matchArtifactForUpload(artifacts, { fileName: "same.png", fileSize: 10 });
  assert.equal(match.ambiguous, true);
  assert.equal(match.artifact, null);
  assert.equal(match.candidates.length, 2);
});

test("repo metadata refresh preserves an already stored private file", () => {
  const incoming = repoImportManifest.artifacts[0];
  const merged = mergeStaticArtifact(incoming, { ...incoming, file_status: "available", storage_bucket: "artifacts", storage_path: "owner/file.png", original_file_name: "file.png", mime_type: "image/png", file_size: 123, rights_status: "internal-reference-only", canon_status: "experimental", review_status: "needs-review", visibility: "private", provenance: { checksumSha256: "c".repeat(64) }, created_by: "profile-1" }, "profile-2", repoImportManifest.version);
  assert.equal(merged.file_status, "available");
  assert.equal(merged.storage_path, "owner/file.png");
  assert.equal(merged.created_by, "profile-1");
  assert.equal(merged.updated_by, "profile-2");
  assert.equal(merged.rights_status, "internal-reference-only");
  assert.equal(merged.canon_status, "experimental");
  assert.equal(merged.review_status, "needs-review");
  assert.equal(merged.visibility, "private");
});

test("import dashboard counts real availability and expected-file gaps", () => {
  const status = summarizeImportStatus({
    artifacts: [
      { id: "artifact.image", original_file_name: "image.png", mime_type: "image/png", file_size: 10, file_status: "available", provenance: { checksumSha256: "d".repeat(64) } },
      { id: "artifact.pdf", original_file_name: "doc.pdf", mime_type: "application/pdf", file_size: 20, file_status: "needs_import", provenance: {} },
      { id: "artifact.meta", original_file_name: null, mime_type: null, file_size: null, file_status: "metadata_only", provenance: {} },
    ],
    batches: [{ status: "completed_with_errors" }],
    expectedFiles: [{ artifactId: "artifact.image" }, { artifactId: "artifact.pdf" }],
  });
  assert.equal(status.totalArtifacts, 3);
  assert.equal(status.importedFiles, 1);
  assert.equal(status.filesNeedingUpload, 1);
  assert.equal(status.availableImages, 1);
  assert.equal(status.metadataOnly, 1);
  assert.equal(status.failedImports, 1);
  assert.deepEqual(status.expectedFiles.map((file) => file.status), ["available", "needs-upload"]);
});

test("Import Center exposes admin metadata import and audited retryable browser batches", () => {
  const page = read("src/pages/pipeline/import.astro");
  const client = read("src/scripts/creative-os-client.js");
  const api = read("netlify/functions/creative-os.mjs");
  assert.match(page, /Import existing repo metadata/);
  assert.match(page, /webkitdirectory/);
  assert.match(page, /Retry/);
  assert.match(page, /data-import-metric="filesNeedingUpload"/);
  assert.match(client, /crypto\.subtle\.digest/);
  assert.match(client, /imports\/repo-metadata/);
  assert.match(client, /import-batches\/\$\{batchId\}\/files/);
  assert.match(api, /handleRepoMetadataImport/);
  assert.match(api, /requireRole\(identity, "admin"\)/);
  assert.match(api, /repo_metadata_import/);
  assert.match(api, /import_file_status/);
  assert.doesNotMatch(page, /api\/operations/);
});

test("repo metadata import rejects non-admin employees before any database write", async () => {
  const config = { configured: true, missing: [], url: "https://project.supabase.co", anonKey: "publishable", serviceRoleKey: "secret", artifactsBucket: "artifacts", exportsBucket: "exports" };
  const identity = { authenticated: true, userId: "editor-1", userEmail: "editor@example.test", userName: "Editor", userRole: "editor", authMethod: "netlify-identity" };
  const response = await handleCreativeOsRequest(new Request("https://example.test/api/creative-os/imports/repo-metadata", { method: "POST", body: "{}", headers: { "content-type": "application/json" } }), {}, { config, identity, profile: { id: "profile-editor", role: "editor" }, supabase: {} });
  const body = await response.json();
  assert.equal(response.status, 403);
  assert.match(body.error, /requires admin authority/i);
});
