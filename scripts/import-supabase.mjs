import process from "node:process";
import { loadLocalEnv, root } from "./lib/setup-utils.mjs";
import { buildRepoMetadataManifest } from "./lib/repo-metadata.mjs";
import { getSupabaseAdmin, supabaseConfig } from "../netlify/functions/lib/supabase.mjs";
import { runRuntimeReadiness } from "../netlify/functions/lib/runtime-contract.mjs";

loadLocalEnv();
const apply = process.argv.includes("--apply");
const manifest = buildRepoMetadataManifest(root);
const summary = {
  artifacts: manifest.artifacts.length,
  archiveRecords: manifest.archiveRecords.length,
  decisions: manifest.decisions.length,
  sourceFilesPresent: manifest.expectedFiles.filter((item) => item.filePresentInBuildWorkspace).length,
  sourceFilesMissing: manifest.expectedFiles.filter((item) => !item.filePresentInBuildWorkspace).length,
  note: "Existing workspace files are indexed as needs_import; this metadata seed does not publish or upload them.",
};

if (!apply) {
  console.log(JSON.stringify(summary, null, 2));
  console.log("Dry run only. Writing requires --apply, an exact --confirm-project-ref value, and --confirm-production for the canonical/production target.");
  process.exit(0);
}
const config = supabaseConfig(process.env);
if (!config.configured) {
  console.error(`Creative OS runtime configuration is invalid: ${[...config.missing, ...config.configurationErrors.map((item) => item.message)].join("; ")}. Use --dry-run to inspect without writing.`);
  process.exit(1);
}
const confirmedProjectRef = process.argv.find((argument) => argument.startsWith("--confirm-project-ref="))?.slice("--confirm-project-ref=".length);
if (!confirmedProjectRef || confirmedProjectRef !== config.projectRef) {
  console.error(`Refusing write: pass --confirm-project-ref=${config.projectRef} to confirm the configured target exactly.`);
  process.exit(1);
}
const canonicalOrProduction = config.projectRef === "okqkljexfzolzxysjaha" || config.runtimeContext === "production";
if (canonicalOrProduction && !process.argv.includes("--confirm-production")) {
  console.error("Refusing canonical/production write: pass --confirm-production after reviewing the dry-run report.");
  process.exit(1);
}
const supabase = getSupabaseAdmin(process.env, config);
const readiness = await runRuntimeReadiness({ supabase, config });
if (!readiness.ready) {
  console.error(`Creative OS runtime readiness failed: ${readiness.failures.join("; ")}.`);
  process.exit(1);
}
const check = (label, result) => { if (result.error) throw new Error(`${label}: ${result.error.message}`); return result.data; };
check("Archive records", await supabase.from("archive_records").upsert(manifest.archiveRecords, { onConflict: "id" }));
check("Decisions", await supabase.from("decisions").upsert(manifest.decisions, { onConflict: "id" }));
check("Artifacts", await supabase.from("artifacts").upsert(manifest.artifacts, { onConflict: "id" }));
check("Tags", await supabase.from("tags").upsert(manifest.tags, { onConflict: "slug" }));
const tags = check("Load tags", await supabase.from("tags").select("id,slug").in("slug", manifest.tags.map((item) => item.slug)));
const tagBySlug = new Map(tags.map((tag) => [tag.slug, tag.id]));
const artifactTags = manifest.artifactTags.map((item) => ({ artifact_id: item.artifact_id, tag_id: tagBySlug.get(item.tag_slug) })).filter((row) => row.tag_id);
if (artifactTags.length) check("Artifact tags", await supabase.from("artifact_tags").upsert(artifactTags, { onConflict: "artifact_id,tag_id", ignoreDuplicates: true }));
check("Categories", await supabase.from("categories").upsert(manifest.categories, { onConflict: "slug" }));
const categories = check("Load categories", await supabase.from("categories").select("id,slug").in("slug", manifest.categories.map((item) => item.slug)));
const categoryBySlug = new Map(categories.map((category) => [category.slug, category.id]));
const artifactCategories = manifest.artifactCategories.map((item) => ({ artifact_id: item.artifact_id, category_id: categoryBySlug.get(item.category_slug) })).filter((row) => row.category_id);
if (artifactCategories.length) check("Artifact categories", await supabase.from("artifact_categories").upsert(artifactCategories, { onConflict: "artifact_id,category_id", ignoreDuplicates: true }));
if (manifest.relationships.length) check("Artifact/archive links", await supabase.from("artifact_archive_records").upsert(manifest.relationships, { onConflict: "artifact_id,archive_record_id,relationship_type", ignoreDuplicates: true }));
console.log(JSON.stringify({ ...summary, imported: true, manifestVersion: manifest.version }, null, 2));
