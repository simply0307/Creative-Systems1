import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import { loadLocalEnv, root } from "./lib/setup-utils.mjs";
import { buildRepoMetadataManifest } from "./lib/repo-metadata.mjs";

loadLocalEnv();
const dryRun = process.argv.includes("--dry-run");
const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const manifest = buildRepoMetadataManifest(root);
const summary = {
  artifacts: manifest.artifacts.length,
  archiveRecords: manifest.archiveRecords.length,
  decisions: manifest.decisions.length,
  sourceFilesPresent: manifest.expectedFiles.filter((item) => item.filePresentInBuildWorkspace).length,
  sourceFilesMissing: manifest.expectedFiles.filter((item) => !item.filePresentInBuildWorkspace).length,
  note: "Existing workspace files are indexed as needs_import; this metadata seed does not publish or upload them.",
};

if (dryRun) {
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}
if (!url || !serviceRoleKey) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required. Use --dry-run to inspect without writing.");
  process.exit(1);
}

const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
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
