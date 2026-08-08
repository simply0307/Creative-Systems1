import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import { runRuntimeReadiness } from "../netlify/functions/lib/runtime-contract.mjs";
import { supabaseConfig } from "../netlify/functions/lib/supabase.mjs";
import { loadLocalEnv, printResult, root, safeJson } from "./lib/setup-utils.mjs";

loadLocalEnv();
const urlArgument = process.argv.find((argument) => argument.startsWith("--url="))?.slice(6);
const siteUrl = String(urlArgument || process.env.CREATIVE_OS_SITE_URL || "http://localhost:8888").replace(/\/$/, "");
const config = supabaseConfig(process.env);
if (!config.configured) {
  console.error(`Cannot verify setup. Runtime configuration is invalid: ${[...config.missing, ...config.configurationErrors.map((item) => item.code)].join(", ")}.`);
  process.exit(1);
}

const service = createClient(config.url, config.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
const readiness = await runRuntimeReadiness({ supabase: service, config });
const checks = {
  runtimeConfigurationValid: config.configured,
  projectIdentityMatches: readiness.checks.projectIdentityMatches === true,
  serviceRoleWorksServerSide: readiness.failures.every((item) => item.code !== "runtime_contract_unreadable"),
  schemaContractVersionMatches: readiness.checks.schemaContractVersion === 1 && readiness.checks.contractCompatible === true,
  requiredTablesAndColumnsExist: readiness.checks.schemaCompatible === true,
  storageBucketsExistAndPrivate: readiness.checks.storageCompatible === true,
  anonKeyWorks: false,
  apiHealthReached: false,
  apiReadinessReached: false,
  apiReportsGitHubRoutineWritesDisabled: false,
};
const errors = readiness.failures.map((item) => `${item.component}/${item.code}: ${item.message}`);

try {
  const anon = await fetch(`${config.url.replace(/\/$/, "")}/auth/v1/settings`, { headers: { apikey: config.anonKey } });
  checks.anonKeyWorks = anon.ok;
  if (!anon.ok) errors.push(`Publishable/anon credential check returned HTTP ${anon.status}.`);
} catch (error) {
  errors.push(`Publishable/anon credential check failed: ${error.message}`);
}

try {
  const health = await fetch(`${siteUrl}/api/creative-os/health`);
  const body = await health.json();
  checks.apiHealthReached = health.ok && body.health === "reachable";
  checks.apiReportsGitHubRoutineWritesDisabled = body.githubRoutineWrites === false;
  if (!health.ok) errors.push(`API health returned HTTP ${health.status}.`);

  const ready = await fetch(`${siteUrl}/api/creative-os/ready`);
  const readyBody = await ready.json();
  checks.apiReadinessReached = ready.ok && readyBody.ready === true;
  if (!ready.ok) errors.push(`API readiness returned HTTP ${ready.status}.`);
} catch (error) {
  errors.push(`Creative OS API at ${siteUrl}: ${error.message}`);
}

const routineClient = fs.readFileSync(path.join(root, "src", "scripts", "creative-os-client.js"), "utf8");
checks.apiReportsGitHubRoutineWritesDisabled ||= !routineClient.includes("/api/operations") && routineClient.includes("/api/creative-os/");

console.log(`Creative OS read-only verification target: ${siteUrl}\n`);
for (const [name, value] of Object.entries(checks)) printResult(name, value);
if (errors.length) console.log(`\nDiagnostics:\n${errors.map((error) => `- ${error}`).join("\n")}`);
console.log("\nVerification performed no database or Storage writes. No credentials were printed.");
console.log(safeJson({ checks, ready: readiness.ready, errors: errors.length }));

process.exitCode = Object.values(checks).every(Boolean) ? 0 : 1;
