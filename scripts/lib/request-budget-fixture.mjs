import {
  CANONICAL_SUPABASE_PROJECT_REF,
  CREATIVE_OS_MUTATION_AUTHORITY,
  CREATIVE_OS_SCHEMA_CONTRACT_VERSION,
  REQUIRED_STORAGE_BUCKETS,
} from "../../netlify/functions/lib/runtime-contract.mjs";
import { supabaseConfig } from "../../netlify/functions/lib/supabase.mjs";

export const CURRENT_CORPUS = Object.freeze({
  artifacts: 404,
  available: 393,
  archived: 9,
  missing: 2,
});

export const ownerIdentity = Object.freeze({
  authenticated: true,
  identityVerified: true,
  userId: "fixture-owner",
  userEmail: "owner@fixture.invalid",
  userName: "Fixture Owner",
  userRole: "owner",
  authMethod: "netlify-identity",
  authFailure: null,
  authFailureStatus: null,
});

export const ownerProfile = Object.freeze({
  id: "fixture-profile-owner",
  email: ownerIdentity.userEmail,
  display_name: ownerIdentity.userName,
  role: ownerIdentity.userRole,
  identity_provider: "netlify_identity",
  identity_user_id: ownerIdentity.userId,
});

export const runtimeFixtureConfig = (overrides = {}) => supabaseConfig({
  CREATIVE_OS_RUNTIME_CONTEXT: "production",
  CREATIVE_OS_SCHEMA_CONTRACT_VERSION: String(CREATIVE_OS_SCHEMA_CONTRACT_VERSION),
  CREATIVE_OS_MUTATION_AUTHORITY,
  SUPABASE_URL: `https://${CANONICAL_SUPABASE_PROJECT_REF}.supabase.co`,
  SUPABASE_PROJECT_REF: CANONICAL_SUPABASE_PROJECT_REF,
  SUPABASE_ANON_KEY: "fixture-publishable-key",
  SUPABASE_SERVICE_ROLE_KEY: "fixture-secret-key",
  SUPABASE_STORAGE_BUCKET_ARTIFACTS: "artifacts",
  SUPABASE_STORAGE_BUCKET_EXPORTS: "exports",
  SUPABASE_STORAGE_BUCKET_IMPORTS_RAW: "imports-raw",
  SUPABASE_STORAGE_BUCKET_IMPORTS_PROCESSED: "imports-processed",
  SUPABASE_STORAGE_BUCKET_THUMBNAILS: "thumbnails",
  ...overrides,
});

export const runtimeContractFixture = Object.freeze({
  id: "creative-os",
  schema_contract_version: CREATIVE_OS_SCHEMA_CONTRACT_VERSION,
  mutation_authority: CREATIVE_OS_MUTATION_AUTHORITY,
  production_project_ref: CANONICAL_SUPABASE_PROJECT_REF,
  required_storage_buckets: REQUIRED_STORAGE_BUCKETS,
  created_at: "2026-08-07T10:38:44.440191Z",
  updated_at: "2026-08-07T10:38:44.440191Z",
});

const artifact = (index, fileStatus) => ({
  id: `artifact.fixture-${String(index + 1).padStart(4, "0")}`,
  title: `Fixture artifact ${index + 1}`,
  slug: `fixture-artifact-${index + 1}`,
  artifact_type: "image",
  source_type: "fixture",
  storage_bucket: fileStatus === "available" ? "artifacts" : null,
  storage_path: fileStatus === "available" ? `fixture/${index + 1}.png` : null,
  original_file_name: `fixture-${index + 1}.png`,
  mime_type: "image/png",
  file_status: fileStatus,
  rights_status: "unknown-needs-review",
  canon_status: "draft",
  review_status: "needs-review",
  lifecycle_status: "indexed",
  visibility: "internal",
  artifact_tags: [],
  artifact_categories: [],
  artifact_archive_records: [],
});

export const artifactCorpusFixture = () => [
  ...Array.from({ length: CURRENT_CORPUS.available }, (_, index) => artifact(index, "available")),
  ...Array.from({ length: CURRENT_CORPUS.archived }, (_, index) => artifact(CURRENT_CORPUS.available + index, "archived")),
  ...Array.from({ length: CURRENT_CORPUS.missing }, (_, index) => artifact(CURRENT_CORPUS.available + CURRENT_CORPUS.archived + index, "missing")),
];

const deferred = (value) => new Promise((resolve) => queueMicrotask(() => resolve(value)));

export const createOfflineSupabaseFixture = ({ artifacts = artifactCorpusFixture() } = {}) => {
  const fixtureState = {
    fixtureOnly: true,
    networkRequests: 0,
    mutationIntents: [],
  };
  const artifactById = new Map(artifacts.map((row) => [row.id, row]));
  let auditSequence = 0;

  const rpc = (name, args = {}) => deferred((() => {
    if (name === "creative_os_runtime_readiness") return {
      data: { contract: runtimeContractFixture, schemaCompatible: true, missingSchema: [] },
      error: null,
    };
    if (name === "creative_os_list_artifacts_page") {
      const filters = args.p_filters || {};
      const matches = artifacts.filter((row) => {
        if (!args.p_include_private && row.visibility === "private") return false;
        for (const field of ["artifact_type", "project", "intended_use", "rights_status", "review_status", "canon_status", "visibility", "lifecycle_status", "file_status"]) {
          if (filters[field] && String(row[field] || "").toLowerCase() !== String(filters[field]).toLowerCase()) return false;
        }
        if (filters.search && ![row.title, row.description, row.original_file_name, row.notes].join(" ").toLowerCase().includes(String(filters.search).toLowerCase())) return false;
        return true;
      });
      const offset = Math.max(0, Number(args.p_offset || 0));
      const limit = Math.min(50, Math.max(1, Number(args.p_limit || 24)));
      return {
        data: {
          rows: matches.slice(offset, offset + limit),
          total: matches.length,
          summary: {
            available: matches.filter((row) => row.file_status === "available").length,
            needs_import: matches.filter((row) => row.file_status === "needs_import").length,
          },
          indexedRefs: artifacts.map((row) => ({ id: row.id, path: row.provenance?.workspaceRelativePath || "" })),
        },
        error: null,
      };
    }
    if (name === "creative_os_bulk_organize_artifacts") {
      fixtureState.mutationIntents.push({ table: `rpc:${name}`, operation: "rpc" });
      const mode = args.p_apply ? "database-applied" : "pending-review";
      const results = (args.p_artifact_ids || []).map((artifactId, index) => ({
        artifactId,
        mode,
        auditEventId: `fixture-audit-${index + 1}`,
        ...(args.p_apply ? {} : { reviewRequestId: `fixture-review-${index + 1}` }),
        artifact: artifactById.get(artifactId) || null,
      }));
      return { data: { mode, affectedCount: results.length, atomic: true, results }, error: null };
    }
    return { data: null, error: { message: `Unknown fixture RPC ${name}` } };
  })());

  const resultFor = (state) => {
    if (state.operation !== "select") {
      fixtureState.mutationIntents.push({ table: state.table, operation: state.operation });
    }
    if (state.options.head) return { data: [], error: null };
    if (state.table === "creative_os_runtime_contract") return { data: runtimeContractFixture, error: null };
    if (state.table === "profile_identities") return { data: { profile_id: ownerProfile.id, provider: "netlify_identity", provider_subject: ownerIdentity.userId, profile: ownerProfile }, error: null };
    if (state.table === "profiles") return { data: ownerProfile, error: null };
    if (state.table === "artifacts") {
      if (state.operation !== "select") return { data: null, error: null };
      const id = state.filters.get("id")?.[0];
      return { data: id ? artifactById.get(id) || null : artifacts, error: null };
    }
    if (state.table === "review_requests") {
      if (state.operation === "insert") return { data: { id: "fixture-review", status: "pending_review" }, error: null };
      return { data: [], error: null };
    }
    if (state.table === "audit_events") {
      auditSequence += 1;
      return { data: { id: `fixture-audit-${auditSequence}` }, error: null };
    }
    if (state.table === "tags") return { data: [{ id: "fixture-tag", name: "fixture", slug: "freeform-fixture", tag_type: "freeform" }], error: null };
    return { data: state.single ? null : [], error: null };
  };

  const builder = (table) => {
    const state = {
      table,
      operation: "select",
      options: {},
      filters: new Map(),
      single: false,
    };
    const chain = {
      select(_columns, options = {}) { state.options = options || {}; return this; },
      insert() { state.operation = "insert"; return this; },
      update() { state.operation = "update"; return this; },
      upsert() { state.operation = "upsert"; return this; },
      delete() { state.operation = "delete"; return this; },
      eq(column, value) { state.filters.set(column, [value]); return this; },
      neq() { return this; },
      in(column, values) { state.filters.set(column, values); return this; },
      order() { return this; },
      limit() { return this; },
      single() { state.single = true; return this; },
      maybeSingle() { state.single = true; return this; },
      then(resolve, reject) { return deferred(resultFor(state)).then(resolve, reject); },
    };
    return chain;
  };

  const client = {
    from: builder,
    rpc,
    storage: {
      listBuckets: () => deferred({
        data: REQUIRED_STORAGE_BUCKETS.map((id) => ({ id, name: id, public: false })),
        error: null,
      }),
      from: (bucket) => ({
        createSignedUrl: (storagePath, _expiresIn, options = {}) => deferred({
          data: { signedUrl: `https://fixture.invalid/${bucket}/${storagePath}${options.download ? "?download=1" : ""}` },
          error: null,
        }),
        createSignedUrls: (storagePaths) => deferred({
          data: storagePaths.map((storagePath) => ({ path: storagePath, signedUrl: `https://fixture.invalid/${bucket}/${storagePath}` })),
          error: null,
        }),
      }),
    },
  };

  return { client, fixtureState, artifacts };
};
