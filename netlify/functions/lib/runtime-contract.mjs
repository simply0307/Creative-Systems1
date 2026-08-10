export const CANONICAL_SUPABASE_PROJECT_REF = "okqkljexfzolzxysjaha";
export const CREATIVE_OS_CONTRACT_ID = "creative-os";
export const CREATIVE_OS_SCHEMA_CONTRACT_VERSION = 1;
export const CREATIVE_OS_MUTATION_AUTHORITY = "creative-os-api";

export const REQUIRED_STORAGE_BUCKETS = Object.freeze([
  "artifacts",
  "exports",
  "imports-raw",
  "imports-processed",
  "thumbnails",
]);

export const REQUIRED_SCHEMA = Object.freeze({
  creative_os_runtime_contract: ["id", "schema_contract_version", "mutation_authority", "production_project_ref", "required_storage_buckets", "metadata", "created_at", "updated_at"],
  profiles: ["id", "email", "display_name", "role", "identity_provider", "identity_user_id", "created_at", "updated_at"],
  artifacts: ["id", "title", "slug", "description", "artifact_type", "source_type", "storage_bucket", "storage_path", "original_file_name", "mime_type", "file_size", "file_status", "external_url", "rights_status", "canon_status", "review_status", "lifecycle_status", "visibility", "ai_generated", "ai_model", "prompt_used", "provenance", "legacy_data", "created_by", "updated_by", "created_at", "updated_at", "project", "intended_use", "notes"],
  tags: ["id", "name", "slug", "tag_type", "description", "created_at", "updated_at", "is_active"],
  artifact_tags: ["artifact_id", "tag_id", "created_by", "created_at"],
  categories: ["id", "name", "slug", "parent_id", "description", "created_at", "updated_at", "is_active"],
  artifact_categories: ["artifact_id", "category_id", "created_by", "created_at"],
  archive_records: ["id", "title", "slug", "type", "summary", "body", "canon_status", "review_status", "risk_level", "source_data", "created_at", "updated_at"],
  artifact_archive_records: ["artifact_id", "archive_record_id", "relationship_type", "notes", "created_by", "created_at"],
  decisions: ["id", "title", "slug", "issue_summary", "why_it_matters", "recommended_fix", "status", "risk_level", "source_data", "created_at", "updated_at"],
  decision_resolutions: ["id", "decision_id", "selected_resolution", "custom_resolution", "rationale", "application_type", "canonical_effect", "source_effect", "submitted_by", "reviewed_by", "status", "affected_records", "affected_files", "follow_up_tasks", "source_files_changed", "created_at", "updated_at"],
  review_requests: ["id", "operation_type", "target_type", "target_id", "submitted_by", "reviewed_by", "status", "risk_level", "intent_summary", "reason", "before_snapshot", "after_snapshot", "affected_artifacts", "affected_records", "affected_files", "error_message", "created_at", "updated_at"],
  review_notes: ["id", "review_request_id", "author_id", "note", "created_at"],
  audit_events: ["id", "actor_id", "actor_email", "actor_role", "action_type", "target_type", "target_id", "intent_summary", "reason", "before_snapshot", "after_snapshot", "result", "created_at"],
  import_batches: ["id", "title", "source", "status", "created_by", "manifest", "created_at", "updated_at"],
  exports: ["id", "title", "export_type", "status", "storage_bucket", "storage_path", "manifest", "created_by", "created_at", "updated_at"],
});

const runtimeContexts = new Set(["production", "deploy-preview", "branch-deploy", "dev-server", "local", "test"]);
const error = (code, message) => ({ code, message });

export const deriveSupabaseProjectRef = (url) => {
  try {
    const parsed = new URL(String(url || ""));
    if (parsed.protocol !== "https:") return null;
    return parsed.hostname.toLowerCase().match(/^([a-z0-9]{20})\.supabase\.co$/)?.[1] || null;
  } catch {
    return null;
  }
};

export const validateRuntimeConfiguration = (config) => {
  const errors = [];
  const derivedProjectRef = deriveSupabaseProjectRef(config.url);
  if (config.url && !derivedProjectRef) errors.push(error("invalid_supabase_url", "SUPABASE_URL must be an HTTPS project URL of the form https://<project-ref>.supabase.co."));
  if (derivedProjectRef && config.projectRef && derivedProjectRef !== config.projectRef) errors.push(error("supabase_project_ref_mismatch", "SUPABASE_URL does not identify the declared SUPABASE_PROJECT_REF."));
  if (config.runtimeContext && !runtimeContexts.has(config.runtimeContext)) errors.push(error("invalid_runtime_context", "CREATIVE_OS_RUNTIME_CONTEXT is not one of the supported explicit contexts."));
  if (config.runtimeContext === "production" && config.projectRef && config.projectRef !== CANONICAL_SUPABASE_PROJECT_REF) errors.push(error("production_project_not_canonical", "Production must declare the canonical Creative OS Supabase project."));
  if (config.runtimeContext && config.runtimeContext !== "production" && config.projectRef === CANONICAL_SUPABASE_PROJECT_REF && !config.allowCanonicalNonProduction) errors.push(error("canonical_project_forbidden_outside_production", "Non-production use of the canonical project requires CREATIVE_OS_ALLOW_CANONICAL_NON_PRODUCTION=true."));
  if (config.schemaContractVersion && Number(config.schemaContractVersion) !== CREATIVE_OS_SCHEMA_CONTRACT_VERSION) errors.push(error("unsupported_schema_contract_version", `This runtime requires Creative OS schema contract version ${CREATIVE_OS_SCHEMA_CONTRACT_VERSION}.`));
  if (config.mutationAuthority && config.mutationAuthority !== CREATIVE_OS_MUTATION_AUTHORITY) errors.push(error("invalid_mutation_authority", `This runtime requires mutation authority ${CREATIVE_OS_MUTATION_AUTHORITY}.`));
  if (config.requiredBuckets?.length && JSON.stringify(config.requiredBuckets) !== JSON.stringify(REQUIRED_STORAGE_BUCKETS)) errors.push(error("invalid_storage_bucket_contract", "Configured Storage buckets do not match the Creative OS version 1 contract."));
  return { valid: config.missing.length === 0 && errors.length === 0, derivedProjectRef, errors };
};

const publicError = (component, code, message) => ({ component, code, message });
const sameOrderedValues = (left = [], right = []) => JSON.stringify(left) === JSON.stringify(right);
export const READINESS_CACHE_TTL_MS = 30_000;

const readinessCache = new Map();

const readinessCacheKey = (config) => [
  config.url,
  config.projectRef,
  config.runtimeContext,
  config.schemaContractVersion,
  config.mutationAuthority,
  ...(config.requiredBuckets || []),
].join("|");

export const resetRuntimeReadinessCache = () => readinessCache.clear();

export const runRuntimeReadiness = async ({ supabase, config }) => {
  const failures = [];
  const configuration = validateRuntimeConfiguration(config);
  if (!configuration.valid) {
    failures.push(...config.missing.map((name) => publicError("configuration", "missing_environment_variable", `${name} is required.`)));
    failures.push(...configuration.errors.map((item) => publicError("configuration", item.code, item.message)));
    return {
      ready: false,
      failures,
      checks: {
        configurationValid: false,
        projectIdentityMatches: false,
        contractCompatible: false,
        schemaCompatible: false,
        storageCompatible: false,
      },
    };
  }

  const [databaseResult, bucketResult] = await Promise.all([
    supabase.rpc("creative_os_runtime_readiness", undefined, { get: true }),
    supabase.storage.listBuckets(),
  ]);
  const databaseCheck = databaseResult.data || null;
  const contract = databaseCheck?.contract || null;
  if (databaseResult.error) failures.push(publicError("contract", "runtime_contract_unreadable", "Creative OS runtime contract and schema could not be read."));
  else if (!contract) failures.push(publicError("contract", "runtime_contract_missing", "Creative OS runtime contract row is missing."));
  else {
    if (Number(contract.schema_contract_version) !== CREATIVE_OS_SCHEMA_CONTRACT_VERSION) failures.push(publicError("contract", "schema_contract_version_mismatch", `Database contract version must be ${CREATIVE_OS_SCHEMA_CONTRACT_VERSION}.`));
    if (contract.mutation_authority !== CREATIVE_OS_MUTATION_AUTHORITY) failures.push(publicError("contract", "mutation_authority_mismatch", "Database mutation authority does not match this Creative OS runtime."));
    if (contract.production_project_ref !== CANONICAL_SUPABASE_PROJECT_REF) failures.push(publicError("contract", "contract_project_authority_mismatch", "Database contract does not identify the canonical production project."));
    if (!sameOrderedValues(contract.required_storage_buckets, REQUIRED_STORAGE_BUCKETS)) failures.push(publicError("contract", "contract_storage_buckets_mismatch", "Database contract Storage buckets do not match this runtime."));
  }

  if (!databaseResult.error && databaseCheck?.schemaCompatible !== true) {
    const firstMissing = Array.isArray(databaseCheck?.missingSchema) ? databaseCheck.missingSchema[0] : null;
    const location = firstMissing?.table ? ` public.${firstMissing.table}${firstMissing.column ? `.${firstMissing.column}` : ""}` : "";
    failures.push(publicError("schema", "required_table_or_column_missing", `One or more required Creative OS tables or columns are missing.${location}`));
  }

  const buckets = bucketResult.data || [];
  const bucketByName = new Map(buckets.map((bucket) => [bucket.id || bucket.name, bucket]));
  const missingBuckets = REQUIRED_STORAGE_BUCKETS.filter((name) => !bucketByName.has(name));
  const nonPrivateBuckets = REQUIRED_STORAGE_BUCKETS.filter((name) => bucketByName.has(name) && bucketByName.get(name).public !== false);
  if (bucketResult.error) failures.push(publicError("storage", "storage_buckets_unreadable", "Storage bucket configuration could not be read."));
  if (missingBuckets.length) failures.push(publicError("storage", "required_storage_bucket_missing", `Missing required private Storage bucket(s): ${missingBuckets.join(", ")}.`));
  if (nonPrivateBuckets.length) failures.push(publicError("storage", "required_storage_bucket_public", `Required Storage bucket(s) must be private: ${nonPrivateBuckets.join(", ")}.`));

  const contractFailures = failures.filter((item) => item.component === "contract");
  const schemaFailures = failures.filter((item) => item.component === "schema");
  const storageFailures = failures.filter((item) => item.component === "storage");
  return {
    ready: failures.length === 0,
    failures,
    checks: {
      configurationValid: true,
      projectIdentityMatches: configuration.derivedProjectRef === config.projectRef,
      contractCompatible: contractFailures.length === 0,
      schemaCompatible: schemaFailures.length === 0,
      storageCompatible: storageFailures.length === 0,
      schemaContractVersion: contract?.schema_contract_version ?? null,
      mutationAuthority: contract?.mutation_authority ?? null,
      requiredTableCount: Object.keys(REQUIRED_SCHEMA).length,
      missingSchema: Array.isArray(databaseCheck?.missingSchema) ? databaseCheck.missingSchema : [],
      requiredBuckets: REQUIRED_STORAGE_BUCKETS,
      bucketsFound: REQUIRED_STORAGE_BUCKETS.filter((name) => bucketByName.has(name)),
      missingBuckets,
      nonPrivateBuckets,
    },
  };
};

export const getRuntimeReadiness = async ({ supabase, config, now = new Date(), force = false }) => {
  const key = readinessCacheKey(config);
  const timestamp = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const cached = readinessCache.get(key);
  if (!force && cached && cached.expiresAt > timestamp) return cached.value;
  const value = await runRuntimeReadiness({ supabase, config });
  if (value.ready) readinessCache.set(key, { value, expiresAt: timestamp + READINESS_CACHE_TTL_MS });
  else readinessCache.delete(key);
  return value;
};
