import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { databaseDisposition, canViewArtifact } from "../netlify/functions/lib/database-policy.mjs";
import { matchArtifactForUpload, mergeStaticArtifact, summarizeImportStatus } from "../netlify/functions/lib/import-tools.mjs";
import {
  CANONICAL_SUPABASE_PROJECT_REF,
  CREATIVE_OS_MUTATION_AUTHORITY,
  CREATIVE_OS_SCHEMA_CONTRACT_VERSION,
  REQUIRED_SCHEMA,
  REQUIRED_STORAGE_BUCKETS,
  runRuntimeReadiness,
} from "../netlify/functions/lib/runtime-contract.mjs";
import { mediaKind, presentArtifact, slugify, supabaseConfig } from "../netlify/functions/lib/supabase.mjs";
import { handleCreativeOsRequest, organizationDisposition } from "../netlify/functions/creative-os.mjs";
import { controlledTagSlug, mediumForFile, uploadDefaults } from "../src/data/artifact-organization.mjs";
import { effectiveArtifactType, filterArtifacts, normalizeArtifactFilters } from "../src/lib/artifact-filters.mjs";
import repoImportManifest from "../src/generated/repo-import-manifest.json" with { type: "json" };

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const runtimeEnv = (overrides = {}) => ({
  CREATIVE_OS_RUNTIME_CONTEXT: "production",
  CREATIVE_OS_SCHEMA_CONTRACT_VERSION: String(CREATIVE_OS_SCHEMA_CONTRACT_VERSION),
  CREATIVE_OS_MUTATION_AUTHORITY,
  SUPABASE_URL: `https://${CANONICAL_SUPABASE_PROJECT_REF}.supabase.co`,
  SUPABASE_PROJECT_REF: CANONICAL_SUPABASE_PROJECT_REF,
  SUPABASE_ANON_KEY: "publishable-test-value",
  SUPABASE_SERVICE_ROLE_KEY: "secret-test-value",
  SUPABASE_STORAGE_BUCKET_ARTIFACTS: "artifacts",
  SUPABASE_STORAGE_BUCKET_EXPORTS: "exports",
  SUPABASE_STORAGE_BUCKET_IMPORTS_RAW: "imports-raw",
  SUPABASE_STORAGE_BUCKET_IMPORTS_PROCESSED: "imports-processed",
  SUPABASE_STORAGE_BUCKET_THUMBNAILS: "thumbnails",
  ...overrides,
});
const validConfig = (overrides = {}) => supabaseConfig(runtimeEnv(overrides));
const validContract = (overrides = {}) => ({
  id: "creative-os",
  schema_contract_version: CREATIVE_OS_SCHEMA_CONTRACT_VERSION,
  mutation_authority: CREATIVE_OS_MUTATION_AUTHORITY,
  production_project_ref: CANONICAL_SUPABASE_PROJECT_REF,
  required_storage_buckets: REQUIRED_STORAGE_BUCKETS,
  created_at: "2026-08-07T00:00:00Z",
  updated_at: "2026-08-07T00:00:00Z",
  ...overrides,
});
const query = (result, mutations) => {
  const chain = {
    select() { return this; }, eq() { return this; }, limit() { return this; },
    maybeSingle() { return Promise.resolve(result); },
    insert() { mutations.push("insert"); return this; },
    update() { mutations.push("update"); return this; },
    upsert() { mutations.push("upsert"); return this; },
    delete() { mutations.push("delete"); return this; },
    then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); },
  };
  return chain;
};
const readinessSupabase = ({ contract = validContract(), schemaErrors = {}, buckets = REQUIRED_STORAGE_BUCKETS.map((id) => ({ id, name: id, public: false })), mutations = [] } = {}) => ({
  mutations,
  from(table) {
    if (table === "creative_os_runtime_contract") return query(contract ? { data: contract, error: schemaErrors[table] || null } : { data: null, error: schemaErrors[table] || null }, mutations);
    return query({ data: [], error: schemaErrors[table] || null }, mutations);
  },
  storage: { listBuckets: async () => ({ data: buckets, error: null }) },
});

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

test("runtime configuration requires an explicit project ref and matching URL", () => {
  assert.ok(supabaseConfig({}).missing.includes("SUPABASE_PROJECT_REF"));
  const mismatch = validConfig({ SUPABASE_URL: "https://uzderzjbitmghfvrllvz.supabase.co" });
  assert.equal(mismatch.configured, false);
  assert.ok(mismatch.configurationErrors.some((item) => item.code === "supabase_project_ref_mismatch"));
});

test("correct URL, project ref, and contract pass readiness", async () => {
  const result = await runRuntimeReadiness({ supabase: readinessSupabase(), config: validConfig() });
  assert.equal(result.ready, true);
  assert.equal(result.checks.projectIdentityMatches, true);
  assert.equal(result.checks.schemaContractVersion, CREATIVE_OS_SCHEMA_CONTRACT_VERSION);
  assert.equal(result.checks.requiredTableCount, Object.keys(REQUIRED_SCHEMA).length);
});

test("wrong schema-contract version fails readiness", async () => {
  const result = await runRuntimeReadiness({ supabase: readinessSupabase({ contract: validContract({ schema_contract_version: 0 }) }), config: validConfig() });
  assert.equal(result.ready, false);
  assert.ok(result.failures.some((item) => item.code === "schema_contract_version_mismatch"));
});

test("missing required table or column fails readiness", async () => {
  const result = await runRuntimeReadiness({ supabase: readinessSupabase({ schemaErrors: { artifacts: { message: "column intended_use does not exist" } } }), config: validConfig() });
  assert.equal(result.ready, false);
  assert.ok(result.failures.some((item) => item.code === "required_table_or_column_missing" && item.message.includes("public.artifacts")));
});

test("missing required bucket fails readiness", async () => {
  const buckets = REQUIRED_STORAGE_BUCKETS.filter((name) => name !== "thumbnails").map((id) => ({ id, name: id, public: false }));
  const result = await runRuntimeReadiness({ supabase: readinessSupabase({ buckets }), config: validConfig() });
  assert.equal(result.ready, false);
  assert.ok(result.failures.some((item) => item.code === "required_storage_bucket_missing"));
});

test("older Creative OS schema without the contract is rejected", async () => {
  const result = await runRuntimeReadiness({ supabase: readinessSupabase({ contract: null, schemaErrors: { creative_os_runtime_contract: { message: "relation does not exist" } } }), config: validConfig() });
  assert.equal(result.ready, false);
  assert.ok(result.failures.some((item) => item.code === "runtime_contract_unreadable"));
});

test("shallow health is non-mutating and never exposes secrets", async () => {
  const config = validConfig();
  const supabase = readinessSupabase();
  const response = await handleCreativeOsRequest(new Request("https://example.test/api/creative-os/health"), {}, { config, supabase });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.health, "reachable");
  assert.equal(body.configurationValid, true);
  assert.deepEqual(supabase.mutations, []);
  assert.equal(JSON.stringify(body).includes(config.serviceRoleKey), false);
  assert.equal(JSON.stringify(body).includes(config.anonKey), false);
});

test("readiness is non-mutating and never exposes secrets", async () => {
  const config = validConfig();
  const supabase = readinessSupabase();
  const response = await handleCreativeOsRequest(new Request("https://example.test/api/creative-os/ready"), {}, { config, supabase });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ready, true);
  assert.deepEqual(supabase.mutations, []);
  assert.equal(JSON.stringify(body).includes(config.serviceRoleKey), false);
  assert.equal(JSON.stringify(body).includes(config.anonKey), false);
});

test("mutating health audit probe is removed without side effects", async () => {
  const supabase = readinessSupabase();
  const response = await handleCreativeOsRequest(new Request("https://example.test/api/creative-os/health/audit-probe", { method: "POST" }), {}, { config: validConfig(), supabase });
  assert.equal(response.status, 410);
  assert.deepEqual(supabase.mutations, []);
});

test("database routes reject unauthenticated requests after readiness", async () => {
  const response = await handleCreativeOsRequest(new Request("https://example.test/api/creative-os/artifacts"), {}, { config: validConfig(), readiness: { ready: true, failures: [], checks: {} }, identity: { authenticated: false, userRole: "viewer" } });
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
  const sql = read("supabase/migrations/20260715140231_creative_os.sql");
  for (const table of ["profiles", "artifacts", "tags", "artifact_tags", "categories", "archive_records", "decisions", "decision_resolutions", "review_requests", "audit_events", "import_batches", "exports"]) assert.match(sql, new RegExp(`create table if not exists public\\.${table}`));
  for (const bucket of ["artifacts", "imports-raw", "imports-processed", "exports", "thumbnails"]) assert.match(sql, new RegExp(`'${bucket}'`));
  assert.match(sql, /on conflict \(id\) do update set public = false/);
  assert.match(sql, /enable row level security/g);
});

test("organization migration is idempotent and seeds controlled tags without slug collisions", () => {
  const sql = read("supabase/migrations/20260715140306_artifact_organization_phase1.sql");
  assert.match(sql, /add column if not exists project/);
  assert.match(sql, /add column if not exists intended_use/);
  assert.match(sql, /add column if not exists notes/);
  assert.match(sql, /on conflict \(slug\) do update/);
  for (const family of ["medium", "project", "function", "rights", "review", "canon", "visibility", "workflow", "freeform"]) assert.match(sql, new RegExp(`'${family}'`));
  const slugs = [...sql.matchAll(/\('[^']+','([^']+)','[^']+'/g)].map((match) => match[1]);
  assert.equal(new Set(slugs).size, slugs.length);
});

test("controlled-value migration prevents case duplicates and archives without deleting relationships", () => {
  const sql = read("supabase/migrations/20260715140315_controlled_values_management.sql");
  assert.match(sql, /add column if not exists is_active boolean not null default true/);
  assert.match(sql, /categories_name_ci_unique[\s\S]*lower\(btrim\(name\)\)/);
  assert.match(sql, /tags_type_name_ci_unique[\s\S]*lower\(btrim\(tag_type\)\), lower\(btrim\(name\)\)/);
  assert.doesNotMatch(sql, /delete from public\.(tags|categories)/i);
});

test("runtime contract migration records authority, version, project, and private bucket contract", () => {
  const sql = read("supabase/migrations/20260807101623_establish_runtime_contract.sql");
  assert.match(sql, /create table if not exists public\.creative_os_runtime_contract/);
  assert.match(sql, /schema_contract_version/);
  assert.match(sql, /creative-os-api/);
  assert.match(sql, /okqkljexfzolzxysjaha/);
  for (const bucket of REQUIRED_STORAGE_BUCKETS) assert.match(sql, new RegExp(bucket));
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all[\s\S]*anon, authenticated/);
  assert.match(sql, /grant select[\s\S]*service_role/);
  assert.match(sql, /create policy[\s\S]*to service_role[\s\S]*using \(true\)/);
});

test("routine browser client targets Supabase API and not operations PR endpoint", () => {
  const client = read("src/scripts/creative-os-client.js");
  assert.match(client, /\/api\/creative-os\//);
  assert.doesNotMatch(client, /fetch\("\/api\/operations"/);
  assert.equal(slugify("Alien Principle"), "alien-principle");
});

test("uploads, reviews, and exports still use the Supabase client helpers", () => {
  const client = read("src/scripts/creative-os-client.js");
  assert.match(client, /uploads\/sign/);
  assert.match(client, /uploads\/complete/);
  assert.match(client, /review-requests\/\$\{reviewId\}\/action/);
  assert.match(client, /createExport/);
  assert.match(client, /createFolder/);
  assert.match(client, /moveArtifact/);
  assert.doesNotMatch(client, /api\/operations/);
});

test("setup guide covers keys, migration, buckets, imports, deploy, health, and acceptance", () => {
  const guide = read("docs/OPERATIONS_API.md");
  for (const phrase of ["Settings → API Keys", "SUPABASE_SERVICE_ROLE_KEY", "SQL Editor", "imports-raw", "npm run supabase:seed", "npm run supabase:files:dry", "npm run supabase:files", "Trigger deploy", "/api/creative-os/health/full", "Final live acceptance checklist"]) assert.match(guide, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("archive folder index renders previews and truthful import states", () => {
  const source = `${read("src/pages/pipeline/artifacts.astro")}\n${read("src/scripts/archive-index-client.js")}`;
  assert.match(source, /repo-import-manifest\.json/);
  assert.match(source, /archiveFiles/);
  assert.match(source, /item\.signedUrl/);
  assert.match(source, /archive-thumb/);
  assert.match(source, /Found in the read-only repository snapshot/);
  assert.match(source, /Add or attach the file to enable browser preview\/download/);
  assert.match(source, /importArchiveFolderIndex/);
  assert.match(source, /Refresh view/);
});

test("archive folder index exposes simple folder, standard tag, freeform tag, and file filters", () => {
  const source = `${read("src/pages/pipeline/artifacts.astro")}\n${read("src/scripts/archive-index-client.js")}`;
  for (const phrase of ["Folders", "Add files", "quick-index-form", "Save index fields", "Standard tags", "Freeform tags"]) assert.match(source, new RegExp(phrase));
  for (const filter of ["type", "file", "folder", "standard", "freeform"]) assert.match(source, new RegExp(`data-filter=[\\\"']${filter}[\\\"']`));
  assert.match(source, /type="file" multiple/);
  assert.match(source, /uploadArtifact/);
});

test("archive folder index filters combine locally and empty results remain truthful", () => {
  const source = `${read("src/pages/pipeline/artifacts.astro")}\n${read("src/scripts/archive-index-client.js")}`;
  assert.match(source, /filteredRecords/);
  assert.match(source, /filters\.search/);
  assert.match(source, /filters\.folder/);
  assert.match(source, /No files match these filters/);
  assert.match(source, /effectiveArtifactType/);
});

test("folder, standard tag, and freeform inputs reuse existing values across the archive index", () => {
  const artifacts = `${read("src/pages/pipeline/artifacts.astro")}\n${read("src/scripts/archive-index-client.js")}`;
  assert.match(artifacts, /folder-values/);
  assert.match(artifacts, /standard-tag-values/);
  assert.match(artifacts, /freeform-tag-values/);
  assert.match(artifacts, /moveArtifact/);
  assert.match(artifacts, /organizeArtifact/);
  assert.match(artifacts, /Create folder/);
  assert.match(artifacts, /multiple/);
});

test("controlled-value API can still create, rename, archive, and report usage", () => {
  const api = read("src/server/creative-os/handle-creative-os.mjs");
  for (const phrase of ["handleCreateControlledValue", "handleUpdateControlledValue", "usageCount", "\\$\\{singular\\}_created"]) assert.match(api, new RegExp(phrase));
  assert.match(api, /controlled-values/);
  assert.match(api, /controlledValuesMatch/);
  assert.match(api, /artifactFieldByTagType/);
});

test("archive index accepts browser file upload and standardized/freeform metadata edits", () => {
  const page = `${read("src/pages/pipeline/artifacts.astro")}\n${read("src/scripts/archive-index-client.js")}`;
  for (const field of ["title", "folder", "standardTags", "freeformTags", "notes"]) assert.match(page, new RegExp(`name=[\\\"']${field}[\\\"']`));
  assert.match(page, /folder-upload/);
  assert.match(page, /uploadArtifact/);
});

test("organization API supports audited single and bulk writes plus reusable filters", () => {
  const api = read("src/server/creative-os/handle-creative-os.mjs");
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
  const api = read("src/server/creative-os/handle-creative-os.mjs");
  const applyIndex = api.indexOf('applied = await applyReview');
  const statusIndex = api.indexOf('status: statusMap[action]');
  assert.ok(applyIndex > -1 && statusIndex > applyIndex);
  assert.match(api, /Review approved and the database change is live immediately/);
});

test("decision records state that source prose remains unchanged", () => {
  const api = read("src/server/creative-os/handle-creative-os.mjs");
  assert.match(api, /source prose unchanged/);
  assert.match(api, /source_files_changed: false/);
});

test("protected repo manifest contains the expected existing content", () => {
  assert.equal(repoImportManifest.artifacts.length, 16);
  assert.equal(repoImportManifest.archiveRecords.length, 22);
  assert.equal(repoImportManifest.decisions.length, 81);
  assert.equal(repoImportManifest.expectedFiles.length, 16);
  assert.ok(repoImportManifest.archiveFiles.length >= repoImportManifest.expectedFiles.length);
  assert.ok(repoImportManifest.archiveFolders.length > 0);
  assert.ok(repoImportManifest.archiveFiles.every((file) => file.provenance?.workspaceRelativePath?.startsWith("Archive/")));
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

test("Archive Index exposes explicit privileged metadata import and audited browser uploads", () => {
  const page = `${read("src/pages/pipeline/artifacts.astro")}\n${read("src/scripts/archive-index-client.js")}`;
  const client = read("src/scripts/creative-os-client.js");
  const api = read("src/server/creative-os/handle-creative-os.mjs");
  assert.match(page, /Refresh view/);
  assert.match(page, /importArchiveFolderIndex/);
  assert.match(page, /Review and import/);
  assert.match(page, /window\.confirm/);
  assert.match(page, /\["admin", "owner"\]\.includes\(account\.userRole\)/);
  const loadBody = page.slice(page.indexOf("const load = async"), page.indexOf("const differenceByName"));
  assert.doesNotMatch(loadBody, /importArchiveFolderIndex|importArchiveSnapshot/);
  assert.match(page, /type="file" multiple/);
  assert.match(page, /Add files finished/);
  assert.match(page, /Create folder/);
  assert.match(client, /crypto\.subtle\.digest/);
  assert.match(client, /imports\/archive-folder/);
  assert.match(api, /archive_folder_indexed/);
  assert.match(api, /handleRepoMetadataImport/);
  assert.match(api, /requireRole\(identity, "admin"\)/);
  assert.match(api, /repo_metadata_import/);
  assert.match(api, /import_file_status/);
  assert.doesNotMatch(page, /api\/operations/);
});

test("repo metadata import rejects non-admin employees before any database write", async () => {
  const config = validConfig();
  const identity = { authenticated: true, userId: "editor-1", userEmail: "editor@example.test", userName: "Editor", userRole: "editor", authMethod: "netlify-identity" };
  const response = await handleCreativeOsRequest(new Request("https://example.test/api/creative-os/imports/repo-metadata", { method: "POST", body: "{}", headers: { "content-type": "application/json" } }), {}, { config, readiness: { ready: true, failures: [], checks: {} }, identity, profile: { id: "profile-editor", role: "editor" }, supabase: {} });
  const body = await response.json();
  assert.equal(response.status, 403);
  assert.match(body.error, /requires admin authority/i);
});
