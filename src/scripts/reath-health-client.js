const auth = window.ReathAuth || await new Promise((resolve) => window.addEventListener("reath-auth-client-ready", () => resolve(window.ReathAuth), { once: true }));
const message = document.querySelector("[data-health-message]");
const wrapper = document.querySelector("[data-health-table]");
const tbody = wrapper.querySelector("tbody");
const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
const date = (value) => value ? new Intl.DateTimeFormat("en-US", { dateStyle:"short", timeStyle:"short", timeZone:"America/New_York" }).format(new Date(value)) : "Never";
const currentAssessment = (source) => (source.source_assessments || []).find((assessment) => !assessment.superseded_at) || null;

const load = async () => {
  message.hidden = false;
  message.textContent = "Checking the registry…";
  wrapper.hidden = true;
  try {
    const { sources } = await auth.api("/api/reath/sources/health");
    tbody.innerHTML = sources.map((source) => {
      const stale = !source.last_success_at || Date.now() - new Date(source.last_success_at).getTime() > Math.max(source.poll_interval_minutes * 3, 180) * 60_000;
      const state = source.failure_streak > 0 ? "health-bad" : stale ? "health-stale" : "";
      const scope = source.municipalities?.name || source.counties?.name || source.scope;
      const assessment = currentAssessment(source);
      return `<tr class="${state}"><td><b>${escapeHtml(source.name)}</b><small>${source.active ? "active" : "disabled"} · ${escapeHtml(source.source_type)} · every ${source.poll_interval_minutes}m</small></td><td>${escapeHtml(assessment?.assessment_status || "unassessed")}<small>${escapeHtml(assessment?.evidence_role || "—")} · tier ${escapeHtml(assessment?.verification_tier ?? "—")}<br/>${escapeHtml(assessment?.corroboration_group_key || "—")}</small></td><td>${escapeHtml(scope)}</td><td>${escapeHtml(date(source.last_success_at))}</td><td>${escapeHtml(date(source.last_checked_at))}</td><td>${Number(source.recent_item_count || 0)}</td><td>${Number(source.failure_streak || 0)}</td><td>${escapeHtml(source.last_error || "—")}</td></tr>`;
    }).join("");
    wrapper.hidden = false;
    message.hidden = true;
  } catch (error) { message.textContent = error.message; }
};

document.querySelector("[data-health-refresh]").addEventListener("click", load);
auth.ready.then((user) => { if (user) load(); });
window.addEventListener("reath-auth-changed", (event) => event.detail ? load() : (message.textContent = "Sign in to load source health."));
