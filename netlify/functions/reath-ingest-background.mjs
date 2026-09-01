import { timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";

import { envValue } from "./_shared/reath/config.mjs";
import { runOptionalAiLayer } from "./_shared/reath/ai-core.mjs";
import { queueStoryAiEnrichment, runStoryAiEnrichmentBatch, runStoryAiHousekeeping } from "./_shared/reath/ai-orchestrator.mjs";
import {
  ingestDueSources,
  MANUAL_INGESTION_RETENTION_DAYS,
} from "./_shared/reath/ingestion.mjs";
import { runStoryReconciliation } from "./_shared/reath/reconciliation.mjs";
import { getReathSupabase } from "./_shared/reath/supabase.mjs";

const tokensMatch = (actual, expected) => {
  const left = Buffer.from(actual || "");
  const right = Buffer.from(expected || "");
  return left.length > 0 && left.length === right.length && timingSafeEqual(left, right);
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const readDispatch = async (request) => {
  const text = await request.text();
  if (!text.trim()) throw new Error("Background ingestion requires an explicit manual dispatch");
  let body;
  try { body = JSON.parse(text); }
  catch { throw new Error("Background ingestion payload must be valid JSON"); }
  const sourceIds = body.sourceIds == null ? null : [...new Set((Array.isArray(body.sourceIds) ? body.sourceIds : [])
    .map((item) => String(item || "").trim().toLowerCase()))];
  if (body.sourceIds != null && (!Array.isArray(body.sourceIds) || sourceIds.length > 50 || sourceIds.some((item) => !UUID_PATTERN.test(item)))) {
    throw new Error("Background ingestion sourceIds must contain at most 50 valid UUIDs");
  }
  const triggerType = ["manual", "acceptance_test"].includes(body.triggerType) ? body.triggerType : null;
  if (!triggerType) throw new Error("Automatic ingestion is disabled; use the Run ingestion action");
  return {
    triggerType,
    triggeredBy: String(body.triggeredBy || "background-dispatch").slice(0, 300),
    sourceIds,
  };
};

export default async (request) => {
  const expectedToken = envValue("REATH_SCHEDULE_TOKEN");
  if (request.method !== "POST" || !tokensMatch(request.headers.get("x-reath-schedule-token"), expectedToken)) {
    return Response.json({ ok: false, error: "Not found" }, { status: 404 });
  }

  try {
    const dispatch = await readDispatch(request);
    const { client: supabase, config: baseConfig } = getReathSupabase();
    const config = { ...baseConfig, queueStoryAiEnrichment };
    const manual = dispatch.triggerType === "manual";
    const coreResult = await ingestDueSources({
      supabase,
      config,
      ...dispatch,
      forceSourceRefresh: manual && !dispatch.sourceIds?.length,
      lookbackDays: manual ? MANUAL_INGESTION_RETENTION_DAYS : null,
      coreWallBudgetMs: manual ? 7 * 60_000 : undefined,
    });
    if (["already_running", "superseded"].includes(coreResult.status)) {
      console.log(JSON.stringify({ event: "reath_manual_ingestion_skipped", activeRunId: coreResult.runId, admissionReason: coreResult.admissionReason }));
      return;
    }
    let reconciliation = { status: "not_requested" };
    if (manual && Date.now() + 90_000 < new Date(coreResult.deadlineAt).getTime()) {
      try {
        const reconciled = await runStoryReconciliation({
          supabase,
          config,
          apply: true,
          triggeredBy: `system:manual-ingestion:${coreResult.runId}`,
          scanLimit: 2_000,
          mergeLimit: 50,
          deadlineAt: coreResult.deadlineAt,
        });
        reconciliation = {
          status: reconciled.errors.length || reconciled.deferred ? "partial" : "succeeded",
          runId: reconciled.runId,
          mode: reconciled.mode,
          applied: reconciled.applied,
          deferred: reconciled.deferred,
          errors: reconciled.errors.length,
        };
      } catch (error) {
        reconciliation = { status: "failed", error: error.message };
        console.error(JSON.stringify({ event: "reath_story_reconciliation_failed", runId: coreResult.runId, message: error.message }));
      }
    }
    const result = await runOptionalAiLayer({
      enabled: config.aiEnabled,
      coreResult,
      runHousekeeping: () => runStoryAiHousekeeping({ supabase }),
      runAi: (housekeeping) => runStoryAiEnrichmentBatch({
        supabase,
        config,
        ingestionRunId: coreResult.runId,
        housekeeping,
        configurationCutoff: coreResult.startedAt,
        deadlineAt: coreResult.deadlineAt,
      }),
    });
    console.log(JSON.stringify({ event: "reath_manual_ingestion_complete", ...result, maintenance: coreResult.maintenance, reconciliation, results: undefined }));
  } catch (error) {
    console.error(JSON.stringify({ event: "reath_manual_ingestion_failed", message: error.message }));
    throw error;
  }
};

export const config = { background: true };
