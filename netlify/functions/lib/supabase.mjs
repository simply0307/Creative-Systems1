import { createClient } from "@supabase/supabase-js";

const envValue = (name, env = process.env) => {
  try {
    return globalThis.Netlify?.env?.get?.(name) || env[name] || "";
  } catch {
    return env[name] || "";
  }
};

const envAny = (names, env = process.env) => names.map((name) => envValue(name, env)).find(Boolean) || "";

export const supabaseConfig = (env = process.env) => {
  const url = envAny(["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"], env);
  const anonKey = envAny(["SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"], env);
  const serviceRoleKey = envValue("SUPABASE_SERVICE_ROLE_KEY", env);
  const artifactsBucket = envValue("SUPABASE_STORAGE_BUCKET_ARTIFACTS", env) || "artifacts";
  const exportsBucket = envValue("SUPABASE_STORAGE_BUCKET_EXPORTS", env) || "exports";
  const missing = [
    ["SUPABASE_URL", url],
    ["SUPABASE_ANON_KEY", anonKey],
    ["SUPABASE_SERVICE_ROLE_KEY", serviceRoleKey],
  ].filter(([, value]) => !value).map(([name]) => name);
  return { configured: missing.length === 0, missing, url, anonKey, serviceRoleKey, artifactsBucket, exportsBucket };
};

export const getSupabaseAdmin = (env = process.env) => {
  const config = supabaseConfig(env);
  if (!config.configured) throw new Error(`Supabase is not configured. Missing: ${config.missing.join(", ")}`);
  return createClient(config.url, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
};

export const slugify = (value) => String(value || "")
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "")
  .slice(0, 100) || "untitled";

export const safeFileName = (value) => {
  const text = String(value || "file").normalize("NFKC").replace(/[^a-zA-Z0-9._-]+/g, "-");
  return text.replace(/^-+|-+$/g, "").slice(-160) || "file";
};

export const requireData = (result, label = "Supabase operation") => {
  if (result.error) {
    const error = new Error(`${label}: ${result.error.message}`);
    error.code = result.error.code;
    error.details = result.error.details;
    throw error;
  }
  return result.data;
};

export const upsertProfile = async (supabase, identity) => {
  const row = {
    email: identity.userEmail || `${identity.userId}@identity.local`,
    display_name: identity.userName || identity.userEmail || "Employee",
    role: identity.userRole,
    identity_provider: identity.authMethod === "emergency-admin-key" ? "emergency_key" : "netlify_identity",
    identity_user_id: identity.userId,
  };
  return requireData(await supabase.from("profiles").upsert(row, { onConflict: "identity_user_id" }).select().single(), "Profile bridge");
};

export const writeAudit = async (supabase, profile, event) => requireData(await supabase.from("audit_events").insert({
  actor_id: profile?.id || null,
  actor_email: profile?.email || event.actorEmail || null,
  actor_role: profile?.role || event.actorRole || "viewer",
  action_type: event.actionType,
  target_type: event.targetType,
  target_id: event.targetId || null,
  intent_summary: event.intentSummary,
  reason: event.reason || "",
  before_snapshot: event.beforeSnapshot || {},
  after_snapshot: event.afterSnapshot || {},
  result: event.result,
}).select().single(), "Audit write");

export const mediaKind = (mimeType = "", fileName = "") => {
  const mime = String(mimeType).toLowerCase();
  const name = String(fileName).toLowerCase();
  if (mime.startsWith("image/") || /\.(png|jpe?g|gif|webp|avif|svg)$/.test(name)) return "image";
  if (mime === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (mime.startsWith("text/") || /\.(md|markdown|txt|csv|json|yaml|yml)$/.test(name)) return "text";
  return "file";
};

export const presentArtifact = async (supabase, artifact, expiresIn = 3600) => {
  const tags = (artifact.artifact_tags || []).map((link) => link.tags).filter(Boolean);
  const categories = (artifact.artifact_categories || []).map((link) => link.categories).filter(Boolean);
  const archiveRecords = (artifact.artifact_archive_records || []).map((link) => ({
    id: link.archive_record_id,
    title: link.archive_records?.title || link.archive_record_id,
    slug: link.archive_records?.slug || "",
    type: link.archive_records?.type || "",
    relationshipType: link.relationship_type,
    notes: link.notes,
  }));
  let signedUrl = null;
  let downloadUrl = null;
  let storageError = null;
  if (artifact.file_status === "available" && artifact.storage_bucket && artifact.storage_path) {
    const signed = await supabase.storage.from(artifact.storage_bucket).createSignedUrl(artifact.storage_path, expiresIn, { download: false });
    if (signed.error) storageError = signed.error.message;
    else {
      signedUrl = signed.data.signedUrl;
      const download = await supabase.storage.from(artifact.storage_bucket).createSignedUrl(artifact.storage_path, expiresIn, { download: artifact.original_file_name || true });
      downloadUrl = download.data?.signedUrl || signedUrl;
    }
  }
  return {
    ...artifact,
    artifact_tags: undefined,
    artifact_categories: undefined,
    artifact_archive_records: undefined,
    tags,
    categories,
    archiveRecords,
    mediaKind: mediaKind(artifact.mime_type, artifact.original_file_name),
    signedUrl,
    downloadUrl,
    storageError,
    fileAvailable: Boolean(signedUrl),
  };
};

export const artifactSelect = `
  *,
  artifact_tags(tag_id, tags(id,name,slug,tag_type,description)),
  artifact_categories(category_id, categories(id,name,slug,parent_id,description)),
  artifact_archive_records(archive_record_id,relationship_type,notes,archive_records(id,title,slug,type))
`;

export const getArtifact = async (supabase, artifactId) => {
  const data = requireData(await supabase.from("artifacts").select(artifactSelect).eq("id", artifactId).single(), "Load artifact");
  return presentArtifact(supabase, data);
};

export const ensureTags = async (supabase, names) => {
  const clean = [...new Set((names || []).map((name) => String(name).trim()).filter(Boolean))];
  if (!clean.length) return [];
  const rows = clean.map((name) => ({ name, slug: slugify(name) }));
  requireData(await supabase.from("tags").upsert(rows, { onConflict: "slug", ignoreDuplicates: false }), "Create tags");
  return requireData(await supabase.from("tags").select("*").in("slug", rows.map((row) => row.slug)), "Load tags");
};

export const ensureTypedTags = async (supabase, values) => {
  const unique = new Map();
  for (const value of values || []) {
    const name = String(typeof value === "string" ? value : value?.name || "").trim();
    const tagType = String(typeof value === "string" ? "freeform" : value?.tagType || "freeform").trim().toLowerCase();
    if (!name || !tagType) continue;
    const slug = `${slugify(tagType)}-${slugify(name)}`;
    unique.set(slug, { name, slug, tag_type: tagType });
  }
  const rows = [...unique.values()];
  if (!rows.length) return [];
  requireData(await supabase.from("tags").upsert(rows, { onConflict: "slug", ignoreDuplicates: false }), "Create typed tags");
  return requireData(await supabase.from("tags").select("*").in("slug", rows.map((row) => row.slug)), "Load typed tags");
};

export const ensureCategories = async (supabase, names) => {
  const clean = [...new Set((names || []).map((name) => String(name).trim()).filter(Boolean))];
  if (!clean.length) return [];
  const rows = clean.map((name) => ({ name, slug: slugify(name) }));
  requireData(await supabase.from("categories").upsert(rows, { onConflict: "slug", ignoreDuplicates: false }), "Create categories");
  return requireData(await supabase.from("categories").select("*").in("slug", rows.map((row) => row.slug)), "Load categories");
};

export const applyTagChange = async (supabase, { artifactId, addTags = [], removeTags = [], profile }) => {
  const beforeArtifact = await getArtifact(supabase, artifactId);
  const created = await ensureTags(supabase, addTags);
  if (created.length) requireData(await supabase.from("artifact_tags").upsert(created.map((tag) => ({ artifact_id: artifactId, tag_id: tag.id, created_by: profile.id })), { onConflict: "artifact_id,tag_id", ignoreDuplicates: true }), "Attach tags");
  const removeSlugs = removeTags.map(slugify);
  if (removeSlugs.length) {
    const existing = requireData(await supabase.from("tags").select("id").in("slug", removeSlugs), "Load removed tags");
    if (existing.length) requireData(await supabase.from("artifact_tags").delete().eq("artifact_id", artifactId).in("tag_id", existing.map((tag) => tag.id)), "Remove tags");
  }
  requireData(await supabase.from("artifacts").update({ updated_by: profile.id }).eq("id", artifactId), "Touch artifact");
  const afterArtifact = await getArtifact(supabase, artifactId);
  return { beforeArtifact, afterArtifact };
};

export const applyTypedTagChange = async (supabase, { artifactId, addTags = [], removeTags = [], profile }) => {
  const directAddIds = [...new Set(addTags.map((value) => typeof value === "object" ? String(value?.id || "") : "").filter(Boolean))];
  const created = await ensureTypedTags(supabase, addTags.filter((value) => !(typeof value === "object" && value?.id)));
  const addIds = [...new Set([...directAddIds, ...created.map((tag) => tag.id)])];
  if (addIds.length) requireData(await supabase.from("artifact_tags").upsert(addIds.map((tagId) => ({
    artifact_id: artifactId,
    tag_id: tagId,
    created_by: profile.id,
  })), { onConflict: "artifact_id,tag_id", ignoreDuplicates: true }), "Attach typed tags");

  const removeIds = [...new Set((removeTags || []).map((value) => typeof value === "object" ? String(value?.id || "") : "").filter(Boolean))];
  const removeSlugs = (removeTags || []).filter((value) => !(typeof value === "object" && value?.id)).map((value) => {
    const name = String(typeof value === "string" ? value : value?.name || "").trim();
    const tagType = String(typeof value === "string" ? "freeform" : value?.tagType || "freeform").trim().toLowerCase();
    return name ? `${slugify(tagType)}-${slugify(name)}` : "";
  }).filter(Boolean);
  if (removeSlugs.length) {
    const existing = requireData(await supabase.from("tags").select("id").in("slug", removeSlugs), "Load removed typed tags");
    removeIds.push(...existing.map((tag) => tag.id));
  }
  if (removeIds.length) requireData(await supabase.from("artifact_tags").delete().eq("artifact_id", artifactId).in("tag_id", [...new Set(removeIds)]), "Remove typed tags");
};

export const syncControlledTag = async (supabase, { artifactId, tagType, value, profile }) => {
  const existing = requireData(await supabase.from("tags").select("id").eq("tag_type", tagType), `Load ${tagType} tags`);
  if (existing.length) requireData(await supabase.from("artifact_tags").delete().eq("artifact_id", artifactId).in("tag_id", existing.map((tag) => tag.id)), `Clear ${tagType} tag`);
  if (value) await applyTypedTagChange(supabase, { artifactId, addTags: [{ name: value, tagType }], profile });
};

export const applyCategoryChange = async (supabase, { artifactId, addCategories = [], removeCategories = [], profile }) => {
  const beforeArtifact = await getArtifact(supabase, artifactId);
  const created = await ensureCategories(supabase, addCategories);
  if (created.length) requireData(await supabase.from("artifact_categories").upsert(created.map((category) => ({ artifact_id: artifactId, category_id: category.id, created_by: profile.id })), { onConflict: "artifact_id,category_id", ignoreDuplicates: true }), "Attach categories");
  const removeSlugs = removeCategories.map(slugify);
  if (removeSlugs.length) {
    const existing = requireData(await supabase.from("categories").select("id").in("slug", removeSlugs), "Load removed categories");
    if (existing.length) requireData(await supabase.from("artifact_categories").delete().eq("artifact_id", artifactId).in("category_id", existing.map((category) => category.id)), "Remove categories");
  }
  requireData(await supabase.from("artifacts").update({ updated_by: profile.id }).eq("id", artifactId), "Touch artifact");
  const afterArtifact = await getArtifact(supabase, artifactId);
  return { beforeArtifact, afterArtifact };
};
