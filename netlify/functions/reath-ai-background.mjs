import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";

import { processQueuedStoryAnalysis, processRequestedStoryAiEnrichment } from "./_shared/reath/ai-orchestrator.mjs";
import { envValue } from "./_shared/reath/config.mjs";
import { getReathSupabase } from "./_shared/reath/supabase.mjs";

const tokensMatch = (actual, expected) => {
  const left = Buffer.from(actual || "");
  const right = Buffer.from(expected || "");
  return left.length > 0 && left.length === right.length && timingSafeEqual(left, right);
};

const identifier = (value) => /^[0-9a-f-]{36}$/i.test(String(value || "")) ? String(value) : null;

export default async (request) => {
  const expectedToken = envValue("REATH_SCHEDULE_TOKEN");
  if (request.method !== "POST" || !tokensMatch(request.headers.get("x-reath-schedule-token"), expectedToken)) {
    return Response.json({ ok: false, error: "Not found" }, { status: 404 });
  }
  try {
    const body = await request.json();
    const { client: supabase, config } = getReathSupabase();
    let result;
    if (body.operation === "enrich_story" && identifier(body.storyId)) {
      result = await processRequestedStoryAiEnrichment({ supabase, config, storyId: body.storyId });
    } else if (body.operation === "compare_sources" && identifier(body.callAttemptId)) {
      result = await processQueuedStoryAnalysis({ supabase, config, callAttemptId: body.callAttemptId, drainSuccessor: true });
    } else {
      throw new Error("Unsupported or invalid AI background request");
    }
    console.log(JSON.stringify({ event: "reath_editor_ai_complete", operation: body.operation, status: result.status }));
  } catch (error) {
    console.error(JSON.stringify({ event: "reath_editor_ai_failed", message: error.message }));
    throw error;
  }
};

export const config = { background: true };
