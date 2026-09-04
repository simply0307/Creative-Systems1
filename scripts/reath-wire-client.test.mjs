import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { loadDeskStories, withUnverifiedIntake } from "../src/scripts/reath-wire-data.js";

test("the initial desk retries with unverified intake only after an empty verified response", async () => {
  const requests = [];
  const api = async (path) => {
    requests.push(path);
    return requests.length === 1 ? { stories: [] } : { stories: [{ id: "intake-story" }] };
  };

  const result = await loadDeskStories(api, "", { fallbackToUnverified: true });

  assert.deepEqual(requests, ["/api/reath/stories", "/api/reath/stories?include_low_signal=true"]);
  assert.deepEqual(result.stories, [{ id: "intake-story" }]);
  assert.equal(result.unverifiedFallback, true);
});

test("the initial desk does not request unverified intake when corroborated Stories exist", async () => {
  const requests = [];
  const api = async (path) => {
    requests.push(path);
    return { stories: [{ id: "verified-story" }] };
  };

  const result = await loadDeskStories(api, "?hours=72", { fallbackToUnverified: true });

  assert.deepEqual(requests, ["/api/reath/stories?hours=72"]);
  assert.equal(result.unverifiedFallback, false);
});

test("the fallback query preserves desk filters and explicitly includes low-signal intake", () => {
  assert.equal(withUnverifiedIntake("?status=watch&hours=72"), "?status=watch&hours=72&include_low_signal=true");
});

test("the invite-only account UI retains the invite token in browser memory and accepts it with a password", async () => {
  const [client, layout] = await Promise.all([
    readFile(new URL("../src/scripts/reath-auth-client.js", import.meta.url), "utf8"),
    readFile(new URL("../src/layouts/ReathLayout.astro", import.meta.url), "utf8"),
  ]);

  assert.match(client, /callback\?\.type === "invite"/);
  assert.match(client, /pendingInviteToken = callback\.token/);
  assert.match(client, /acceptInvite\(pendingInviteToken, password\)/);
  assert.match(layout, /data-invite-form/);
  assert.match(layout, /Accounts are invitation-only/);
  assert.doesNotMatch(layout, /data-signup-form/);
});

test("queued ingestion uses a dedicated accessible animated status instead of replacing Wire content", async () => {
  const [client, page, styles] = await Promise.all([
    readFile(new URL("../src/scripts/reath-wire-client.js", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/wire/index.astro", import.meta.url), "utf8"),
    readFile(new URL("../src/styles/reath.css", import.meta.url), "utf8"),
  ]);

  assert.match(page, /data-ingestion-status[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(page, /data-ingestion-status-text/);
  assert.match(client, /setIngestionStatus\("queued", "Ingestion queued/);
  assert.match(client, /setIngestionStatus\("refreshing", "Ingestion is processing/);
  assert.match(client, /server lacks jwt secret/i);
  assert.match(styles, /@keyframes ingestion-queue-pulse/);
  assert.match(styles, /prefers-reduced-motion:reduce/);
});
