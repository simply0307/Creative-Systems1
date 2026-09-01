import { getReathSupabase } from "../netlify/functions/_shared/reath/supabase.mjs";
import { runStoryReconciliation } from "../netlify/functions/_shared/reath/reconciliation.mjs";

const apply = process.argv.includes("--apply");
const { client: supabase, config } = getReathSupabase();

const result = await runStoryReconciliation({
  supabase,
  config: { ...config, aiEnabled: false },
  apply,
  triggeredBy: apply ? "operator:reconciliation-cli" : "operator:reconciliation-cli-preview",
});

console.log(JSON.stringify({
  mode: result.mode,
  runId: result.runId,
  applied: result.applied,
  deferred: result.deferred,
  results: result.results.map((entry) => ({
    outcome: entry.outcome,
    reason: entry.reason,
    targetStoryId: entry.target_story_id,
    sourceStoryId: entry.source_story_id,
    confidence: entry.confidence,
  })),
  errors: result.errors,
}, null, 2));

if (result.errors.length) process.exitCode = 1;
