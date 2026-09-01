import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import {
  isUntouchedReconciliationStory,
  planStoryReconciliationPairs,
  runStoryReconciliation,
  STORY_RECONCILIATION_ALGORITHM_VERSION,
} from "../netlify/functions/_shared/reath/reconciliation.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
const migrationNames = [
  "20260822031655_convert_creative_os_to_reath_digest.sql",
  "20260822034810_add_optional_story_ai.sql",
  "20260826064130_harden_ingestion_recovery_and_ai_preconditions.sql",
  "20260826072430_split_spotlight_daily_edition_date_conflict.sql",
  "20260826080300_split_new_jersey_stage_recurring_event_conflicts.sql",
  "20260826090008_add_corroboration_signal_and_sources.sql",
  "20260826102000_harden_evidence_origins_and_business_feed.sql",
  "20260826151000_disable_netlify_blocked_nj_business_feed.sql",
  "20260826175800_expand_reviewed_nj_journalism_sources.sql",
  "20260826190000_add_safe_story_reconciliation.sql",
];
const reconciliationMigrationPath = path.resolve(directory, "../supabase/migrations/20260826190000_add_safe_story_reconciliation.sql");
const ingestionBackgroundPath = path.resolve(directory, "../netlify/functions/reath-ingest-background.mjs");

const source = ({ id, groupKey }) => ({
  id,
  active: true,
  source_assessments: [{
    id: `${id.slice(0, -1)}a`,
    assessment_status: "reviewed",
    evidence_role: "independent_journalism",
    verification_tier: 3,
    corroboration_group_key: groupKey,
    assessed_at: "2026-08-26T12:00:00Z",
    superseded_at: null,
  }],
});

const makeStory = ({
  id,
  firstSeen,
  links,
  status = "developing",
  queueStatus = "new",
  decisions = [],
  evidenceRevision = 2,
}) => ({
  id,
  canonical_title: links[0].headline,
  status,
  merged_into_story_id: null,
  first_seen_at: firstSeen,
  last_activity_at: firstSeen,
  evidence_revision: evidenceRevision,
  editorial_queue: [{
    status: queueStatus,
    route: null,
    notes: "",
    decided_by: null,
    decided_at: null,
    routed_by: null,
    routed_at: null,
  }],
  editorial_decisions: decisions,
  story_ai_state: [],
  ai_call_attempts: [],
  story_analyses: [],
  story_enrichments: [],
  story_counties: [{ county_id: 11 }],
  story_municipalities: [{ municipality_id: "trenton-city" }],
  story_sources: links.map((entry) => ({
    source_item_id: entry.itemId,
    link_method: entry.linkMethod || "created",
    confidence: 1,
    signals: {},
    attached_at: firstSeen,
    attached_by: entry.attachedBy || "system",
    detached_at: null,
    detached_by: null,
    detach_reason: null,
    source_items: {
      id: entry.itemId,
      source_id: entry.source.id,
      headline: entry.headline,
      normalized_headline: entry.headline.toLowerCase(),
      description: "",
      author: entry.author ?? null,
      published_at: entry.publishedAt || firstSeen,
      discovered_at: entry.publishedAt || firstSeen,
      processing_status: "processed",
      sources: entry.source,
    },
  })),
});

const cbs = source({ id: "10000000-0000-4000-8000-000000000001", groupKey: "paramount-cbs-owned-stations" });
const pix = source({ id: "10000000-0000-4000-8000-000000000002", groupKey: "mission-nexstar-wpix" });
const nbc = source({ id: "10000000-0000-4000-8000-000000000003", groupKey: "nbcuniversal-local" });

test("migration keeps ingestion lock order and calls evidence-origin SQL with author first", async () => {
  const migration = await readFile(reconciliationMigrationPath, "utf8");
  const sourceItemLock = migration.indexOf("from public.source_items\n  where id = any(expected_target_item_ids || expected_source_item_ids)");
  const storyLock = migration.indexOf("from public.stories\n  where id = any(array[p_target_story_id, p_source_story_id])");
  assert.ok(sourceItemLock >= 0 && storyLock > sourceItemLock, "SourceItems must be locked before Stories");
  assert.match(migration, /reath_evidence_origin_key\(\s*item\.author, assessment\.corroboration_group_key\s*\)/);
  assert.match(migration, /Story reconciliation refresh pending: run/);
  assert.match(migration, /complete_story_reconciliation_refresh/);
  assert.match(migration, /story_reconciliation_runs_terminal_only/);
  assert.match(migration, /before insert or update or delete on public\.story_reconciliation_attempts/);
  assert.match(migration, /update public\.story_enrichments\s+set is_current = false[\s\S]*?analysis_kind = 'deterministic'/);
  assert.match(migration, /update public\.story_scores\s+set is_current = false[\s\S]*?analysis_kind = 'deterministic'/);
  assert.doesNotMatch(migration, /insert into public\.story_(?:counties|municipalities)/,
    "reconciliation must retain the canonical target geography without taking geography-first locks");
});

test("manual ingestion runs a bounded apply reconciliation after core ingestion", async () => {
  const background = await readFile(ingestionBackgroundPath, "utf8");
  const ingestionCall = background.indexOf("await ingestDueSources(");
  const reconciliationCall = background.indexOf("await runStoryReconciliation(");
  assert.ok(ingestionCall >= 0 && reconciliationCall > ingestionCall);
  assert.match(background, /if \(manual && Date\.now\(\)/);
  assert.match(background, /apply: true/);
  assert.match(background, /scanLimit: 2_000/);
  assert.match(background, /mergeLimit: 50/);
  assert.doesNotMatch(background, /triggerType === "scheduled"|netlify-schedule/);
  assert.match(background, /deadlineAt: coreResult\.deadlineAt/);
});

test("planner converges bounded multi-item evidence with strict fatal-incident anchors", () => {
  const target = makeStory({
    id: "20000000-0000-4000-8000-000000000001",
    firstSeen: "2026-08-25T14:00:00Z",
    links: [{
      itemId: "30000000-0000-4000-8000-000000000001",
      source: cbs,
      headline: "2 children killed in fire in Trenton, New Jersey, officials say",
    }],
  });
  const sourceStory = makeStory({
    id: "20000000-0000-4000-8000-000000000002",
    firstSeen: "2026-08-25T15:00:00Z",
    links: [{
      itemId: "30000000-0000-4000-8000-000000000002",
      source: pix,
      headline: "Two children die after multi-house fire in New Jersey: police",
    }, {
      itemId: "30000000-0000-4000-8000-000000000003",
      source: nbc,
      headline: "Two children killed in devastating Trenton row house fire",
      linkMethod: "deterministic",
    }],
  });

  const [plan] = planStoryReconciliationPairs([target, sourceStory]);
  assert.ok(plan);
  assert.equal(plan.targetStoryId, target.id);
  assert.equal(plan.sourceStoryId, sourceStory.id);
  assert.equal(plan.expectedSourceSourceItemIds.length, 2);
  assert.equal(plan.signals.anchors.length, 2);
  assert.ok(plan.confidence >= 0.70);
  assert.ok(plan.signals.anchors.every((anchor) => anchor.signals.fatalIncidentAlignment === 1));
});

test("planner excludes any human-touched Story but permits its own prior system audit", () => {
  const base = makeStory({
    id: "20000000-0000-4000-8000-000000000003",
    firstSeen: "2026-08-25T14:00:00Z",
    links: [{
      itemId: "30000000-0000-4000-8000-000000000004",
      source: cbs,
      headline: "Sherrill signs reproductive and gender-affirming care protections into law",
    }],
  });
  assert.equal(isUntouchedReconciliationStory(base), true);
  assert.equal(isUntouchedReconciliationStory({ ...base, editorial_queue: [{ ...base.editorial_queue[0], status: "watch" }] }), false);
  assert.equal(isUntouchedReconciliationStory({ ...base, editorial_decisions: [{ action_type: "note", actor_id: "editor-1", actor_role: "editor" }] }), false);
  assert.equal(isUntouchedReconciliationStory({
    ...base,
    editorial_decisions: [{
      action_type: "reconciliation_merge",
      actor_id: "system:story-reconciliation",
      actor_role: "system",
    }],
  }), true);
});

test("planner can continue converging onto a bounded prior reconciliation target", () => {
  const target = makeStory({
    id: "20000000-0000-4000-8000-000000000008",
    firstSeen: "2026-08-25T14:00:00Z",
    evidenceRevision: 7,
    decisions: [{
      action_type: "reconciliation_merge",
      actor_id: "system:story-reconciliation",
      actor_role: "system",
    }],
    links: [{
      itemId: "30000000-0000-4000-8000-000000000009",
      source: cbs,
      headline: "2 children killed in fire in Trenton, New Jersey, officials say",
    }, {
      itemId: "30000000-0000-4000-8000-000000000010",
      source: pix,
      headline: "Two children die after multi-house fire in New Jersey: police",
      linkMethod: "reconciliation",
      attachedBy: "system:story-reconciliation",
    }],
  });
  const remaining = makeStory({
    id: "20000000-0000-4000-8000-000000000009",
    firstSeen: "2026-08-25T16:00:00Z",
    links: [{
      itemId: "30000000-0000-4000-8000-000000000011",
      source: nbc,
      headline: "Two children killed in devastating Trenton row house fire",
    }],
  });
  const [plan] = planStoryReconciliationPairs([target, remaining]);
  assert.equal(plan?.targetStoryId, target.id);
  assert.equal(plan?.expectedTargetSourceItemIds.length, 2);
});

test("runner refreshes deterministic analysis after every applied merge", async () => {
  const target = makeStory({
    id: "20000000-0000-4000-8000-000000000004",
    firstSeen: "2026-08-25T14:00:00Z",
    links: [{
      itemId: "30000000-0000-4000-8000-000000000005",
      source: cbs,
      headline: "2 children killed in fire in Trenton, New Jersey, officials say",
    }],
  });
  const sourceStory = makeStory({
    id: "20000000-0000-4000-8000-000000000005",
    firstSeen: "2026-08-25T15:00:00Z",
    links: [{
      itemId: "30000000-0000-4000-8000-000000000006",
      source: pix,
      headline: "Two children die after multi-house fire in New Jersey: police",
    }],
  });
  const rpcCalls = [];
  const supabase = {
    rpc(name) {
      rpcCalls.push(name);
      if (name === "start_story_reconciliation_run") return Promise.resolve({ data: { id: "40000000-0000-4000-8000-000000000001" }, error: null });
      if (name === "reconcile_story_pair") return Promise.resolve({ data: { outcome: "applied", target_evidence_revision_after: 7, recovery_source_item_id: sourceStory.story_sources[0].source_item_id }, error: null });
      if (name === "complete_story_reconciliation_refresh") return Promise.resolve({ data: true, error: null });
      return Promise.resolve({ data: { status: "succeeded" }, error: null });
    },
  };
  let loads = 0;
  const loadStories = async () => (++loads === 1 ? [target, sourceStory] : []);
  const refreshed = [];
  const result = await runStoryReconciliation({
    supabase,
    config: { aiEnabled: false },
    apply: true,
    triggeredBy: "test:editor",
    mergeLimit: 1,
    loadStories,
    refreshAnalysis: async (_client, storyId, _geography, refreshConfig) => refreshed.push({ storyId, aiEnabled: refreshConfig.aiEnabled }),
  });
  assert.equal(result.applied, 1);
  assert.deepEqual(refreshed, [{ storyId: target.id, aiEnabled: false }]);
  assert.deepEqual(rpcCalls, ["start_story_reconciliation_run", "reconcile_story_pair", "complete_story_reconciliation_refresh", "finish_story_reconciliation_run"]);
});

test("runner queues ingestion recovery if the post-merge analysis refresh fails", async () => {
  const target = makeStory({
    id: "20000000-0000-4000-8000-000000000006",
    firstSeen: "2026-08-25T14:00:00Z",
    links: [{
      itemId: "30000000-0000-4000-8000-000000000007",
      source: cbs,
      headline: "2 children killed in fire in Trenton, New Jersey, officials say",
    }],
  });
  const sourceStory = makeStory({
    id: "20000000-0000-4000-8000-000000000007",
    firstSeen: "2026-08-25T15:00:00Z",
    links: [{
      itemId: "30000000-0000-4000-8000-000000000008",
      source: pix,
      headline: "Two children die after multi-house fire in New Jersey: police",
    }],
  });
  const rpcCalls = [];
  const supabase = {
    rpc(name) {
      rpcCalls.push(name);
      if (name === "start_story_reconciliation_run") return Promise.resolve({ data: { id: "40000000-0000-4000-8000-000000000002" }, error: null });
      if (name === "reconcile_story_pair") return Promise.resolve({ data: { outcome: "applied", target_evidence_revision_after: 7, recovery_source_item_id: sourceStory.story_sources[0].source_item_id }, error: null });
      return Promise.resolve({ data: { status: "partial" }, error: null });
    },
  };
  let loads = 0;
  const result = await runStoryReconciliation({
    supabase,
    apply: true,
    triggeredBy: "test:editor",
    mergeLimit: 1,
    loadStories: async () => (++loads === 1 ? [target, sourceStory] : []),
    refreshAnalysis: async () => { throw new Error("synthetic refresh failure"); },
  });
  assert.equal(result.applied, 1);
  assert.equal(result.errors.length, 1);
  assert.deepEqual(rpcCalls, ["start_story_reconciliation_run", "reconcile_story_pair", "finish_story_reconciliation_run"]);
});

test("runner terminalizes its audit row when the initial candidate load fails", async () => {
  const rpcCalls = [];
  const supabase = {
    rpc(name, parameters) {
      rpcCalls.push({ name, parameters });
      if (name === "start_story_reconciliation_run") {
        return Promise.resolve({ data: { id: "40000000-0000-4000-8000-000000000003" }, error: null });
      }
      return Promise.resolve({ data: { status: parameters.p_status }, error: null });
    },
  };
  await assert.rejects(
    runStoryReconciliation({
      supabase,
      apply: true,
      triggeredBy: "test:load-failure",
      loadStories: async () => { throw new Error("synthetic load failure"); },
    }),
    /synthetic load failure/,
  );
  assert.deepEqual(rpcCalls.map(({ name }) => name), ["start_story_reconciliation_run", "finish_story_reconciliation_run"]);
  assert.equal(rpcCalls[1].parameters.p_status, "failed");
  assert.equal(rpcCalls[1].parameters.p_errors, 1);
});

test("database RPC preserves provenance, distinguishes null-author providers, and collapses AP syndication", async () => {
  const database = new PGlite({ extensions: { pgcrypto } });
  try {
    await database.waitReady;
    await database.exec(`
      create schema if not exists extensions;
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin;
    `);
    for (const migrationName of migrationNames) {
      await database.exec(await readFile(path.resolve(directory, `../supabase/migrations/${migrationName}`), "utf8"));
    }

    const insertPair = async ({ suffix, author }) => {
      const rows = (await database.query(`
        with selected_sources as (
          select name, id from public.sources
          where name in ('CBS News Philadelphia - New Jersey', 'PIX11 New Jersey')
        ), inserted_stories as (
          insert into public.stories (canonical_title, first_seen_at, last_activity_at, scope, confidence)
          select 'Shared Story ${suffix}', moment, moment, 'state', 0.6
          from (values
            ('CBS News Philadelphia - New Jersey', '2026-08-25T14:00:00Z'::timestamptz),
            ('PIX11 New Jersey', '2026-08-25T15:00:00Z'::timestamptz)
          ) as seed(name, moment)
          returning id, first_seen_at
        ), numbered_stories as (
          select id, row_number() over (order by first_seen_at, id) as position
          from inserted_stories
        ), inserted_items as (
          insert into public.source_items (
            source_id, url, canonical_url, headline, normalized_headline, author,
            published_at, publisher, content_hash, processing_status
          )
          select source.id,
                 'https://reconcile.example/${suffix}/' || row_number() over (order by source.name),
                 'https://reconcile.example/${suffix}/' || row_number() over (order by source.name),
                 'Shared Story ${suffix}', lower('Shared Story ${suffix}'), $1,
                 case when source.name like 'CBS%' then '2026-08-25T14:00:00Z'::timestamptz else '2026-08-25T15:00:00Z'::timestamptz end,
                 source.name, repeat(md5(source.name || '${suffix}'), 2), 'processed'
          from selected_sources as source
          returning id, source_id
        ), numbered_items as (
          select item.id, row_number() over (order by case when source.name like 'CBS%' then 1 else 2 end) as position
          from inserted_items as item join public.sources as source on source.id = item.source_id
        ), links as (
          insert into public.story_sources (story_id, source_item_id, link_method, confidence, signals, attached_by)
          select story.id, item.id, 'created', 1, '{}'::jsonb, 'system'
          from numbered_stories as story join numbered_items as item using (position)
        ), queues as (
          insert into public.editorial_queue (story_id)
          select id from numbered_stories
        )
        select (array_agg(id order by position))[1] as target_id,
               (array_agg(id order by position))[2] as source_id
        from numbered_stories
      `, [author])).rows[0];
      const evidence = (await database.query(`
        select stories.id, stories.evidence_revision,
               array_agg(links.source_item_id order by links.source_item_id) as item_ids
        from public.stories as stories
        join public.story_sources as links on links.story_id = stories.id and links.detached_at is null
        where stories.id = any(array[$1::uuid, $2::uuid])
        group by stories.id, stories.evidence_revision
      `, [rows.target_id, rows.source_id])).rows;
      return {
        ...rows,
        target: evidence.find((row) => row.id === rows.target_id),
        source: evidence.find((row) => row.id === rows.source_id),
      };
    };

    const reconcile = async (pair, runId) => (await database.query(`
      select public.reconcile_story_pair(
        $1::uuid, $2::uuid, $3::uuid, $4::bigint, $5::bigint,
        $6::uuid[], $7::uuid[], 0.900, null,
        jsonb_build_object(
          'algorithmVersion', '${STORY_RECONCILIATION_ALGORITHM_VERSION}',
          'anchors', jsonb_build_array(jsonb_build_object(
            'sourceItemId', ($7::uuid[])[1],
            'matchedSourceItemId', ($6::uuid[])[1],
            'score', 0.900,
            'signals', jsonb_build_object('headline', 1)
          ))
        )
      ) as result
    `, [runId, pair.target_id, pair.source_id, pair.target.evidence_revision, pair.source.evidence_revision, pair.target.item_ids, pair.source.item_ids])).rows[0].result;

    const startRun = async (mode = "apply") => (await database.query(`
      select public.start_story_reconciliation_run(
        $1::text, '${STORY_RECONCILIATION_ALGORITHM_VERSION}', 1000, 5, 12, 0.700, 0.100, 'test:reconciliation'
      ) as run
    `, [mode])).rows[0].run.id;

    const recordAttempt = async ({ pair, runId, outcome }) => database.query(`
      select public.record_story_reconciliation_attempt(
        $1::uuid, $2::uuid, $3::uuid, $4::bigint, $5::bigint,
        $6::uuid[], $7::uuid[], 0.900, null, '{}'::jsonb, $8::text, 'audit-guard-test'
      )
    `, [runId, pair.target_id, pair.source_id, pair.target.evidence_revision,
      pair.source.evidence_revision, pair.target.item_ids, pair.source.item_ids, outcome]);

    const distinctProviders = await insertPair({ suffix: "null-author", author: null });
    await database.query(`
      insert into public.story_enrichments (
        story_id, nj_relevance, scope, public_impact, civic_utility, novelty,
        human_interest, reath_potential, satire_potential, confidence,
        provider, model, model_version, schema_version, raw_output
      ) values (
        $1::uuid, 80, 'state', 60, 60, 50, 50, 60, 20, 0.8,
        'deterministic', 'rules', 'test-v1', 'test-v1', '{}'::jsonb
      )
    `, [distinctProviders.target_id]);
    await database.query(`
      insert into public.story_scores (
        story_id, local_impact, civic_utility, significance, momentum, novelty,
        human_interest, emotional_resonance, reath_potential, satire_potential,
        locality, confidence, provider, model_version
      ) values (
        $1::uuid, 60, 60, 60, 40, 50, 50, 50, 60, 20, 80, 80,
        'deterministic', 'test-v1'
      )
    `, [distinctProviders.target_id]);
    distinctProviders.target.evidence_revision = (await database.query(`
      select evidence_revision from public.stories where id = $1::uuid
    `, [distinctProviders.target_id])).rows[0].evidence_revision;

    const appliedRunId = await startRun();
    const applied = await reconcile(distinctProviders, appliedRunId);
    assert.equal(applied.outcome, "applied", "null authors at distinct providers must not collapse to one blank origin");
    assert.equal((await database.query(`
      select count(*)::integer as count from public.story_sources
      where story_id = $1::uuid and detached_at is null
    `, [distinctProviders.target_id])).rows[0].count, 2);
    assert.equal((await database.query(`
      select count(*)::integer as count from public.story_sources
      where story_id = $1::uuid and detached_at is not null
        and detached_by = 'system:story-reconciliation'
    `, [distinctProviders.source_id])).rows[0].count, 1);
    assert.equal((await database.query(`
      select count(*)::integer as count from public.editorial_decisions
      where story_id = any(array[$1::uuid, $2::uuid]) and action_type = 'reconciliation_merge'
    `, [distinctProviders.target_id, distinctProviders.source_id])).rows[0].count, 2);
    const durableRecovery = (await database.query(`
      select processing_status, processing_error
      from public.source_items where id = $1::uuid
    `, [distinctProviders.source.item_ids[0]])).rows[0];
    assert.equal(durableRecovery.processing_status, "error");
    assert.match(durableRecovery.processing_error, /Story reconciliation refresh pending/);
    assert.equal((await database.query(`
      select public.complete_story_reconciliation_refresh($1::uuid, $2::uuid, $3::uuid) as completed
    `, [applied.run_id, distinctProviders.target_id, distinctProviders.source.item_ids[0]])).rows[0].completed, false,
    "the marker must not clear before fresh deterministic projections exist");
    assert.equal((await database.query(`
      select count(*)::integer as count
      from public.story_enrichments
      where story_id = $1::uuid and analysis_kind = 'deterministic' and is_current
    `, [distinctProviders.target_id])).rows[0].count, 0,
    "the merge transaction must invalidate its stale deterministic enrichment");
    assert.equal((await database.query(`
      select count(*)::integer as count
      from public.story_scores
      where story_id = $1::uuid and analysis_kind = 'deterministic' and is_current
    `, [distinctProviders.target_id])).rows[0].count, 0,
    "the merge transaction must invalidate its stale deterministic score");

    await assert.rejects(
      database.query(`update public.story_reconciliation_runs set algorithm_version = 'tampered' where id = $1::uuid`, [appliedRunId]),
      /transition exactly once|configuration is immutable/,
    );
    await assert.rejects(
      database.query(`update public.story_reconciliation_attempts set reason = 'tampered' where id = $1::uuid`, [applied.id]),
      /append-only/,
    );
    await database.query(`
      select public.finish_story_reconciliation_run($1::uuid, 'succeeded', 1, 1, 0, 0, null::text)
    `, [appliedRunId]);
    await assert.rejects(
      recordAttempt({ pair: distinctProviders, runId: appliedRunId, outcome: "applied" }),
      /running parent run/,
    );
    await assert.rejects(
      recordAttempt({ pair: distinctProviders, runId: await startRun("dry_run"), outcome: "applied" }),
      /incompatible with its run mode/,
    );

    const syndicated = await insertPair({ suffix: "ap-author", author: "Associated Press" });
    const skipped = await reconcile(syndicated, await startRun());
    assert.equal(skipped.outcome, "skipped");
    assert.equal(skipped.reason, "nonqualifying_or_shared_origin");

    const humanTouched = await insertPair({ suffix: "human-touch", author: null });
    await database.query(`
      update public.editorial_queue set status = 'watch', decided_by = 'editor-1', decided_at = now()
      where story_id = $1::uuid
    `, [humanTouched.source_id]);
    const humanSkipped = await reconcile(humanTouched, await startRun());
    assert.equal(humanSkipped.outcome, "skipped");
    assert.equal(humanSkipped.reason, "human_or_ai_touched");
    assert.equal((await database.query(`
      select status from public.stories where id = $1::uuid
    `, [humanTouched.source_id])).rows[0].status, "developing");
  } finally {
    await database.close();
  }
});
