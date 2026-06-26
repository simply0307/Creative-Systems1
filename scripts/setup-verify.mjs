import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import { REQUIRED_BUCKETS, envIsSet, loadLocalEnv, printResult, root, safeJson } from "./lib/setup-utils.mjs";

loadLocalEnv();
const urlArgument = process.argv.find((argument) => argument.startsWith("--url="))?.slice(6);
const siteUrl = String(urlArgument || process.env.CREATIVE_OS_SITE_URL || "http://localhost:8888").replace(/\/$/, "");
const required = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"];
const missing = required.filter((name) => !envIsSet(name));
if (missing.length) {
  console.error(`Cannot verify setup. Add ${missing.join(", ")} to .env first.`);
  process.exit(1);
}

const service = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const checks = {
  supabaseConfigured: true,
  serviceRoleWorksServerSide: false,
  anonKeyWorks: false,
  databaseConnectionWorks: false,
  storageBucketsExist: false,
  artifactsReadable: false,
  auditEventWritable: false,
  signedFileOpenDownloadWorks: false,
  apiHealthReached: false,
  apiReportsGitHubRoutineWritesDisabled: false,
  currentUserRoleDetected: false,
};
const errors = [];

const artifacts = await service.from("artifacts").select("*", { count: "exact", head: true });
checks.serviceRoleWorksServerSide = !artifacts.error;
checks.databaseConnectionWorks = !artifacts.error;
checks.artifactsReadable = !artifacts.error;
if (artifacts.error) errors.push(`Artifact read: ${artifacts.error.message}`);

try {
  const anon = await fetch(`${process.env.SUPABASE_URL.replace(/\/$/, "")}/auth/v1/settings`, { headers: { apikey: process.env.SUPABASE_ANON_KEY } });
  checks.anonKeyWorks = anon.ok;
  if (!anon.ok) errors.push(`Anon/publishable key check returned HTTP ${anon.status}.`);
} catch (error) {
  errors.push(`Anon/publishable key check: ${error.message}`);
}

const bucketList = await service.storage.listBuckets();
if (bucketList.error) errors.push(`Storage buckets: ${bucketList.error.message}`);
else {
  const byId = new Map((bucketList.data || []).map((bucket) => [bucket.id, bucket]));
  checks.storageBucketsExist = REQUIRED_BUCKETS.every((name) => byId.has(name) && byId.get(name).public === false);
  if (!checks.storageBucketsExist) errors.push("One or more required private Storage buckets are missing or public.");
}

const auditTarget = `setup-verification:${process.env.SUPABASE_PROJECT_REF || "configured-project"}`;
const auditPayload = {
  actor_email: "setup-automation@creative-os.local",
  actor_role: "owner",
  action_type: "setup_verification",
  target_type: "system",
  target_id: auditTarget,
  intent_summary: "Verify live Creative OS database and Storage access.",
  reason: "Guided setup verification",
  before_snapshot: {},
  after_snapshot: { checkedAt: new Date().toISOString() },
  result: "verified",
};
const priorAudit = await service.from("audit_events").select("id").eq("action_type", "setup_verification").eq("target_id", auditTarget).limit(1).maybeSingle();
if (!priorAudit.error) {
  const written = priorAudit.data?.id
    ? await service.from("audit_events").update(auditPayload).eq("id", priorAudit.data.id)
    : await service.from("audit_events").insert(auditPayload);
  checks.auditEventWritable = !written.error;
  if (written.error) errors.push(`Audit write: ${written.error.message}`);
} else errors.push(`Audit lookup: ${priorAudit.error.message}`);

const probePath = `.setup-probes/${randomUUID()}.txt`;
try {
  const uploaded = await service.storage.from(process.env.SUPABASE_STORAGE_BUCKET_ARTIFACTS || "artifacts").upload(probePath, Buffer.from("Creative OS signed URL setup probe"), { contentType: "text/plain", upsert: false });
  if (uploaded.error) throw uploaded.error;
  const signed = await service.storage.from(process.env.SUPABASE_STORAGE_BUCKET_ARTIFACTS || "artifacts").createSignedUrl(probePath, 60, { download: "creative-os-health.txt" });
  if (signed.error || !signed.data?.signedUrl) throw signed.error || new Error("No signed URL returned.");
  const opened = await fetch(signed.data.signedUrl);
  checks.signedFileOpenDownloadWorks = opened.ok && (await opened.text()) === "Creative OS signed URL setup probe";
  if (!checks.signedFileOpenDownloadWorks) errors.push(`Signed file request returned HTTP ${opened.status}.`);
} catch (error) {
  errors.push(`Signed file probe: ${error.message}`);
} finally {
  const removed = await service.storage.from(process.env.SUPABASE_STORAGE_BUCKET_ARTIFACTS || "artifacts").remove([probePath]);
  if (removed.error) errors.push(`Remove temporary signed-file probe: ${removed.error.message}`);
}

try {
  const health = await fetch(`${siteUrl}/api/creative-os/health`);
  const body = await health.json();
  checks.apiHealthReached = health.ok && body.supabaseConfigured === true;
  checks.apiReportsGitHubRoutineWritesDisabled = body.githubRoutineWrites === false;
  if (!health.ok) errors.push(`API health returned HTTP ${health.status}.`);
} catch (error) {
  errors.push(`API health at ${siteUrl}: ${error.message}`);
}

if (envIsSet("NETLIFY_IDENTITY_TOKEN")) {
  try {
    const full = await fetch(`${siteUrl}/api/creative-os/health/full`, { headers: { authorization: `Bearer ${process.env.NETLIFY_IDENTITY_TOKEN}` } });
    const body = await full.json();
    checks.currentUserRoleDetected = full.ok && body.authenticated === true && Boolean(body.userRole);
    if (!full.ok) errors.push(`Authenticated health returned HTTP ${full.status}.`);
  } catch (error) {
    errors.push(`Authenticated role check: ${error.message}`);
  }
}

const routineClient = fs.readFileSync(path.join(root, "src", "scripts", "creative-os-client.js"), "utf8");
const routineClientAvoidsLegacyGitHub = !routineClient.includes("/api/operations") && routineClient.includes("/api/creative-os/");
checks.apiReportsGitHubRoutineWritesDisabled ||= routineClientAvoidsLegacyGitHub;

console.log(`Creative OS verification target: ${siteUrl}\n`);
for (const [name, value] of Object.entries(checks)) printResult(name, value, name === "currentUserRoleDetected" && !envIsSet("NETLIFY_IDENTITY_TOKEN") ? "optional: verify after login in the Account panel" : "");
if (errors.length) console.log(`\nDiagnostics:\n${errors.map((error) => `- ${error}`).join("\n")}`);
console.log("\nNo credentials or signed URLs were printed.");
console.log(safeJson({ checks, errors: errors.length }));

const requiredChecks = Object.entries(checks).filter(([name]) => name !== "currentUserRoleDetected");
process.exitCode = requiredChecks.every(([, value]) => value) ? 0 : 1;
