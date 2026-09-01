import { ingestDueSources } from "../_shared/reath/ingestion.mjs";
import { runStoryReconciliation } from "../_shared/reath/reconciliation.mjs";
import { getReathSupabase } from "../_shared/reath/supabase.mjs";

const SOURCE_BATCH_SIZE = 8;
const MAX_ITEMS_PER_RUN = 24;
const BACKLOG_ITEMS_PER_RUN = 8;
const CORE_WALL_BUDGET_MS = 95_000;
const INVOCATION_WALL_BUDGET_MS = 125_000;
const RECONCILIATION_SCAN_LIMIT = 30;
const RECONCILIATION_MERGE_LIMIT = 1;
const encoder = new TextEncoder();

const tokenDigest = async (value) => new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(String(value || ""))));
const tokensMatch = async (actual, expected) => {
  if (!actual || !expected) return false;
  const [left, right] = await Promise.all([tokenDigest(actual), tokenDigest(expected)]);
  let difference = left.length ^ right.length;
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    difference |= (left[index] || 0) ^ (right[index] || 0);
  }
  return difference === 0;
};

const requestMode = async (request) => {
  const text = await request.text();
  if (!text.trim()) return "ingest";
  const body = JSON.parse(text);
  if (!body || !["ingest", "reconcile"].includes(body.mode)) throw new Error("mode must be ingest or reconcile");
  return body.mode;
};

const runIngestion = async (supabase, config) => ingestDueSources({
  supabase,
  config,
  triggerType: "scheduled",
  triggeredBy: "supabase-cron:reath-ingest",
  dueSourceLimit: SOURCE_BATCH_SIZE,
  maximumItems: MAX_ITEMS_PER_RUN,
  backlogLimit: BACKLOG_ITEMS_PER_RUN,
  coreWallBudgetMs: CORE_WALL_BUDGET_MS,
  invocationWallBudgetMs: INVOCATION_WALL_BUDGET_MS,
  staleAfterMs: 15 * 60_000,
});

const runReconciliation = async (supabase, config) => runStoryReconciliation({
  supabase,
  config,
  apply: true,
  triggeredBy: "system:supabase-edge-reconciliation",
  scanLimit: RECONCILIATION_SCAN_LIMIT,
  mergeLimit: RECONCILIATION_MERGE_LIMIT,
  deadlineAt: new Date(Date.now() + INVOCATION_WALL_BUDGET_MS).toISOString(),
});

export default {
  fetch: async (request) => {
    if (request.method !== "POST" || !await tokensMatch(
      request.headers.get("x-reath-schedule-token"),
      Deno.env.get("REATH_EDGE_SCHEDULE_TOKEN"),
    )) {
      return Response.json({ ok: false, error: "Not found" }, { status: 404 });
    }

    try {
      const mode = await requestMode(request);
      const { client: supabase, config } = getReathSupabase(Deno.env.toObject());
      const result = mode === "reconcile"
        ? await runReconciliation(supabase, config)
        : await runIngestion(supabase, config);
      console.log(JSON.stringify({ event: `reath_edge_${mode}_complete`, result }));
      return Response.json({ ok: true, mode, result }, {
        headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
      });
    } catch (error) {
      console.error(JSON.stringify({ event: "reath_edge_worker_failed", message: error.message }));
      return Response.json({ ok: false, error: error.message }, { status: 500 });
    }
  },
};
