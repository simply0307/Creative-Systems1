import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import process from "node:process";
import { loadLocalEnv, root } from "./lib/setup-utils.mjs";
import { buildWorkspaceImportPlan, summarizeWorkspacePlan } from "./lib/workspace-import-plan.mjs";
import { getSupabaseAdmin, supabaseConfig } from "../netlify/functions/lib/supabase.mjs";
import { runRuntimeReadiness } from "../netlify/functions/lib/runtime-contract.mjs";

loadLocalEnv();
const apply = process.argv.includes("--apply");
const config = supabaseConfig(process.env);
const bucket = config.artifactsBucket || "artifacts";
const { plan, warnings, indexed } = buildWorkspaceImportPlan({ root, bucket });

let supabase = null;
let remoteById = new Map();
if (config.configured) {
  supabase = getSupabaseAdmin(process.env, config);
  const readiness = await runRuntimeReadiness({ supabase, config });
  if (!readiness.ready) {
    if (apply) throw new Error(`Creative OS runtime readiness failed: ${readiness.failures.join("; ")}`);
    warnings.push(`Remote artifact comparison unavailable: runtime readiness failed (${readiness.failures.join("; ")})`);
    supabase = null;
  }
}
if (supabase) {
  const remote = await supabase.from("artifacts").select("id,storage_path,provenance").in("id", plan.map((item) => item.artifact.id));
  if (!remote.error) remoteById = new Map((remote.data || []).map((item) => [item.id, item]));
  else if (apply) throw new Error(`Read existing artifacts: ${remote.error.message}`);
  else warnings.push(`Remote artifact comparison unavailable: ${remote.error.message}`);
}

const summary = summarizeWorkspacePlan({ plan, indexed, warnings, mode: apply ? "apply" : "dry-run", remoteById });
if (!apply) {
  console.log(JSON.stringify(summary, null, 2));
  console.log("Dry run only. Re-run through `npm run setup:import:apply` after inspecting this report.");
  process.exit(0);
}
if (!supabase) {
  const details = [...config.missing, ...config.configurationErrors.map((item) => item.message)].join("; ") || "readiness failed";
  console.error(`Creative OS runtime configuration is invalid: ${details}.`);
  process.exit(1);
}

const check = (label, result) => { if (result.error) throw new Error(`${label}: ${result.error.message}`); return result.data; };
const changed = plan.filter((item) => {
  const remote = remoteById.get(item.artifact.id);
  return !remote || remote.provenance?.checksumSha256 !== item.checksum || remote.storage_path !== item.objectPath;
});

if (!changed.length) {
  console.log(JSON.stringify({ ...summary, completed: 0, noChanges: true, note: "All file checksums already match; no objects, records, batches, or audits were duplicated." }, null, 2));
  process.exit(0);
}

const systemProfile = check("Create workspace import profile", await supabase.from("profiles").upsert({
  email: "workspace-import@creative-os.local",
  display_name: "Workspace import",
  role: "owner",
  identity_provider: "system",
  identity_user_id: "system.workspace-import",
}, { onConflict: "identity_user_id" }).select().single());
const changeFingerprint = createHash("sha256").update(plan.map((item) => `${item.artifact.id}:${item.checksum}`).sort().join("\n")).digest("hex").slice(0, 16);
const existingBatch = check("Find matching import batch", await supabase.from("import_batches").select("id,status").eq("source", `Archive/workspace:${changeFingerprint}`).limit(1).maybeSingle());
const batchId = existingBatch?.id || randomUUID();
const batchPayload = {
  title: `Creative Systems workspace import ${new Date().toISOString().slice(0, 10)}`,
  source: `Archive/workspace:${changeFingerprint}`,
  status: "pending_review",
  created_by: systemProfile.id,
  manifest: { ...summary, resumed: Boolean(existingBatch) },
};
if (existingBatch) check("Resume import batch", await supabase.from("import_batches").update(batchPayload).eq("id", batchId));
else check("Create import batch", await supabase.from("import_batches").insert({ id: batchId, ...batchPayload }));

let completed = 0;
let uploaded = 0;
for (const item of changed) {
  const bytes = fs.readFileSync(item.file);
  const upload = await supabase.storage.from(bucket).upload(item.objectPath, bytes, { contentType: item.artifact.mime_type, upsert: false });
  if (upload.error && !/duplicate|already exists|resource already exists/i.test(upload.error.message)) throw new Error(`Upload ${item.relative}: ${upload.error.message}`);
  if (!upload.error) uploaded += 1;
  const previous = remoteById.get(item.artifact.id);
  const artifact = {
    ...item.artifact,
    provenance: {
      ...item.artifact.provenance,
      importedAt: new Date().toISOString(),
      ...(previous?.storage_path && previous.storage_path !== item.objectPath ? { supersedesStoragePath: previous.storage_path } : {}),
    },
  };
  check(`Upsert ${artifact.id}`, await supabase.from("artifacts").upsert(artifact, { onConflict: "id" }));
  const categoryName = item.relative.split("/")[1] || artifact.artifact_type;
  const categorySlug = categoryName.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "untitled";
  const category = check("Create import category", await supabase.from("categories").upsert({ name: categoryName, slug: categorySlug }, { onConflict: "slug" }).select().single());
  check("Attach import category", await supabase.from("artifact_categories").upsert({ artifact_id: artifact.id, category_id: category.id }, { onConflict: "artifact_id,category_id", ignoreDuplicates: true }));
  completed += 1;
  if (completed % 20 === 0 || completed === changed.length) console.log(`Processed ${completed}/${changed.length}`);
}

const reviewPayload = {
  operation_type: "import_batch",
  target_type: "import_batch",
  target_id: batchId,
  submitted_by: systemProfile.id,
  status: "pending_review",
  risk_level: "high",
  intent_summary: `Review ${changed.length} files imported privately from the Creative Systems workspace.`,
  reason: "Initial non-destructive workspace migration to Supabase Storage.",
  before_snapshot: {},
  after_snapshot: { batchId, filesProcessed: changed.length, filesUploaded: uploaded, visibility: "internal", sourceFilesChanged: false },
  affected_artifacts: changed.map((item) => item.artifact.id),
  affected_files: changed.map((item) => item.relative),
};
const priorReview = check("Find batch review", await supabase.from("review_requests").select("id").eq("operation_type", "import_batch").eq("target_id", batchId).limit(1).maybeSingle());
if (priorReview) check("Update batch review", await supabase.from("review_requests").update(reviewPayload).eq("id", priorReview.id));
else check("Create batch review", await supabase.from("review_requests").insert(reviewPayload));
const auditPayload = {
  actor_id: systemProfile.id,
  actor_email: "workspace-import-script",
  actor_role: "owner",
  action_type: "workspace_import",
  target_type: "import_batch",
  target_id: batchId,
  intent_summary: `Import ${changed.length} workspace files into private Storage.`,
  reason: "Initial database/storage migration",
  before_snapshot: {},
  after_snapshot: { ...summary, filesUploaded: uploaded },
  result: "pending_review",
};
const priorAudit = check("Find workspace import audit", await supabase.from("audit_events").select("id").eq("action_type", "workspace_import").eq("target_id", batchId).limit(1).maybeSingle());
if (priorAudit) check("Update workspace import audit", await supabase.from("audit_events").update(auditPayload).eq("id", priorAudit.id));
else check("Audit workspace import", await supabase.from("audit_events").insert(auditPayload));
console.log(JSON.stringify({ ...summary, batchId, completed, filesUploaded: uploaded, resumedBatch: Boolean(existingBatch) }, null, 2));
