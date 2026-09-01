import { loadDeskStories } from "./reath-wire-data.js";

const auth = window.ReathAuth || await new Promise((resolve) => window.addEventListener("reath-auth-client-ready", () => resolve(window.ReathAuth), { once: true }));
const message = document.querySelector("[data-wire-message]");
const sections = document.querySelector("[data-desk-sections]");
const filters = document.querySelector("[data-wire-filters]");
const dialog = document.querySelector("[data-story-dialog]");
const detail = document.querySelector("[data-story-detail]");
const sectionOrder = ["Kept", "Watch", "Reath Bait", "Developing", "Worth a Look", "Corroborated", "Needs Classification", "Low Signal", "Ignored"];
let activeQuery = "";

const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
const date = (value) => value ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/New_York" }).format(new Date(value)) : "Unknown";
const current = (rows, kind = null) => (rows || []).find((row) => row.is_current && (!kind || (row.analysis_kind || "deterministic") === kind)) || null;
const editorial = (story) => story.editorial_queue?.[0] || story.editorial_queue || { status: "new", route: null };
const locations = (story) => {
  const municipalities = (story.story_municipalities || []).map((link) => link.municipalities?.name).filter(Boolean);
  const counties = (story.story_counties || []).map((link) => `${link.counties?.name} County`).filter(Boolean);
  return [...municipalities, ...counties].join(" · ") || "New Jersey";
};
const shownScore = (value) => Number.isFinite(Number(value)) ? Number(value) : "—";
const scorePill = (label, value) => `<span class="score-pill">${escapeHtml(label)} <strong>${shownScore(value)}</strong></span>`;
const corroborationSummary = (story) => {
  const signal = story.corroboration || {};
  return `${signal.qualifiedJournalismCount || 0} journalistic · ${signal.reputableAccountCount || 0} reputable account${signal.reputableAccountCount === 1 ? "" : "s"}`;
};
const currentAssessment = (source) => (source?.source_assessments || []).find((assessment) => !assessment.superseded_at) || null;

const storyCard = (story) => {
  const scores = story.active_scores || current(story.story_scores, "deterministic") || {};
  return `<button class="story-card" type="button" data-story-id="${escapeHtml(story.id)}">
    <span class="state-badge">${escapeHtml(editorial(story).status)}${editorial(story).route ? ` · ${escapeHtml(editorial(story).route)}` : ""}</span>
    <span class="story-location">${escapeHtml(locations(story))}</span>
    <h3>${escapeHtml(story.canonical_title)}</h3>
    <span class="story-meta">${story.source_item_count} evidence item${story.source_item_count === 1 ? "" : "s"} · ${story.source_count} provider${story.source_count === 1 ? "" : "s"} · ${escapeHtml(corroborationSummary(story))}</span>
    <span class="signal-note">${escapeHtml(story.corroboration?.reason || "Source assessment pending.")}</span>
    <span class="score-row">${scorePill("Impact", scores.local_impact)}${scorePill("Civic", scores.civic_utility)}${scorePill("Reath", scores.reath_potential)}${scorePill("Satire", scores.satire_potential)}</span>
  </button>`;
};

const renderStories = (stories, { showingUnverifiedIntake = false, unverifiedFallback = false } = {}) => {
  if (!stories.length) {
    sections.hidden = true;
    message.hidden = false;
    message.textContent = unverifiedFallback
      ? "No corroborated Stories or unverified intake are available yet."
      : "No stories match these desk filters.";
    return;
  }
  const grouped = stories.reduce((map, story) => map.set(story.desk_section, [...(map.get(story.desk_section) || []), story]), new Map());
  sections.innerHTML = sectionOrder.filter((name) => grouped.has(name)).map((name) => `<section class="desk-section">
    <header><h2>${escapeHtml(showingUnverifiedIntake && name === "Low Signal" ? "Unverified intake · Low Signal" : name)}</h2><span>${grouped.get(name).length}</span></header>
    <div class="story-grid">${grouped.get(name).map(storyCard).join("")}</div>
  </section>`).join("");
  sections.hidden = false;
  message.hidden = !unverifiedFallback;
  if (unverifiedFallback) message.textContent = "No corroborated Stories are available yet. Showing unverified intake awaiting additional independent journalism sources.";
};

const addOptions = (select, values) => {
  const existing = new Set([...select.options].map((option) => option.value));
  for (const [value, label] of values) {
    if (!value || existing.has(value)) continue;
    select.add(new Option(label, value));
    existing.add(value);
  }
};

const populateFilters = (stories) => {
  addOptions(filters.elements.county, stories.flatMap((story) => (story.story_counties || []).map((link) => [link.counties?.slug, `${link.counties?.name} County`])).sort((a, b) => String(a[1]).localeCompare(String(b[1]))));
  addOptions(filters.elements.municipality, stories.flatMap((story) => (story.story_municipalities || []).map((link) => [link.municipality_id, link.municipalities?.name])).sort((a, b) => String(a[1]).localeCompare(String(b[1]))));
  addOptions(filters.elements.topic, stories.flatMap((story) => (story.active_enrichment?.topics || []).map((topic) => [topic, topic])).sort((a, b) => a[0].localeCompare(b[0])));
  addOptions(filters.elements.source, stories.flatMap((story) => (story.story_sources || []).map((link) => [link.source_items?.source_id, link.source_items?.sources?.name])).sort((a, b) => String(a[1]).localeCompare(String(b[1]))));
};

const loadStories = async (query = "", { fallbackToUnverified = false } = {}) => {
  message.hidden = false;
  message.textContent = "Loading the wire…";
  sections.hidden = true;
  try {
    const result = await loadDeskStories(auth.api, query, { fallbackToUnverified });
    const { stories } = result;
    activeQuery = result.query;
    const showingUnverifiedIntake = new URLSearchParams(activeQuery.startsWith("?") ? activeQuery.slice(1) : activeQuery).get("include_low_signal") === "true";
    if (showingUnverifiedIntake) filters.elements.include_low_signal.checked = true;
    populateFilters(stories);
    renderStories(stories, { showingUnverifiedIntake, unverifiedFallback: result.unverifiedFallback });
  } catch (error) {
    message.textContent = error.message;
  }
};

const scoreBoard = (scores) => {
  const fields = [["Local impact","local_impact"],["Civic utility","civic_utility"],["Significance","significance"],["Momentum","momentum"],["Novelty","novelty"],["Human interest","human_interest"],["Emotional resonance","emotional_resonance"],["Reath potential","reath_potential"],["Satire potential","satire_potential"],["Locality","locality"],["Confidence","confidence"]];
  return fields.map(([label, key]) => `<div class="score-box"><span>${escapeHtml(label)}</span><b>${shownScore(scores?.[key])}</b></div>`).join("");
};

const coverage = (story) => (story.story_sources || []).filter((link) => !link.detached_at).sort((a, b) => new Date(a.source_items?.published_at || a.attached_at) - new Date(b.source_items?.published_at || b.attached_at));

const aiLabel = (story) => {
  const ai = story.ai || { enrichmentStatus:"unavailable" };
  if (ai.enrichmentStatus === "current") return `AI current · ${ai.provider} · ${ai.model}`;
  if (ai.enrichmentStatus === "failed") return `AI failed${ai.error ? ` · ${ai.error}` : ""}`;
  if (ai.enrichmentStatus === "pending" || ai.enrichmentStatus === "running") return `AI ${ai.enrichmentStatus}`;
  if (ai.enrichmentStatus === "stale") return "AI refresh pending · deterministic desk active";
  if (ai.enrichmentStatus === "disabled") return "AI disabled · deterministic desk active";
  return "AI unavailable · deterministic desk active";
};

const comparison = (story) => {
  return (story.story_analyses || []).find((analysis) => story.ai?.status === "available" &&
    analysis.is_current && analysis.operation_type === "compare_sources" &&
    String(analysis.evidence_revision) === String(story.evidence_revision) &&
    analysis.enrichment_version === story.ai.enrichmentVersion &&
    analysis.provider === story.ai.provider && analysis.model === story.ai.model &&
    analysis.schema_version === "1" && analysis.prompt_version === "compare-sources-v1");
};

const comparisonAttempt = (story) => {
  return (story.ai_call_attempts || [])
  .filter((attempt) => attempt.operation_type === "compare_sources" && story.ai?.status === "available" &&
    String(attempt.evidence_revision) === String(story.evidence_revision) &&
    attempt.enrichment_version === story.ai.enrichmentVersion &&
    attempt.provider === story.ai.provider && attempt.model === story.ai.model &&
    attempt.schema_version === "1" && attempt.prompt_version === "compare-sources-v1")
  .sort((a, b) => Number(b.request_sequence || 0) - Number(a.request_sequence || 0) || new Date(b.started_at) - new Date(a.started_at))[0] || null;
};

const comparisonBlock = (story) => {
  const analysis = comparison(story);
  const attempt = comparisonAttempt(story);
  if (!analysis && ["queued", "running"].includes(attempt?.status)) {
    return `<section class="detail-block comparison-block"><h3>Source comparison</h3><p>AI source comparison is ${escapeHtml(attempt.status)}. Deterministic Story metadata remains active.</p></section>`;
  }
  if (!analysis && ["failed", "rejected"].includes(attempt?.status)) {
    return `<section class="detail-block comparison-block"><h3>Source comparison</h3><p>The latest source-comparison attempt failed. Review AI Activity before retrying.</p></section>`;
  }
  if (!analysis) return "";
  const result = analysis.result || {};
  const sources = new Map(coverage(story).map((link) => [link.source_item_id, link.source_items]));
  const claims = (items) => (items || []).map((item) => {
    const citations = (item.source_item_ids || []).map((id) => {
      const source = sources.get(id);
      return source ? `<a href="${escapeHtml(source.canonical_url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.headline)}</a>` : escapeHtml(id.slice(0, 8));
    }).join(" · ");
    return `<li>${escapeHtml(item.claim)}${citations ? `<small>${citations}</small>` : ""}</li>`;
  }).join("") || "<li>None recorded.</li>";
  return `<section class="detail-block comparison-block"><h3>Latest source comparison</h3>
    <p>${escapeHtml(result.development_summary || "No development summary.")}</p>
    <h4>Agreement</h4><ul>${claims(result.agreements)}</ul>
    <h4>Primary-source claims</h4><ul>${claims(result.primary_source_claims)}</ul>
    <h4>Differences / disputes</h4><ul>${claims([...(result.differences || []), ...(result.disputed_claims || [])])}</ul>
    <h4>Unknowns</h4><ul>${(result.unknowns || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("") || "<li>None recorded.</li>"}</ul>
  </section>`;
};

const renderDetail = (story) => {
  const queue = editorial(story);
  const scores = story.active_scores || current(story.story_scores, "deterministic") || {};
  const enriched = story.active_enrichment || current(story.story_enrichments, "deterministic") || {};
  const briefing = enriched.briefing || {};
  const aiAvailable = story.ai?.status === "available";
  const enrichmentRunning = ["pending", "running"].includes(story.ai?.enrichmentStatus);
  const comparisonRunning = ["queued", "running"].includes(comparisonAttempt(story)?.status);
  detail.innerHTML = `<article class="story-detail" data-open-story="${escapeHtml(story.id)}">
    <p class="kicker">${escapeHtml(story.desk_section)} · ${escapeHtml(locations(story))}</p>
    <h2>${escapeHtml(story.canonical_title)}</h2>
    <p class="story-meta">First seen ${escapeHtml(date(story.first_seen_at))} · Last activity ${escapeHtml(date(story.last_activity_at))} · ${story.source_item_count} active evidence item${story.source_item_count === 1 ? "" : "s"} from ${story.source_count} provider${story.source_count === 1 ? "" : "s"}</p>
    <p class="ai-state ${story.ai?.enrichmentStatus || "unavailable"}">${escapeHtml(aiLabel(story))}</p>
    <div class="detail-grid">
      <section class="detail-block"><h3>What happened</h3><p>${escapeHtml(briefing.summary_internal || story.summary_internal || "Briefing pending.")}</p></section>
      <section class="detail-block"><h3>Where</h3><p>${escapeHtml(locations(story))}</p></section>
      <section class="detail-block"><h3>Why it may matter</h3><p>${escapeHtml(briefing.why_it_may_matter || story.why_it_may_matter || "Editorial review pending.")}</p></section>
      <section class="detail-block"><h3>What is disputed / different</h3><p>${escapeHtml(briefing.disputed_or_different || story.disputed_or_different || "No comparison recorded yet.")}</p></section>
      <section class="detail-block"><h3>What we do not yet know</h3><p>${escapeHtml(briefing.unknowns || story.unknowns || "Verification questions pending.")}</p></section>
      <section class="detail-block"><h3>Structured context</h3><p>${escapeHtml((enriched.topics || []).join(" · ") || "Deterministic classification pending")}</p><p>${escapeHtml((enriched.organizations || []).join(" · "))}</p></section>
      <section class="detail-block"><h3>Evidence strength</h3><p>${escapeHtml(story.corroboration?.reason || "Source assessment pending.")}</p><p>${escapeHtml(corroborationSummary(story))} · ${story.corroboration?.independentProviderCount || 0} independent qualifying group${story.corroboration?.independentProviderCount === 1 ? "" : "s"} · ${story.corroboration?.unassessedSourceCount || 0} unassessed</p><p>Corroboration controls desk priority; it does not replace editorial verification.</p></section>
      ${comparisonBlock(story)}
    </div>
    <section class="coverage"><h3>Coverage</h3><ol class="coverage-list">${coverage(story).map((link) => `<li>
      <small>${escapeHtml(date(link.source_items?.published_at || link.attached_at))}<br/>${escapeHtml(link.source_items?.publisher)}<br/>${escapeHtml(currentAssessment(link.source_items?.sources)?.evidence_role || "unassessed")}</small>
      <a href="${escapeHtml(link.source_items?.canonical_url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(link.source_items?.headline)}</a>
      <button type="button" data-detach-source="${escapeHtml(link.source_item_id)}">Detach</button>
    </li>`).join("")}</ol></section>
    <section class="score-board"><h3>Editorial scores</h3><div class="score-grid">${scoreBoard(scores)}</div></section>
    <section class="editorial-actions"><h3>Editorial actions</h3>
      <div class="action-row">${["new","watch","keep","ignore"].map((status) => `<button type="button" class="${queue.status === status ? "active" : ""}" data-set-status="${status}">${escapeHtml(status)}</button>`).join("")}</div>
      <div class="action-row" style="margin-top:10px"><select data-route><option value="">No route</option>${[["digest","Digest"],["civic_relay","Civic Relay"],["funnies","Funnies"],["longform","Longform"]].map(([value,label]) => `<option value="${value}" ${queue.route === value ? "selected" : ""}>${label}</option>`).join("")}</select><button type="button" data-save-route>Save route</button><button type="button" data-merge-story>Merge another story here</button></div>
      <div class="action-row" style="margin-top:10px"><button type="button" data-ai-refresh ${aiAvailable && !enrichmentRunning ? "" : "disabled"}>${enrichmentRunning ? `AI refresh ${escapeHtml(story.ai.enrichmentStatus)}` : "Refresh AI enrichment"}</button><button type="button" data-compare-sources ${aiAvailable && story.source_count >= 2 && !comparisonRunning ? "" : "disabled"}>${comparisonRunning ? "Comparison queued" : "Compare Sources"}</button></div>
      <p class="wire-message" data-action-message></p>
    </section>
  </article>`;
};

const openStory = async (storyId) => {
  detail.textContent = "Loading story…";
  dialog.showModal();
  try {
    const { story } = await auth.api(`/api/reath/stories/${storyId}`);
    renderDetail(story);
  } catch (error) { detail.textContent = error.message; }
};

sections.addEventListener("click", (event) => {
  const card = event.target.closest("[data-story-id]");
  if (card) openStory(card.dataset.storyId);
});
document.querySelector("[data-dialog-close]").addEventListener("click", () => dialog.close());
dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });

detail.addEventListener("click", async (event) => {
  const article = event.target.closest("[data-open-story]");
  if (!article) return;
  const storyId = article.dataset.openStory;
  const actionMessage = article.querySelector("[data-action-message]");
  const perform = async (task) => { try { actionMessage.textContent = "Saving…"; await task(); actionMessage.textContent = "Saved."; await openStory(storyId); await loadStories(activeQuery); } catch (error) { actionMessage.textContent = error.message; } };
  const statusButton = event.target.closest("[data-set-status]");
  if (statusButton) await perform(() => auth.api(`/api/reath/stories/${storyId}/editorial`, { method:"PATCH", body:JSON.stringify({ status:statusButton.dataset.setStatus, route:article.querySelector("[data-route]").value || null }) }));
  if (event.target.closest("[data-save-route]")) {
    const active = article.querySelector("[data-set-status].active")?.dataset.setStatus || "new";
    await perform(() => auth.api(`/api/reath/stories/${storyId}/editorial`, { method:"PATCH", body:JSON.stringify({ status:active, route:article.querySelector("[data-route]").value || null }) }));
  }
  const detach = event.target.closest("[data-detach-source]");
  if (detach) {
    const reason = window.prompt("Why is this source attached to the wrong story?");
    if (reason) await perform(() => auth.api(`/api/reath/stories/${storyId}/sources/${detach.dataset.detachSource}/detach`, { method:"POST", body:JSON.stringify({ reason }) }));
  }
  if (event.target.closest("[data-merge-story]")) {
    const sourceStoryId = window.prompt("Story ID to merge into this story:");
    const reason = sourceStoryId ? window.prompt("Reason for merge:") : null;
    if (sourceStoryId && reason) await perform(() => auth.api("/api/reath/stories/merge", { method:"POST", body:JSON.stringify({ targetStoryId:storyId, sourceStoryId, reason }) }));
  }
  if (event.target.closest("[data-ai-refresh]")) {
    await perform(() => auth.api(`/api/reath/stories/${storyId}/ai/enrich`, { method:"POST", body:"{}" }));
  }
  if (event.target.closest("[data-compare-sources]")) {
    await perform(() => auth.api(`/api/reath/stories/${storyId}/ai/analyze`, { method:"POST", body:JSON.stringify({ operation:"compare_sources" }) }));
  }
});

filters.addEventListener("submit", (event) => {
  event.preventDefault();
  const parameters = new URLSearchParams([...new FormData(filters)].filter(([, value]) => value));
  loadStories(parameters.size ? `?${parameters}` : "");
});

document.querySelector("[data-run-ingestion]").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  button.textContent = "Starting…";
  try {
    const result = await auth.api("/api/reath/ingest", { method:"POST", body:"{}" });
    message.hidden = false;
    message.textContent = result.accepted
      ? "Ingestion started. All active sources, the one-month processing backlog, and duplicate Story candidates are being checked."
      : "Ingestion could not be queued.";
    if (result.accepted) window.setTimeout(() => loadStories(activeQuery), 60_000);
  } catch (error) { message.hidden = false; message.textContent = error.message; }
  finally { button.disabled = false; button.textContent = "Run ingestion"; }
});

const initialize = async () => {
  const user = await auth.ready;
  if (user) {
    await loadStories("", { fallbackToUnverified: true });
    const requestedStory = new URLSearchParams(window.location.search).get("story");
    if (/^[0-9a-f-]{36}$/i.test(requestedStory || "")) await openStory(requestedStory);
  }
};
initialize();
window.addEventListener("reath-auth-changed", (event) => event.detail ? loadStories("", { fallbackToUnverified: true }) : (message.textContent = "Sign in to load the desk."));
