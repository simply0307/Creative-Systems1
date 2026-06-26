import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import { envIsSet, loadLocalEnv, runNodeScript, safeJson } from "./lib/setup-utils.mjs";

loadLocalEnv();

const parseJson = (text) => {
  const start = text.indexOf("{");
  if (start < 0) throw new Error("Dry-run output did not contain a JSON report.");
  let depth = 0;
  let string = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (string) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') string = false;
    } else if (character === '"') string = true;
    else if (character === "{") depth += 1;
    else if (character === "}" && --depth === 0) return JSON.parse(text.slice(start, index + 1));
  }
  throw new Error("Dry-run JSON report was incomplete.");
};

const metadataRun = runNodeScript("scripts/import-supabase.mjs", ["--dry-run"], { print: false });
const filesRun = runNodeScript("scripts/import-workspace-files.mjs", [], { print: false });
if (metadataRun.status !== 0 || filesRun.status !== 0) {
  if (metadataRun.stderr) process.stderr.write(metadataRun.stderr);
  if (filesRun.stderr) process.stderr.write(filesRun.stderr);
  process.exit(1);
}
const metadata = parseJson(metadataRun.stdout || "");
const files = parseJson(filesRun.stdout || "");

let existing = { artifacts: null, archiveRecords: null, decisions: null };
const warnings = [...(files.warnings || [])];
if (envIsSet("SUPABASE_URL") && envIsSet("SUPABASE_SERVICE_ROLE_KEY")) {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  for (const [key, table] of [["artifacts", "artifacts"], ["archiveRecords", "archive_records"], ["decisions", "decisions"]]) {
    const result = await supabase.from(table).select("*", { count: "exact", head: true });
    if (result.error) warnings.push(`Could not count ${table}: ${result.error.message}`);
    else existing[key] = result.count ?? 0;
  }
} else {
  warnings.push("Supabase credentials are unavailable; existing remote record counts could not be checked.");
}

const metadataCreates = existing.artifacts === null
  ? metadata.artifacts + metadata.archiveRecords + metadata.decisions
  : Math.max(0, metadata.artifacts - existing.artifacts) + Math.max(0, metadata.archiveRecords - existing.archiveRecords) + Math.max(0, metadata.decisions - existing.decisions);
const report = {
  mode: "dry-run only",
  existingArtifactRecords: existing.artifacts,
  existingArchiveRecords: existing.archiveRecords,
  existingDecisionRecords: existing.decisions,
  sourceMetadataArtifacts: metadata.artifacts,
  archiveRecords: metadata.archiveRecords,
  decisionsAndRemediationRecords: metadata.decisions,
  filesFound: files.files,
  imagesFound: files.images,
  pdfsFound: files.pdfs,
  textFilesFound: files.text,
  recordsThatWouldBeCreated: metadataCreates + Math.max(0, files.newArtifactRecords - files.alreadyIndexed),
  recordsThatWouldBeUpdated: files.updatedArtifactRecords,
  filesThatWouldBeUploaded: files.filesWouldBeUploaded,
  unchangedFilesSkipped: files.unchangedFilesSkipped,
  warnings,
};

console.log("Creative OS import preview (nothing was written)\n");
console.log(safeJson(report));
console.log("\nInspect these counts. To perform the real idempotent import, run: npm run setup:import:apply");
