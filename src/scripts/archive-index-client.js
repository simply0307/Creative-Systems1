import manifest from "../generated/repo-import-manifest.json";

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]);
const splitList = (value) => String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
const option = (value, label = value) => `<option value="${esc(value)}">${esc(label)}</option>`;
const normalizeFolderPath = (value = "Archive") => {
  const parts = String(value || "Archive").replaceAll("\\", "/").split("/").map((part) => part.trim()).filter(Boolean);
  if (!parts.length || parts[0].toLowerCase() !== "archive") parts.unshift("Archive");
  return parts.join("/");
};
const slugish = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

const state = {
  db: [],
  indexedRefs: [],
  pagination: { page: 1, limit: 24, total: 0, totalPages: 1, hasPrevious: false, hasNext: false },
  summary: { available: 0, needs_import: 0 },
  manifestFiles: manifest.archiveFiles || [],
  manifestFolders: manifest.archiveFolders || [],
  options: { tags: [], categories: [] },
  selectedFolder: "",
  selectedIds: new Set(),
  apiReady: false,
  lastError: null,
};

const els = () => ({
  grid: document.querySelector("#artifact-grid"),
  empty: document.querySelector("#artifact-empty"),
  status: document.querySelector("#index-status"),
  progress: document.querySelector("#upload-progress"),
});

const originalPathOf = (item) => item.provenance?.originalWorkspaceRelativePath || item.provenance?.workspaceRelativePath || item.legacy_data?.filePath || item.archivePath || "";
const pathOf = (item) => item.provenance?.indexedPath || originalPathOf(item) || item.storage_path || "";
const folderFromPath = (path) => String(path || "").split("/").slice(0, -1).join("/");
const folderCategory = (item) => item.categories?.find((category) => category.name === "Archive" || String(category.name || "").startsWith("Archive/"));
const folderOf = (item) => normalizeFolderPath(item.provenance?.folder || folderCategory(item)?.name || folderFromPath(pathOf(item)) || "Archive");
const typeOf = (item) => window.CreativeDatabase?.effectiveArtifactType?.(item) || item.artifact_type || "other";
const fileState = (item) => item.manifestOnly ? "manifest_only" : item.file_status || "metadata_only";
const tagsOf = (item) => item.tags || [];
const folderTags = (item) => tagsOf(item).filter((tag) => tag.tag_type === "folder").map((tag) => tag.name);
const freeformTags = (item) => tagsOf(item).filter((tag) => tag.tag_type === "freeform").map((tag) => tag.name);
const standardTagObjects = (item) => tagsOf(item).filter((tag) => !["folder", "freeform"].includes(tag.tag_type || "standard"));
const standardTags = (item) => standardTagObjects(item).map((tag) => tag.name);
const nonFolderCategories = (item) => (item.categories || []).filter((category) => !(category.name === "Archive" || String(category.name || "").startsWith("Archive/"))).map((category) => category.name);

const folderSegments = (folderPath) => normalizeFolderPath(folderPath).split("/").filter(Boolean);
const manifestRecord = (file) => {
  const folder = normalizeFolderPath(file.provenance?.folder || folderFromPath(file.provenance?.workspaceRelativePath));
  return {
    ...file,
    archivePath: file.provenance?.workspaceRelativePath,
    manifestOnly: true,
    tags: folderSegments(folder).map((name) => ({ id: `manifest-folder-${slugish(name)}`, name, slug: `folder-${slugish(name)}`, tag_type: "folder" })),
    categories: [{ id: `manifest-folder-${slugish(folder)}`, name: folder, slug: slugish(folder) }],
    archiveRecords: [],
    fileAvailable: false,
    mediaKind: typeOf(file) === "image" ? "image" : typeOf(file) === "pdf" ? "pdf" : ["text", "markdown"].includes(typeOf(file)) ? "text" : "file",
  };
};

const mergedRecords = () => {
  const byPath = new Map();
  const byId = new Map(state.db.map((item) => [item.id, item]));
  for (const item of state.db) {
    const path = originalPathOf(item);
    if (path) byPath.set(path.toLowerCase(), item);
  }
  const indexedIds = new Set(state.indexedRefs.map((item) => item.id));
  const indexedPaths = new Set(state.indexedRefs.map((item) => String(item.path || "").toLowerCase()).filter(Boolean));
  const merged = state.manifestFiles.flatMap((file) => {
    const path = file.provenance?.workspaceRelativePath || "";
    const current = byId.get(file.id) || byPath.get(path.toLowerCase());
    if (current) return [current];
    if (indexedIds.has(file.id) || (path && indexedPaths.has(path.toLowerCase()))) return [];
    return [manifestRecord(file)];
  });
  for (const item of state.db) {
    const path = originalPathOf(item).toLowerCase();
    if (!state.manifestFiles.some((file) => (file.provenance?.workspaceRelativePath || "").toLowerCase() === path || file.id === item.id)) merged.push(item);
  }
  return merged.sort((a, b) => folderOf(a).localeCompare(folderOf(b)) || pathOf(a).localeCompare(pathOf(b)) || String(a.title).localeCompare(String(b.title)));
};

const missingManifestRecords = () => {
  const dbIds = new Set(state.indexedRefs.map((item) => item.id));
  const dbPaths = new Set(state.indexedRefs.map((item) => String(item.path || "").toLowerCase()).filter(Boolean));
  return state.manifestFiles.filter((file) => {
    const path = (file.provenance?.workspaceRelativePath || "").toLowerCase();
    return !dbIds.has(file.id) && (!path || !dbPaths.has(path));
  });
};

const folderEntries = () => {
  const map = new Map();
  const add = (path, count = 0) => {
    const normalized = normalizeFolderPath(path);
    const current = map.get(normalized) || { path: normalized, fileCount: 0 };
    current.fileCount += count;
    map.set(normalized, current);
  };
  for (const folder of state.manifestFolders) add(folder.path, 0);
  for (const category of state.options.categories || []) {
    if (category.name === "Archive" || String(category.name || "").startsWith("Archive/")) add(category.name, 0);
  }
  for (const item of mergedRecords()) add(folderOf(item), 1);
  return [...map.values()].sort((a, b) => a.path.localeCompare(b.path));
};

const currentFilters = () => ({
  search: document.querySelector("#artifact-search").value.trim().toLowerCase(),
  type: document.querySelector('[data-filter="type"]').value,
  file: document.querySelector('[data-filter="file"]').value,
  folder: state.selectedFolder || document.querySelector('[data-filter="folder"]').value,
  standard: document.querySelector('[data-filter="standard"]').value,
  freeform: document.querySelector('[data-filter="freeform"]').value,
});

const apiFilters = () => {
  const filters = currentFilters();
  return {
    page: state.pagination.page,
    limit: state.pagination.limit,
    search: filters.search,
    artifact_type: filters.type,
    file: filters.file === "manifest_only" ? "" : filters.file,
    category: filters.folder,
    controlled_tag: filters.standard,
    freeform_tag: filters.freeform,
  };
};

const hasTag = (item, value, predicate = () => true) => tagsOf(item).some((tag) => predicate(tag) && [tag.id, tag.slug, tag.name].includes(value));

const filteredRecords = () => {
  const filters = currentFilters();
  return mergedRecords().filter((item) => {
    const haystack = [
      item.title,
      item.original_file_name,
      pathOf(item),
      originalPathOf(item),
      item.description,
      item.notes,
      folderOf(item),
      ...folderTags(item),
      ...standardTags(item),
      ...freeformTags(item),
      ...nonFolderCategories(item),
    ].join(" ").toLowerCase();
    if (filters.search && !haystack.includes(filters.search)) return false;
    if (filters.type && typeOf(item) !== filters.type) return false;
    if (filters.file && fileState(item) !== filters.file) return false;
    if (filters.folder && folderOf(item) !== normalizeFolderPath(filters.folder)) return false;
    if (filters.standard && !hasTag(item, filters.standard, (tag) => !["folder", "freeform"].includes(tag.tag_type || "standard"))) return false;
    if (filters.freeform && !hasTag(item, filters.freeform, (tag) => tag.tag_type === "freeform")) return false;
    return true;
  });
};

const visibleDatabaseRecords = () => filteredRecords().filter((item) => !item.manifestOnly);
const setBulkStatus = (message) => {
  const node = document.querySelector("#bulk-status");
  if (node) node.textContent = message;
};

const preview = (item) => {
  if (item.fileAvailable && item.signedUrl) {
    if (item.mediaKind === "image") return `<img class="archive-thumb" src="${esc(item.signedUrl)}" alt="Preview of ${esc(item.title)}" loading="lazy"/>`;
    if (item.mediaKind === "pdf") return `<a class="file-preview-tile" href="${esc(item.signedUrl)}" target="_blank" rel="noopener"><b>PDF</b><span>Open PDF</span></a>`;
    if (item.mediaKind === "text") return `<button class="file-preview-tile" type="button" data-read-file="${esc(item.id)}"><b>TEXT</b><span>Read</span></button>`;
    return `<a class="file-preview-tile" href="${esc(item.signedUrl)}" target="_blank" rel="noopener"><b>FILE</b><span>Open/download</span></a>`;
  }
  const message = item.manifestOnly ? "Found in the read-only repository snapshot but not in canonical Creative OS. An admin or owner may deliberately import its metadata." : item.file_status === "needs_import" ? "Indexed from your Archive folder. Add or attach the file to enable browser preview/download." : "No stored file object is attached.";
  return `<div class="archive-placeholder"><b>${esc(fileState(item).replaceAll("_", " "))}</b><span>${esc(message)}</span></div>`;
};

const folderOptions = (currentFolder) => folderEntries().map((folder) => `<option value="${esc(folder.path)}"${normalizeFolderPath(currentFolder) === folder.path ? " selected" : ""}>${esc(folder.path)}</option>`).join("");

const tagInputValue = (names) => [...new Set(names)].join(", ");

const editor = (item) => {
  if (item.manifestOnly) return `<div class="manifest-only-note">Repository snapshot reference only. It is not canonical until an admin or owner explicitly imports it.</div>`;
  return `<form class="quick-index-form" data-index-form>
    <label>Title<input name="title" value="${esc(item.title || "")}" /></label>
    <label>Indexed folder<select name="folder">${folderOptions(folderOf(item))}</select></label>
    <label>Standard tags<input name="standardTags" list="standard-tag-values" value="${esc(tagInputValue(standardTags(item)))}" placeholder="comma-separated controlled tags" /></label>
    <label>Freeform tags<input name="freeformTags" list="freeform-tag-values" value="${esc(tagInputValue(freeformTags(item)))}" placeholder="comma-separated casual tags" /></label>
    <label>Notes<textarea name="notes" placeholder="Plain indexing notes">${esc(item.notes || "")}</textarea></label>
    <div class="action-row"><button class="button acid" type="submit">Save index fields</button><span class="save-state"></span></div>
  </form>`;
};

const chips = (items, empty) => items.length ? items.map((name) => `<span class="pill">${esc(name)}</span>`).join("") : `<span>${esc(empty)}</span>`;

const card = (item) => {
  const folder = folderOf(item);
  const path = pathOf(item);
  const originalPath = originalPathOf(item);
  const size = item.file_size ? `${Math.round(Number(item.file_size) / 1024)} KB` : "-";
  const fileActions = item.fileAvailable ? `<div class="action-row"><a class="button secondary" href="${esc(item.signedUrl)}" target="_blank" rel="noopener">Open preview</a><button class="button secondary" type="button" data-download-file="${esc(item.id)}">Download file</button></div>` : "";
  const selected = state.selectedIds.has(item.id);
  return `<article class="archive-file-card${selected ? " selected" : ""}" data-artifact-id="${esc(item.id)}">
    <label class="select-file"><input type="checkbox" data-select-artifact value="${esc(item.id)}"${selected ? " checked" : ""}${item.manifestOnly ? " disabled" : ""}/> ${item.manifestOnly ? "Syncing" : "Select"}</label>
    <div class="file-card-top"><span class="state-badge ${esc(fileState(item))}">${esc(fileState(item).replaceAll("_", " "))}</span><span>${esc(typeOf(item))}</span></div>
    ${preview(item)}
    <h3>${esc(item.title || item.original_file_name || "Untitled")}</h3>
    <code class="path-line">${esc(path || "No indexed path")}</code>
    ${originalPath && originalPath !== path ? `<small class="path-line">Original source path: ${esc(originalPath)}</small>` : ""}
    <dl class="file-facts">
      <div><dt>Indexed folder</dt><dd>${esc(folder || "-")}</dd></div>
      <div><dt>Filename</dt><dd>${esc(item.original_file_name || "-")}</dd></div>
      <div><dt>Size</dt><dd>${esc(size)}</dd></div>
      <div><dt>Mime</dt><dd>${esc(item.mime_type || "-")}</dd></div>
    </dl>
    <div class="chip-line"><b>Folder tags</b>${chips(folderTags(item), "No folder tags")}</div>
    <div class="chip-line"><b>Standard tags</b>${chips(standardTags(item), "No standard tags")}</div>
    <div class="chip-line"><b>Freeform tags</b>${chips(freeformTags(item), "No freeform tags")}</div>
    ${nonFolderCategories(item).length ? `<div class="chip-line"><b>Other categories</b>${chips(nonFolderCategories(item), "None")}</div>` : ""}
    ${fileActions}
    ${editor(item)}
  </article>`;
};

const datalist = (id, values) => {
  let node = document.querySelector(id);
  if (!node) {
    node = document.createElement("datalist");
    node.id = id.slice(1);
    document.body.append(node);
  }
  node.innerHTML = [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b)).map((value) => option(value)).join("");
};

const populateFilters = () => {
  const records = mergedRecords();
  const fill = (selector, values) => {
    const select = document.querySelector(selector);
    const current = select.value;
    select.innerHTML = '<option value="">All</option>' + values.map((value) => option(value)).join("");
    select.value = [...select.options].some((item) => item.value === current) ? current : "";
  };
  fill('[data-filter="type"]', [...new Set([...(state.options.values?.media || []), ...records.map(typeOf)].filter(Boolean))].sort());
  fill('[data-filter="folder"]', folderEntries().map((folder) => folder.path));
  const bulkFolder = document.querySelector("#bulk-folder");
  if (bulkFolder) {
    const current = bulkFolder.value;
    bulkFolder.innerHTML = '<option value="">Choose folder</option>' + folderEntries().map((folder) => option(folder.path)).join("");
    bulkFolder.value = [...bulkFolder.options].some((item) => item.value === current) ? current : "";
  }
  const standard = (state.options.tags || []).filter((tag) => !["folder", "freeform"].includes(tag.tag_type || "standard"));
  const freeform = (state.options.tags || []).filter((tag) => tag.tag_type === "freeform");
  document.querySelector('[data-filter="standard"]').innerHTML = '<option value="">All</option>' + standard.map((item) => option(item.id, `${item.tag_type || "standard"} / ${item.name}`)).join("");
  document.querySelector('[data-filter="freeform"]').innerHTML = '<option value="">All</option>' + freeform.map((item) => option(item.id, item.name)).join("");
  document.querySelector("#manifest-summary").textContent = `${state.manifestFiles.length} files · ${folderEntries().length} folders · manifest ${manifest.version}`;
  document.querySelector("#manifest-summary").textContent = `${state.manifestFiles.length} files - ${folderEntries().length} folders - snapshot ${manifest.version}`;
  datalist("#folder-values", folderEntries().map((folder) => folder.path));
  datalist("#standard-tag-values", standard.map((item) => item.name));
  datalist("#freeform-tag-values", freeform.map((item) => item.name));
};

const renderFolders = () => {
  const list = document.querySelector("#folder-list");
  list.innerHTML = folderEntries().map((folder) => {
    const label = folder.path.replace(/^Archive\/?/, "") || "Archive";
    return `<button class="${state.selectedFolder === folder.path ? "active" : ""}" type="button" data-folder="${esc(folder.path)}"><span>${esc(label)}</span><b>${folder.fileCount}</b></button>`;
  }).join("");
};

const renderBulkControls = () => {
  const knownIds = new Set(state.db.map((item) => item.id));
  for (const id of [...state.selectedIds]) {
    if (!knownIds.has(id)) state.selectedIds.delete(id);
  }
  const count = state.selectedIds.size;
  document.querySelector("#selected-count").textContent = count;
  document.querySelectorAll("[data-select-artifact]").forEach((input) => {
    input.checked = state.selectedIds.has(input.value);
    input.closest(".archive-file-card")?.classList.toggle("selected", input.checked);
  });
  document.querySelectorAll("#bulk-move,#bulk-add-standard,#bulk-remove-standard,#bulk-add-freeform,#bulk-remove-freeform,#clear-selection").forEach((button) => {
    button.disabled = count === 0;
  });
};

const render = () => {
  const { grid, empty } = els();
  const records = filteredRecords();
  grid.innerHTML = records.map(card).join("");
  empty.hidden = records.length > 0;
  document.querySelector("#shown-count").textContent = records.length;
  document.querySelector("#filter-count").textContent = records.length;
  const all = mergedRecords();
  document.querySelector("#total-count").textContent = state.pagination.total + missingManifestRecords().length;
  const count = (name, value) => { document.querySelector(`[data-count="${name}"]`).textContent = value; };
  count("available", state.summary.available);
  count("needs_import", state.summary.needs_import);
  count("manifest_only", missingManifestRecords().length);
  count("folders", folderEntries().length);
  count("folder_tags", [...new Set(all.flatMap(folderTags))].length);
  count("standard_tags", [...new Set(all.flatMap(standardTags))].length);
  count("freeform_tags", [...new Set(all.flatMap(freeformTags))].length);
  renderFolders();
  renderBulkControls();
  document.querySelector("#page-status").textContent = `Page ${state.pagination.page} of ${state.pagination.totalPages} · ${state.pagination.total} canonical records`;
  document.querySelector("#previous-page").disabled = !state.pagination.hasPrevious;
  document.querySelector("#next-page").disabled = !state.pagination.hasNext;
};

const importArchiveSnapshot = async () => {
  if (!state.apiReady || !state.manifestFiles.length) return false;
  const missing = missingManifestRecords();
  if (!missing.length) {
    els().status.textContent = "Nothing to import; the canonical index already contains every repository snapshot record.";
    return false;
  }
  await window.CreativeAccount?.ready;
  const account = window.CreativeAccount?.current?.();
  if (!account?.authenticated || !["admin", "owner"].includes(account.userRole)) {
    els().status.textContent = "Sign in as an admin or owner to import repository snapshot metadata.";
    return false;
  }
  const confirmed = window.confirm(`Import ${missing.length} missing repository snapshot record(s) into canonical Creative OS? This writes metadata and an audit event through /api/creative-os; it does not upload source-file bytes.`);
  if (!confirmed) {
    els().status.textContent = "Repository snapshot import cancelled; no data was changed.";
    return false;
  }
  els().status.textContent = missing.length
    ? `Importing ${missing.length} repository snapshot record(s)...`
    : "Importing repository snapshot...";
  try {
    const result = await window.CreativeDatabase.importArchiveFolderIndex();
    els().status.textContent = result.message || "Repository snapshot metadata imported.";
    await load({ refreshOptions: true });
    return true;
  } catch (error) {
    els().status.textContent = `Repository snapshot remains read-only; explicit import failed: ${error.message}`;
    return false;
  }
};

const load = async ({ refreshOptions = false } = {}) => {
  const { status } = els();
  status.textContent = "Loading Archive index...";
  try {
    const [result, options] = await Promise.all([
      window.CreativeDatabase.listArtifacts(apiFilters()),
      refreshOptions || !state.options.tags.length ? window.CreativeDatabase.organizationOptions() : Promise.resolve(state.options),
    ]);
    state.db = result.artifacts || [];
    state.indexedRefs = result.indexedRefs || state.indexedRefs;
    state.pagination = result.pagination || state.pagination;
    state.summary = result.summary || state.summary;
    state.options = options || { tags: [], categories: [] };
    state.apiReady = true;
    state.lastError = null;
    status.textContent = `Loaded page ${state.pagination.page}: ${state.db.length} of ${state.pagination.total} canonical file record(s).`;
  } catch (error) {
    state.db = [];
    state.options = { tags: [], categories: [] };
    state.apiReady = false;
    state.lastError = error.message;
    status.textContent = `Database unavailable; showing Desktop Archive snapshot only. ${error.message}`;
  }
  populateFilters();
  render();
  if (state.apiReady && !missingManifestRecords().length) status.textContent = `Archive folder ready: page ${state.pagination.page} of ${state.pagination.totalPages}, ${state.pagination.total} indexed file record(s).`;
  else if (state.apiReady) status.textContent = `Read-only view loaded. ${missingManifestRecords().length} repository snapshot record(s) are not in canonical Creative OS.`;
};

const differenceByName = (nextNames, currentTags, tagType) => {
  const normalizedNext = nextNames.map((name) => slugish(name));
  return {
    add: nextNames.filter((name) => !currentTags.some((tag) => slugish(tag.name) === slugish(name))).map((name) => ({ name, tagType })),
    remove: currentTags.filter((tag) => !normalizedNext.includes(slugish(tag.name))).map((tag) => ({ id: tag.id, name: tag.name, tagType: tag.tag_type || tagType })),
  };
};

const saveIndexForm = async (form, item) => {
  const status = form.querySelector(".save-state");
  const formData = new FormData(form);
  const nextTitle = String(formData.get("title") || "").trim();
  const nextFolder = normalizeFolderPath(formData.get("folder"));
  const nextStandardTags = splitList(formData.get("standardTags"));
  const nextFreeformTags = splitList(formData.get("freeformTags"));
  const nextNotes = String(formData.get("notes") || "").trim();
  status.textContent = "Saving...";
  try {
    const operations = [];
    const changes = {};
    if (nextTitle && nextTitle !== item.title) changes.title = nextTitle;
    if (nextNotes !== String(item.notes || "")) changes.notes = nextNotes;
    if (Object.keys(changes).length) operations.push(window.CreativeDatabase.updateArtifact(item.id, changes, "Archive index edit"));
    if (nextFolder && nextFolder !== folderOf(item)) operations.push(window.CreativeDatabase.moveArtifact(item.id, nextFolder, "Archive index folder move"));
    const standardDiff = differenceByName(nextStandardTags, standardTagObjects(item), "standard");
    const freeformDiff = differenceByName(nextFreeformTags, tagsOf(item).filter((tag) => tag.tag_type === "freeform"), "freeform");
    if (standardDiff.add.length || standardDiff.remove.length || freeformDiff.add.length || freeformDiff.remove.length) {
      operations.push(window.CreativeDatabase.organizeArtifact(item.id, {
        addControlledTags: standardDiff.add,
        removeControlledTags: standardDiff.remove,
        addFreeformTags: freeformDiff.add,
        removeFreeformTags: freeformDiff.remove,
        reason: "Archive index tag edit",
      }));
    }
    if (!operations.length) {
      status.textContent = "No changes.";
      return;
    }
    await Promise.all(operations);
    status.textContent = "Saved live.";
    await load();
  } catch (error) {
    status.textContent = `Failed: ${error.message}`;
  }
};

const createFolder = async () => {
  const proposed = state.selectedFolder ? `${state.selectedFolder}/New Folder` : "Archive/New Folder";
  const folderPath = window.prompt("New Archive Index folder path", proposed);
  if (!folderPath?.trim()) return;
  els().status.textContent = "Creating folder...";
  try {
    const result = await window.CreativeDatabase.createFolder(folderPath.trim(), "Archive Index folder creation");
    state.selectedFolder = normalizeFolderPath(result.folder?.path || folderPath);
    els().status.textContent = result.message || "Folder created.";
    await load();
    document.querySelector('[data-filter="folder"]').value = state.selectedFolder;
    render();
  } catch (error) {
    els().status.textContent = `Folder create failed: ${error.message}`;
  }
};

const requireSelection = () => {
  const ids = [...state.selectedIds];
  if (!ids.length) {
    setBulkStatus("Select at least one database-backed file first.");
    return null;
  }
  return ids;
};

const bulkMoveSelected = async () => {
  const ids = requireSelection();
  if (!ids) return;
  const folderPath = document.querySelector("#bulk-folder").value;
  if (!folderPath) {
    setBulkStatus("Choose a folder before moving selected files.");
    return;
  }
  setBulkStatus(`Moving ${ids.length} selected file(s) to ${folderPath}...`);
  try {
    await window.CreativeDatabase.organizeArtifacts(ids, { folderPath, reason: "Bulk Archive Index folder move" });
    setBulkStatus(`Moved ${ids.length} selected file(s) to ${folderPath}. Source files on disk were not renamed or moved.`);
    await load();
  } catch (error) {
    setBulkStatus(`Bulk folder move failed: ${error.message}`);
  }
};

const bulkTagSelected = async (kind, action) => {
  const ids = requireSelection();
  if (!ids) return;
  const input = document.querySelector(kind === "freeform" ? "#bulk-freeform-tags" : "#bulk-standard-tags");
  const names = splitList(input.value);
  if (!names.length) {
    setBulkStatus(`Enter at least one ${kind} tag.`);
    return;
  }
  const tagPayload = names.map((name) => ({ name, tagType: kind === "freeform" ? "freeform" : "standard" }));
  const payload = { reason: `Bulk Archive Index ${action} ${kind} tags` };
  if (kind === "freeform" && action === "add") payload.addFreeformTags = tagPayload;
  if (kind === "freeform" && action === "remove") payload.removeFreeformTags = tagPayload;
  if (kind === "standard" && action === "add") payload.addControlledTags = tagPayload;
  if (kind === "standard" && action === "remove") payload.removeControlledTags = tagPayload;
  setBulkStatus(`${action === "add" ? "Adding" : "Removing"} ${names.join(", ")} on ${ids.length} selected file(s)...`);
  try {
    await window.CreativeDatabase.organizeArtifacts(ids, payload);
    setBulkStatus(`${action === "add" ? "Added" : "Removed"} ${names.join(", ")} on ${ids.length} selected file(s).`);
    input.value = "";
    await load();
  } catch (error) {
    setBulkStatus(`Bulk tag ${action} failed: ${error.message}`);
  }
};

const wireEvents = () => {
  const folderInput = document.querySelector("#folder-upload");
  document.querySelector("#create-folder").addEventListener("click", createFolder);
  document.querySelector("#select-visible").addEventListener("click", () => {
    for (const item of visibleDatabaseRecords()) state.selectedIds.add(item.id);
    setBulkStatus(`Selected ${state.selectedIds.size} database-backed visible file(s).`);
    render();
  });
  document.querySelector("#clear-selection").addEventListener("click", () => {
    state.selectedIds.clear();
    setBulkStatus("Selection cleared.");
    render();
  });
  document.querySelector("#bulk-move").addEventListener("click", bulkMoveSelected);
  document.querySelector("#bulk-add-standard").addEventListener("click", () => bulkTagSelected("standard", "add"));
  document.querySelector("#bulk-remove-standard").addEventListener("click", () => bulkTagSelected("standard", "remove"));
  document.querySelector("#bulk-add-freeform").addEventListener("click", () => bulkTagSelected("freeform", "add"));
  document.querySelector("#bulk-remove-freeform").addEventListener("click", () => bulkTagSelected("freeform", "remove"));
  folderInput.addEventListener("change", async (event) => {
    const files = [...event.currentTarget.files || []];
    if (!files.length) return;
    const { progress, status } = els();
    progress.hidden = false;
    progress.innerHTML = `<b>Adding ${files.length} file(s) to the Archive Index...</b>`;
    let done = 0;
    let failed = 0;
    for (const file of files) {
      const row = document.createElement("div");
      const name = file.webkitRelativePath || file.name;
      row.textContent = `${name}: queued`;
      progress.append(row);
      try {
        await window.CreativeDatabase.uploadArtifact(file, { relativePath: name, reason: "Add file to Archive Index" }, (label) => { row.textContent = `${name}: ${label}`; });
        done += 1;
      } catch (error) {
        failed += 1;
        row.textContent = `${name}: failed - ${error.message}`;
      }
    }
    status.textContent = `Add files finished: ${done} ready, ${failed} failed.`;
    event.currentTarget.value = "";
    await load();
  });

  document.querySelector("#artifact-grid").addEventListener("submit", async (event) => {
    const form = event.target.closest("[data-index-form]");
    if (!form) return;
    event.preventDefault();
    const item = mergedRecords().find((record) => record.id === form.closest("[data-artifact-id]").dataset.artifactId);
    if (item) await saveIndexForm(form, item);
  });

  document.querySelector("#artifact-grid").addEventListener("change", (event) => {
    const input = event.target.closest("[data-select-artifact]");
    if (!input) return;
    if (input.checked && state.selectedIds.size >= 25) {
      input.checked = false;
      setBulkStatus("Bulk organization is limited to 25 artifacts per atomic request.");
    } else if (input.checked) state.selectedIds.add(input.value);
    else state.selectedIds.delete(input.value);
    renderBulkControls();
  });

  document.querySelector("#artifact-grid").addEventListener("click", async (event) => {
    const downloadButton = event.target.closest("[data-download-file]");
    if (downloadButton) {
      downloadButton.disabled = true;
      try {
        const grant = await window.CreativeDatabase.downloadArtifact(downloadButton.dataset.downloadFile);
        const link = document.createElement("a");
        link.href = grant.downloadUrl;
        link.rel = "noopener";
        link.click();
      } catch (error) {
        els().status.textContent = `Download grant failed: ${error.message}`;
      } finally {
        downloadButton.disabled = false;
      }
      return;
    }
    const button = event.target.closest("[data-read-file]");
    if (!button) return;
    const item = mergedRecords().find((record) => record.id === button.dataset.readFile);
    const dialog = document.querySelector("#text-preview-dialog");
    const content = dialog.querySelector("[data-preview-content]");
    dialog.querySelector("[data-preview-title]").textContent = item?.title || "File preview";
    content.textContent = "Loading...";
    dialog.showModal();
    try {
      const response = await fetch(item.signedUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      content.textContent = (await response.text()).slice(0, 500000);
    } catch (error) {
      content.textContent = `Preview failed: ${error.message}`;
    }
  });

  document.querySelector("[data-close-preview]").addEventListener("click", () => document.querySelector("#text-preview-dialog").close());
  document.querySelector("#folder-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-folder]");
    if (!button) return;
    state.selectedFolder = button.dataset.folder || "";
    document.querySelector('[data-filter="folder"]').value = state.selectedFolder;
    state.pagination.page = 1;
    load();
  });
  document.querySelector("#reload-index").addEventListener("click", async () => {
    await load();
  });
  document.querySelector("#import-archive-snapshot").addEventListener("click", importArchiveSnapshot);
  const updateImportAuthority = (account = window.CreativeAccount?.current?.()) => {
    const button = document.querySelector("#import-archive-snapshot");
    const privileged = Boolean(account?.authenticated && ["admin", "owner"].includes(account.userRole));
    button.disabled = !privileged;
    button.title = privileged ? "Review and confirm a canonical metadata import." : "Authenticated admin or owner authority is required.";
  };
  updateImportAuthority();
  window.addEventListener("creative-os-auth-changed", (event) => updateImportAuthority(event.detail));
  document.querySelector("#clear-filters").addEventListener("click", () => {
    state.selectedFolder = "";
    document.querySelector("#artifact-search").value = "";
    document.querySelectorAll("[data-filter]").forEach((select) => { select.value = ""; });
    state.pagination.page = 1;
    load();
  });
  let searchTimer;
  document.querySelector("#artifact-search").addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.pagination.page = 1; load(); }, 250);
  });
  document.querySelectorAll("[data-filter]").forEach((select) => select.addEventListener("change", () => {
    if (select.dataset.filter === "folder") state.selectedFolder = select.value;
    state.pagination.page = 1;
    load();
  }));
  document.querySelector("#previous-page").addEventListener("click", () => {
    if (!state.pagination.hasPrevious) return;
    state.pagination.page -= 1;
    load();
  });
  document.querySelector("#next-page").addEventListener("click", () => {
    if (!state.pagination.hasNext) return;
    state.pagination.page += 1;
    load();
  });
};

const waitForCreativeDatabase = async () => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (window.CreativeDatabase?.listArtifacts) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
};

const start = () => {
  wireEvents();
  waitForCreativeDatabase().then(() => load({ refreshOptions: true }));
};

if (document.readyState === "loading") window.addEventListener("DOMContentLoaded", start, { once: true });
else start();
