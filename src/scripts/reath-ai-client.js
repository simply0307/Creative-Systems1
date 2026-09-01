const auth = window.ReathAuth || await new Promise((resolve) => window.addEventListener("reath-auth-client-ready", () => resolve(window.ReathAuth), { once: true }));
const message = document.querySelector("[data-ai-activity-message]");
const activity = document.querySelector("[data-ai-activity]");
const summary = document.querySelector("[data-ai-summary]");
const rows = document.querySelector("[data-ai-call-rows]");
const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;" })[character]);
const date = (value) => value ? new Intl.DateTimeFormat("en-US", { dateStyle:"medium", timeStyle:"short", timeZone:"America/New_York" }).format(new Date(value)) : "—";
const metric = (label, value) => `<div><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></div>`;

const load = async () => {
  message.hidden = false;
  message.textContent = "Loading AI activity…";
  activity.hidden = true;
  try {
    const data = await auth.api("/api/reath/ai/activity");
    const capability = data.ai || {};
    summary.innerHTML = [
      metric("Capability", capability.status || "unknown"), metric("Provider", capability.provider || "—"),
      metric("Model", capability.model || "—"), metric("Per-run cap", capability.maxStoriesPerRun ?? "—"),
      metric("Summary window", `latest ${data.summary.rowLimit || 100}`),
      metric("Calls in window", data.summary.total), metric("Provider calls in window", data.summary.providerCalls),
      metric("Succeeded", data.summary.succeeded), metric("Failed", data.summary.failed),
      metric("Cache hits", data.summary.cacheHits), metric("Input tokens", data.summary.inputTokens),
      metric("Output tokens", data.summary.outputTokens),
    ].join("");
    rows.innerHTML = (data.calls || []).map((call) => `<tr class="${escapeHtml(call.status)}">
      <td>${escapeHtml(call.operation_type)}</td><td><button class="text-button" data-story-id="${escapeHtml(call.story_id)}">${escapeHtml(call.story_id.slice(0, 8))}</button></td>
      <td>${escapeHtml(call.status)}${call.cache_hit ? " · cache" : ""}<small title="${escapeHtml(call.input_fingerprint || "")}">${escapeHtml(call.input_fingerprint ? `input ${call.input_fingerprint.slice(0, 12)}…` : "")}</small></td><td>${escapeHtml(call.provider || "—")}<small>${escapeHtml(call.model_version || call.model || "")}</small></td>
      <td>${escapeHtml(date(call.started_at))}</td><td>${call.latency_ms == null ? "—" : `${Number(call.latency_ms)} ms`}</td>
      <td>${Number(call.total_tokens || 0)}</td><td>${escapeHtml(call.error_message || "—")}</td></tr>`).join("");
    activity.hidden = false;
    message.hidden = true;
  } catch (error) { message.textContent = error.message; }
};

rows.addEventListener("click", (event) => {
  const button = event.target.closest("[data-story-id]");
  if (button) window.location.href = `/wire?story=${encodeURIComponent(button.dataset.storyId)}`;
});
document.querySelector("[data-ai-activity-refresh]").addEventListener("click", load);
const initialize = async () => { if (await auth.ready) await load(); };
initialize();
window.addEventListener("reath-auth-changed", (event) => event.detail ? load() : (message.textContent = "Sign in to load AI activity."));
