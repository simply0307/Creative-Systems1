begin;

-- Historical reconciliation is deliberately distinct from an editor merge.
-- It is a bounded, deterministic repair path for false-separated Stories and
-- may never erase the original Story/source relationship.
alter table public.story_sources
  drop constraint story_sources_link_method_check;
alter table public.story_sources
  add constraint story_sources_link_method_check
  check (link_method in (
    'created','deterministic','semantic','reconciliation','editor_merge','editor_attach'
  ));

alter table public.editorial_decisions
  drop constraint editorial_decisions_action_type_check;
alter table public.editorial_decisions
  add constraint editorial_decisions_action_type_check
  check (action_type in (
    'status_change','route','merge','detach','attach','note','ai_refresh',
    'deep_analysis','reconciliation_merge'
  ));

create table public.story_reconciliation_runs (
  id uuid primary key default gen_random_uuid(),
  mode text not null check (mode in ('dry_run','apply')),
  algorithm_version text not null check (nullif(btrim(algorithm_version), '') is not null),
  scan_limit integer not null check (scan_limit between 2 and 2000),
  merge_limit integer not null check (merge_limit between 1 and 50),
  max_items_per_story integer not null check (max_items_per_story between 2 and 20),
  minimum_confidence numeric(4,3) not null check (minimum_confidence between 0.700 and 1),
  ambiguity_margin numeric(4,3) not null check (ambiguity_margin between 0.080 and 0.500),
  triggered_by text not null check (nullif(btrim(triggered_by), '') is not null),
  status text not null default 'running' check (status in ('running','succeeded','partial','failed')),
  candidates_evaluated integer not null default 0 check (candidates_evaluated >= 0),
  merges_applied integer not null default 0 check (merges_applied >= 0),
  pairs_skipped integer not null default 0 check (pairs_skipped >= 0),
  errors integer not null default 0 check (errors >= 0),
  error_summary text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  check ((status = 'running') = (completed_at is null))
);

create table public.story_reconciliation_attempts (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.story_reconciliation_runs(id) on delete restrict,
  target_story_id uuid not null references public.stories(id) on delete restrict,
  source_story_id uuid not null references public.stories(id) on delete restrict,
  expected_target_evidence_revision bigint not null check (expected_target_evidence_revision > 0),
  expected_source_evidence_revision bigint not null check (expected_source_evidence_revision > 0),
  target_source_item_ids uuid[] not null check (cardinality(target_source_item_ids) between 1 and 20),
  source_source_item_ids uuid[] not null check (cardinality(source_source_item_ids) between 1 and 20),
  confidence numeric(4,3) not null check (confidence between 0 and 1),
  runner_up_confidence numeric(4,3) check (runner_up_confidence is null or runner_up_confidence between 0 and 1),
  signals jsonb not null check (jsonb_typeof(signals) = 'object'),
  outcome text not null check (outcome in ('eligible_dry_run','applied','skipped')),
  reason text not null check (nullif(btrim(reason), '') is not null),
  created_at timestamptz not null default now(),
  check (target_story_id <> source_story_id)
);

create index story_reconciliation_runs_started_idx
  on public.story_reconciliation_runs(started_at desc);
create index story_reconciliation_attempts_run_idx
  on public.story_reconciliation_attempts(run_id, created_at, id);
create index story_reconciliation_attempts_target_idx
  on public.story_reconciliation_attempts(target_story_id, created_at desc);
create index story_reconciliation_attempts_source_idx
  on public.story_reconciliation_attempts(source_story_id, created_at desc);

create function public.guard_story_reconciliation_run_history()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Story reconciliation runs cannot be deleted';
  end if;
  if old.status <> 'running'
     or new.status not in ('succeeded','partial','failed')
     or new.completed_at is null then
    raise exception 'A Story reconciliation run may transition exactly once from running to terminal';
  end if;
  if new.id is distinct from old.id
     or new.mode is distinct from old.mode
     or new.algorithm_version is distinct from old.algorithm_version
     or new.scan_limit is distinct from old.scan_limit
     or new.merge_limit is distinct from old.merge_limit
     or new.max_items_per_story is distinct from old.max_items_per_story
     or new.minimum_confidence is distinct from old.minimum_confidence
     or new.ambiguity_margin is distinct from old.ambiguity_margin
     or new.triggered_by is distinct from old.triggered_by
     or new.started_at is distinct from old.started_at then
    raise exception 'Story reconciliation run configuration is immutable';
  end if;
  return new;
end;
$$;

create trigger story_reconciliation_runs_terminal_only
before update or delete on public.story_reconciliation_runs
for each row execute function public.guard_story_reconciliation_run_history();

create function public.guard_story_reconciliation_attempt_history()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  run_row public.story_reconciliation_runs;
begin
  if tg_op = 'INSERT' then
    select * into run_row
    from public.story_reconciliation_runs
    where id = new.run_id
    for share;
    if run_row.id is null or run_row.status <> 'running' then
      raise exception 'Story reconciliation attempts require a running parent run';
    end if;
    if (run_row.mode = 'dry_run' and new.outcome not in ('eligible_dry_run','skipped'))
       or (run_row.mode = 'apply' and new.outcome not in ('applied','skipped')) then
      raise exception 'Story reconciliation attempt outcome is incompatible with its run mode';
    end if;
    return new;
  end if;
  raise exception 'Story reconciliation attempts are append-only';
end;
$$;

create trigger story_reconciliation_attempts_append_only
before insert or update or delete on public.story_reconciliation_attempts
for each row execute function public.guard_story_reconciliation_attempt_history();

create function public.start_story_reconciliation_run(
  p_mode text,
  p_algorithm_version text,
  p_scan_limit integer,
  p_merge_limit integer,
  p_max_items_per_story integer,
  p_minimum_confidence numeric,
  p_ambiguity_margin numeric,
  p_triggered_by text
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  started public.story_reconciliation_runs;
begin
  if p_mode not in ('dry_run','apply')
     or nullif(btrim(coalesce(p_algorithm_version, '')), '') is null
     or p_scan_limit not between 2 and 2000
     or p_merge_limit not between 1 and 50
     or p_max_items_per_story not between 2 and 20
     or p_minimum_confidence not between 0.700 and 1
     or p_ambiguity_margin not between 0.080 and 0.500
     or nullif(btrim(coalesce(p_triggered_by, '')), '') is null then
    raise exception 'Invalid Story reconciliation run configuration' using errcode = '22023';
  end if;

  insert into public.story_reconciliation_runs (
    mode, algorithm_version, scan_limit, merge_limit, max_items_per_story,
    minimum_confidence, ambiguity_margin, triggered_by
  ) values (
    p_mode, btrim(p_algorithm_version), p_scan_limit, p_merge_limit,
    p_max_items_per_story, p_minimum_confidence, p_ambiguity_margin,
    btrim(p_triggered_by)
  ) returning * into started;

  return to_jsonb(started);
end;
$$;

create function public.finish_story_reconciliation_run(
  p_run_id uuid,
  p_status text,
  p_candidates_evaluated integer,
  p_merges_applied integer,
  p_pairs_skipped integer,
  p_errors integer,
  p_error_summary text
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  finished public.story_reconciliation_runs;
begin
  if p_status not in ('succeeded','partial','failed')
     or least(p_candidates_evaluated, p_merges_applied, p_pairs_skipped, p_errors) < 0 then
    raise exception 'Invalid Story reconciliation completion' using errcode = '22023';
  end if;

  update public.story_reconciliation_runs
  set status = p_status,
      candidates_evaluated = p_candidates_evaluated,
      merges_applied = p_merges_applied,
      pairs_skipped = p_pairs_skipped,
      errors = p_errors,
      error_summary = nullif(left(coalesce(p_error_summary, ''), 5000), ''),
      completed_at = now()
  where id = p_run_id and status = 'running'
  returning * into finished;

  return case when finished.id is null then null else to_jsonb(finished) end;
end;
$$;

create function public.record_story_reconciliation_attempt(
  p_run_id uuid,
  p_target_story_id uuid,
  p_source_story_id uuid,
  p_expected_target_evidence_revision bigint,
  p_expected_source_evidence_revision bigint,
  p_target_source_item_ids uuid[],
  p_source_source_item_ids uuid[],
  p_confidence numeric,
  p_runner_up_confidence numeric,
  p_signals jsonb,
  p_outcome text,
  p_reason text
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  recorded public.story_reconciliation_attempts;
begin
  insert into public.story_reconciliation_attempts (
    run_id, target_story_id, source_story_id,
    expected_target_evidence_revision, expected_source_evidence_revision,
    target_source_item_ids, source_source_item_ids, confidence,
    runner_up_confidence, signals, outcome, reason
  ) values (
    p_run_id, p_target_story_id, p_source_story_id,
    p_expected_target_evidence_revision, p_expected_source_evidence_revision,
    p_target_source_item_ids, p_source_source_item_ids, p_confidence,
    p_runner_up_confidence, coalesce(p_signals, '{}'::jsonb), p_outcome,
    p_reason
  ) returning * into recorded;
  return to_jsonb(recorded);
end;
$$;

create function public.reconcile_story_pair(
  p_run_id uuid,
  p_target_story_id uuid,
  p_source_story_id uuid,
  p_expected_target_evidence_revision bigint,
  p_expected_source_evidence_revision bigint,
  p_expected_target_source_item_ids uuid[],
  p_expected_source_source_item_ids uuid[],
  p_confidence numeric,
  p_runner_up_confidence numeric,
  p_signals jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  run_row public.story_reconciliation_runs;
  target_story public.stories;
  source_story public.stories;
  target_queue public.editorial_queue;
  source_queue public.editorial_queue;
  current_target_item_ids uuid[];
  current_source_item_ids uuid[];
  expected_target_item_ids uuid[];
  expected_source_item_ids uuid[];
  target_origins text[];
  source_origins text[];
  target_qualifying_count integer;
  source_qualifying_count integer;
  valid_anchor_count integer;
  minimum_anchor_confidence numeric;
  applied_count integer;
  moved_count integer;
  refreshed_target_revision bigint;
  recovery_source_item_id uuid;
  recovery_message text;
  audit_signals jsonb;
  attempt jsonb;
begin
  if p_target_story_id is null or p_source_story_id is null
     or p_target_story_id = p_source_story_id
     or p_expected_target_evidence_revision < 1
     or p_expected_source_evidence_revision < 1
     or jsonb_typeof(coalesce(p_signals, '{}'::jsonb)) <> 'object' then
    raise exception 'Invalid Story reconciliation pair' using errcode = '22023';
  end if;

  select * into run_row
  from public.story_reconciliation_runs
  where id = p_run_id
  for update;
  if run_row.id is null or run_row.status <> 'running' then
    raise exception 'Story reconciliation run is unavailable' using errcode = 'PT412';
  end if;

  select coalesce(array_agg(item_id order by item_id), '{}'::uuid[])
  into expected_target_item_ids
  from unnest(coalesce(p_expected_target_source_item_ids, '{}'::uuid[])) as item_id;
  select coalesce(array_agg(item_id order by item_id), '{}'::uuid[])
  into expected_source_item_ids
  from unnest(coalesce(p_expected_source_source_item_ids, '{}'::uuid[])) as item_id;

  if cardinality(expected_target_item_ids) < 1
     or cardinality(expected_source_item_ids) < 1
     or cardinality(expected_target_item_ids) + cardinality(expected_source_item_ids) > run_row.max_items_per_story then
    raise exception 'Invalid Story reconciliation evidence bound' using errcode = '22023';
  end if;

  -- Ingestion claims a SourceItem before it ever updates a Story. Preserve the
  -- same global lock order here (SourceItem -> Source -> Story) so recovery and
  -- reconciliation cannot wait on one another in opposite directions.
  perform 1
  from public.source_items
  where id = any(expected_target_item_ids || expected_source_item_ids)
  order by id
  for update;
  perform 1
  from public.sources
  where id in (
    select source_id from public.source_items
    where id = any(expected_target_item_ids || expected_source_item_ids)
  )
  order by id
  for share;
  perform 1
  from public.source_assessments
  where superseded_at is null
    and source_id in (
      select source_id from public.source_items
      where id = any(expected_target_item_ids || expected_source_item_ids)
    )
  order by source_id
  for share;

  perform 1
  from public.stories
  where id = any(array[p_target_story_id, p_source_story_id])
  order by id
  for update;
  select * into target_story from public.stories where id = p_target_story_id;
  select * into source_story from public.stories where id = p_source_story_id;
  if target_story.id is null or source_story.id is null then
    raise exception 'Story reconciliation pair not found' using errcode = 'P0002';
  end if;

  perform 1
  from public.editorial_queue
  where story_id = any(array[p_target_story_id, p_source_story_id])
  order by story_id
  for update;
  select * into target_queue from public.editorial_queue where story_id = p_target_story_id;
  select * into source_queue from public.editorial_queue where story_id = p_source_story_id;

  perform 1
  from public.story_sources
  where story_id = any(array[p_target_story_id, p_source_story_id])
  order by story_id, source_item_id
  for update;

  select coalesce(array_agg(source_item_id order by source_item_id), '{}'::uuid[])
  into current_target_item_ids
  from public.story_sources
  where story_id = p_target_story_id and detached_at is null;
  select coalesce(array_agg(source_item_id order by source_item_id), '{}'::uuid[])
  into current_source_item_ids
  from public.story_sources
  where story_id = p_source_story_id and detached_at is null;

  if target_story.status <> 'developing' or source_story.status <> 'developing'
     or target_story.merged_into_story_id is not null or source_story.merged_into_story_id is not null then
    return public.record_story_reconciliation_attempt(
      p_run_id, p_target_story_id, p_source_story_id,
      p_expected_target_evidence_revision, p_expected_source_evidence_revision,
      expected_target_item_ids, expected_source_item_ids, p_confidence,
      p_runner_up_confidence, p_signals, 'skipped', 'story_unavailable'
    );
  end if;

  if target_story.evidence_revision <> p_expected_target_evidence_revision
     or source_story.evidence_revision <> p_expected_source_evidence_revision
     or current_target_item_ids <> expected_target_item_ids
     or current_source_item_ids <> expected_source_item_ids then
    return public.record_story_reconciliation_attempt(
      p_run_id, p_target_story_id, p_source_story_id,
      p_expected_target_evidence_revision, p_expected_source_evidence_revision,
      expected_target_item_ids, expected_source_item_ids, p_confidence,
      p_runner_up_confidence, p_signals, 'skipped', 'stale_evidence'
    );
  end if;

  if cardinality(current_target_item_ids) < 1 or cardinality(current_source_item_ids) < 1
     or cardinality(current_target_item_ids) + cardinality(current_source_item_ids) > run_row.max_items_per_story
     or exists (
       select 1 from public.story_sources
       where story_id = any(array[p_target_story_id, p_source_story_id])
         and detached_at is not null
     )
     or exists (
       select 1 from public.story_sources
       where story_id = any(array[p_target_story_id, p_source_story_id])
         and detached_at is null
         and (
           link_method not in ('created','deterministic','semantic','reconciliation')
           or attached_by not in ('system','system:story-reconciliation')
         )
     ) then
    return public.record_story_reconciliation_attempt(
      p_run_id, p_target_story_id, p_source_story_id,
      p_expected_target_evidence_revision, p_expected_source_evidence_revision,
      expected_target_item_ids, expected_source_item_ids, p_confidence,
      p_runner_up_confidence, p_signals, 'skipped', 'evidence_history_or_bound'
    );
  end if;

  if target_queue.story_id is null or source_queue.story_id is null
     or target_queue.status <> 'new' or source_queue.status <> 'new'
     or target_queue.route is not null or source_queue.route is not null
     or nullif(btrim(target_queue.notes), '') is not null
     or nullif(btrim(source_queue.notes), '') is not null
     or num_nonnulls(target_queue.decided_by, target_queue.decided_at, target_queue.routed_by, target_queue.routed_at) <> 0
     or num_nonnulls(source_queue.decided_by, source_queue.decided_at, source_queue.routed_by, source_queue.routed_at) <> 0
     or exists (
       select 1 from public.editorial_decisions
       where story_id = any(array[p_target_story_id, p_source_story_id])
         and not (
           action_type = 'reconciliation_merge'
           and actor_id = 'system:story-reconciliation'
           and actor_role = 'system'
         )
     )
     or exists (select 1 from public.story_ai_state where story_id = any(array[p_target_story_id, p_source_story_id]))
     or exists (select 1 from public.ai_call_attempts where story_id = any(array[p_target_story_id, p_source_story_id]))
     or exists (select 1 from public.story_analyses where story_id = any(array[p_target_story_id, p_source_story_id])) then
    return public.record_story_reconciliation_attempt(
      p_run_id, p_target_story_id, p_source_story_id,
      p_expected_target_evidence_revision, p_expected_source_evidence_revision,
      expected_target_item_ids, expected_source_item_ids, p_confidence,
      p_runner_up_confidence, p_signals, 'skipped', 'human_or_ai_touched'
    );
  end if;

  -- The oldest untouched Story is the stable canonical target. This makes a
  -- repeated pass deterministic and prevents cycles.
  if target_story.first_seen_at > source_story.first_seen_at
     or (target_story.first_seen_at = source_story.first_seen_at and target_story.id > source_story.id) then
    return public.record_story_reconciliation_attempt(
      p_run_id, p_target_story_id, p_source_story_id,
      p_expected_target_evidence_revision, p_expected_source_evidence_revision,
      expected_target_item_ids, expected_source_item_ids, p_confidence,
      p_runner_up_confidence, p_signals, 'skipped', 'noncanonical_target'
    );
  end if;

  if p_confidence < run_row.minimum_confidence or p_confidence > 1
     or (p_runner_up_confidence is not null and (
       p_runner_up_confidence < 0
       or p_runner_up_confidence > p_confidence
       or p_confidence - p_runner_up_confidence < run_row.ambiguity_margin
     ))
     or coalesce(p_signals->>'algorithmVersion', '') <> run_row.algorithm_version
     or jsonb_typeof(p_signals->'anchors') <> 'array'
     or jsonb_array_length(p_signals->'anchors') <> cardinality(current_source_item_ids) then
    return public.record_story_reconciliation_attempt(
      p_run_id, p_target_story_id, p_source_story_id,
      p_expected_target_evidence_revision, p_expected_source_evidence_revision,
      expected_target_item_ids, expected_source_item_ids, greatest(0, least(1, coalesce(p_confidence, 0))),
      p_runner_up_confidence, p_signals, 'skipped', 'confidence_or_anchor_guard'
    );
  end if;

  select count(*)::integer,
         coalesce(array_agg(distinct public.reath_evidence_origin_key(
           item.author, assessment.corroboration_group_key
         ) order by public.reath_evidence_origin_key(
           item.author, assessment.corroboration_group_key
         )), '{}'::text[])
  into target_qualifying_count, target_origins
  from public.source_items as item
  join public.sources as source on source.id = item.source_id and source.active
  join public.source_assessments as assessment
    on assessment.source_id = source.id
   and assessment.superseded_at is null
   and assessment.assessment_status = 'reviewed'
   and assessment.evidence_role = 'independent_journalism'
   and assessment.verification_tier >= 2
  where item.id = any(current_target_item_ids)
    and item.processing_status = 'processed';

  select count(*)::integer,
         coalesce(array_agg(distinct public.reath_evidence_origin_key(
           item.author, assessment.corroboration_group_key
         ) order by public.reath_evidence_origin_key(
           item.author, assessment.corroboration_group_key
         )), '{}'::text[])
  into source_qualifying_count, source_origins
  from public.source_items as item
  join public.sources as source on source.id = item.source_id and source.active
  join public.source_assessments as assessment
    on assessment.source_id = source.id
   and assessment.superseded_at is null
   and assessment.assessment_status = 'reviewed'
   and assessment.evidence_role = 'independent_journalism'
   and assessment.verification_tier >= 2
  where item.id = any(current_source_item_ids)
    and item.processing_status = 'processed';

  if target_qualifying_count <> cardinality(current_target_item_ids)
     or source_qualifying_count <> cardinality(current_source_item_ids)
     or not exists (
       select 1 from unnest(source_origins) as origin
       where not (origin = any(target_origins))
     ) then
    return public.record_story_reconciliation_attempt(
      p_run_id, p_target_story_id, p_source_story_id,
      p_expected_target_evidence_revision, p_expected_source_evidence_revision,
      expected_target_item_ids, expected_source_item_ids, p_confidence,
      p_runner_up_confidence, p_signals, 'skipped', 'nonqualifying_or_shared_origin'
    );
  end if;

  select count(distinct (anchor->>'sourceItemId'))::integer,
         min((anchor->>'score')::numeric)
  into valid_anchor_count, minimum_anchor_confidence
  from jsonb_array_elements(p_signals->'anchors') as anchor
  join public.source_items as source_item
    on source_item.id = (anchor->>'sourceItemId')::uuid
   and source_item.id = any(current_source_item_ids)
  join public.source_items as target_item
    on target_item.id = (anchor->>'matchedSourceItemId')::uuid
   and target_item.id = any(current_target_item_ids)
  where (anchor->>'score') ~ '^(0(?:\.\d+)?|1(?:\.0+)?)$'
    and (anchor->>'score')::numeric >= run_row.minimum_confidence
    and (
      (anchor->>'score')::numeric >= 0.780
      or anchor->'signals'->>'fatalIncidentAlignment' = '1'
      or anchor->'signals'->>'namedEventAlignment' = '1'
      or (
        anchor->'signals'->>'headline' ~ '^(0(?:\.\d+)?|1(?:\.0+)?)$'
        and (anchor->'signals'->>'headline')::numeric >= 0.800
      )
    )
    and abs(extract(epoch from (
      coalesce(source_item.published_at, source_item.discovered_at)
      - coalesce(target_item.published_at, target_item.discovered_at)
    ))) <= 72 * 60 * 60;

  if valid_anchor_count <> cardinality(current_source_item_ids)
     or minimum_anchor_confidence is null
     or abs(minimum_anchor_confidence - p_confidence) > 0.001 then
    return public.record_story_reconciliation_attempt(
      p_run_id, p_target_story_id, p_source_story_id,
      p_expected_target_evidence_revision, p_expected_source_evidence_revision,
      expected_target_item_ids, expected_source_item_ids, p_confidence,
      p_runner_up_confidence, p_signals, 'skipped', 'invalid_evidence_anchor'
    );
  end if;

  select count(*)::integer into applied_count
  from public.story_reconciliation_attempts
  where run_id = p_run_id and outcome = 'applied';
  if applied_count >= run_row.merge_limit then
    return public.record_story_reconciliation_attempt(
      p_run_id, p_target_story_id, p_source_story_id,
      p_expected_target_evidence_revision, p_expected_source_evidence_revision,
      expected_target_item_ids, expected_source_item_ids, p_confidence,
      p_runner_up_confidence, p_signals, 'skipped', 'run_merge_limit_reached'
    );
  end if;

  audit_signals := coalesce(p_signals, '{}'::jsonb) || jsonb_build_object(
    'algorithmVersion', run_row.algorithm_version,
    'reconciliationRunId', p_run_id,
    'targetStoryId', p_target_story_id,
    'sourceStoryId', p_source_story_id,
    'targetEvidenceRevision', p_expected_target_evidence_revision,
    'sourceEvidenceRevision', p_expected_source_evidence_revision,
    'targetEvidenceOrigins', target_origins,
    'sourceEvidenceOrigins', source_origins,
    'confidence', p_confidence,
    'runnerUpConfidence', p_runner_up_confidence
  );

  if run_row.mode = 'dry_run' then
    return public.record_story_reconciliation_attempt(
      p_run_id, p_target_story_id, p_source_story_id,
      p_expected_target_evidence_revision, p_expected_source_evidence_revision,
      expected_target_item_ids, expected_source_item_ids, p_confidence,
      p_runner_up_confidence, audit_signals, 'eligible_dry_run', 'all_guards_passed'
    );
  end if;

  update public.story_sources
  set detached_at = now(),
      detached_by = 'system:story-reconciliation',
      detach_reason = 'Reconciled into Story ' || p_target_story_id::text
  where story_id = p_source_story_id
    and source_item_id = any(current_source_item_ids)
    and detached_at is null;

  insert into public.story_sources (
    story_id, source_item_id, link_method, confidence, signals, attached_at, attached_by
  )
  select
    p_target_story_id,
    original.source_item_id,
    'reconciliation',
    (anchor.value->>'score')::numeric,
    original.signals || jsonb_build_object(
      'reconciliation', audit_signals,
      'originalStoryId', p_source_story_id,
      'originalLinkMethod', original.link_method,
      'originalLinkConfidence', original.confidence,
      'originalAttachedAt', original.attached_at,
      'originalAttachedBy', original.attached_by,
      'anchor', anchor.value
    ),
    now(),
    'system:story-reconciliation'
  from public.story_sources as original
  join lateral jsonb_array_elements(p_signals->'anchors') as anchor(value)
    on (anchor.value->>'sourceItemId')::uuid = original.source_item_id
  where original.story_id = p_source_story_id
    and original.source_item_id = any(current_source_item_ids);
  get diagnostics moved_count = row_count;
  if moved_count <> cardinality(current_source_item_ids) then
    raise exception 'Story reconciliation evidence move was incomplete' using errcode = 'PT412';
  end if;

  update public.stories
  set first_seen_at = least(first_seen_at, source_story.first_seen_at),
      last_activity_at = greatest(last_activity_at, source_story.last_activity_at)
  where id = p_target_story_id;

  update public.stories
  set status = 'merged', merged_into_story_id = p_target_story_id
  where id = p_source_story_id;

  insert into public.editorial_decisions (
    story_id, actor_id, actor_email, actor_role, action_type,
    from_value, to_value, reason
  ) values
  (
    p_target_story_id, 'system:story-reconciliation', null, 'system',
    'reconciliation_merge',
    jsonb_build_object(
      'target_story_id', p_target_story_id,
      'target_source_item_ids', current_target_item_ids,
      'target_evidence_revision', p_expected_target_evidence_revision
    ),
    jsonb_build_object(
      'source_story_id', p_source_story_id,
      'source_source_item_ids', current_source_item_ids,
      'confidence', p_confidence,
      'signals', audit_signals
    ),
    'Bounded deterministic false-separation reconciliation'
  ),
  (
    p_source_story_id, 'system:story-reconciliation', null, 'system',
    'reconciliation_merge',
    jsonb_build_object(
      'source_story_id', p_source_story_id,
      'source_source_item_ids', current_source_item_ids,
      'source_evidence_revision', p_expected_source_evidence_revision
    ),
    jsonb_build_object(
      'merged_into_story_id', p_target_story_id,
      'confidence', p_confidence,
      'signals', audit_signals
    ),
    'Bounded deterministic false-separation reconciliation'
  );

  -- Never serve a deterministic projection calculated from the pre-merge
  -- evidence set. The durable SourceItem marker below guarantees that a crash
  -- between commit and the JavaScript refresh still reaches normal recovery.
  update public.story_enrichments
  set is_current = false
  where story_id = p_target_story_id
    and analysis_kind = 'deterministic'
    and is_current;
  update public.story_scores
  set is_current = false
  where story_id = p_target_story_id
    and analysis_kind = 'deterministic'
    and is_current;

  -- A durable marker is committed atomically with the evidence move. If the
  -- worker crashes before refreshing deterministic projections, the ordinary
  -- SourceItem backlog recovery path will refresh the complete target Story.
  recovery_source_item_id := current_source_item_ids[1];
  recovery_message := 'Story reconciliation refresh pending: run '
    || p_run_id::text || '; story ' || p_target_story_id::text;
  update public.source_items
  set processing_status = 'error',
      processing_error = recovery_message,
      processing_token = null,
      processing_started_at = null
  where id = recovery_source_item_id;
  if not found then
    raise exception 'Story reconciliation recovery marker was not written' using errcode = 'PT412';
  end if;

  attempt := public.record_story_reconciliation_attempt(
    p_run_id, p_target_story_id, p_source_story_id,
    p_expected_target_evidence_revision, p_expected_source_evidence_revision,
    expected_target_item_ids, expected_source_item_ids, p_confidence,
    p_runner_up_confidence, audit_signals, 'applied', 'all_guards_passed'
  );

  select evidence_revision into refreshed_target_revision
  from public.stories where id = p_target_story_id;

  return attempt || jsonb_build_object(
    'source_links_moved', moved_count,
    'target_evidence_revision_after', refreshed_target_revision,
    'recovery_source_item_id', recovery_source_item_id
  );
end;
$$;

create function public.complete_story_reconciliation_refresh(
  p_run_id uuid,
  p_story_id uuid,
  p_source_item_id uuid
) returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  expected_message text;
  applied_at timestamptz;
  completed boolean := false;
begin
  expected_message := 'Story reconciliation refresh pending: run '
    || p_run_id::text || '; story ' || p_story_id::text;

  -- Match the SourceItem -> Story lock order used by ingestion and the merge
  -- RPC. A concurrently claimed recovery item wins; this completion then
  -- returns false and leaves that worker to finish the durable recovery.
  perform 1 from public.source_items
  where id = p_source_item_id
  for update;
  if not found then return false; end if;

  perform 1 from public.stories
  where id = p_story_id and status <> 'merged'
  for share;
  if not found then return false; end if;

  select max(attempt.created_at) into applied_at
  from public.story_reconciliation_attempts as attempt
  where attempt.run_id = p_run_id
    and attempt.target_story_id = p_story_id
    and attempt.outcome = 'applied'
    and p_source_item_id = any(attempt.source_source_item_ids);
  if applied_at is null then return false; end if;

  if not exists (
    select 1 from public.story_sources
    where story_id = p_story_id
      and source_item_id = p_source_item_id
      and detached_at is null
  )
  or not exists (
    select 1 from public.story_enrichments
    where story_id = p_story_id
      and analysis_kind = 'deterministic'
      and is_current
      and created_at >= applied_at
  )
  or not exists (
    select 1 from public.story_scores
    where story_id = p_story_id
      and analysis_kind = 'deterministic'
      and is_current
      and created_at >= applied_at
  ) then
    return false;
  end if;

  update public.source_items
  set processing_status = 'processed',
      processing_error = null,
      processing_token = null,
      processing_started_at = null
  where id = p_source_item_id
    and processing_status = 'error'
    and processing_error = expected_message;
  completed := found;
  return completed;
end;
$$;

alter table public.story_reconciliation_runs enable row level security;
alter table public.story_reconciliation_attempts enable row level security;

revoke all on table public.story_reconciliation_runs, public.story_reconciliation_attempts
  from public, anon, authenticated, service_role;
grant select, insert, update on table public.story_reconciliation_runs to service_role;
grant select, insert on table public.story_reconciliation_attempts to service_role;

revoke all on function public.guard_story_reconciliation_attempt_history()
  from public, anon, authenticated;
revoke all on function public.guard_story_reconciliation_run_history()
  from public, anon, authenticated;
revoke all on function public.start_story_reconciliation_run(text,text,integer,integer,integer,numeric,numeric,text)
  from public, anon, authenticated;
revoke all on function public.finish_story_reconciliation_run(uuid,text,integer,integer,integer,integer,text)
  from public, anon, authenticated;
revoke all on function public.record_story_reconciliation_attempt(uuid,uuid,uuid,bigint,bigint,uuid[],uuid[],numeric,numeric,jsonb,text,text)
  from public, anon, authenticated;
revoke all on function public.reconcile_story_pair(uuid,uuid,uuid,bigint,bigint,uuid[],uuid[],numeric,numeric,jsonb)
  from public, anon, authenticated;
revoke all on function public.complete_story_reconciliation_refresh(uuid,uuid,uuid)
  from public, anon, authenticated;

grant execute on function public.guard_story_reconciliation_attempt_history() to service_role;
grant execute on function public.guard_story_reconciliation_run_history() to service_role;
grant execute on function public.start_story_reconciliation_run(text,text,integer,integer,integer,numeric,numeric,text) to service_role;
grant execute on function public.finish_story_reconciliation_run(uuid,text,integer,integer,integer,integer,text) to service_role;
grant execute on function public.record_story_reconciliation_attempt(uuid,uuid,uuid,bigint,bigint,uuid[],uuid[],numeric,numeric,jsonb,text,text) to service_role;
grant execute on function public.reconcile_story_pair(uuid,uuid,uuid,bigint,bigint,uuid[],uuid[],numeric,numeric,jsonb) to service_role;
grant execute on function public.complete_story_reconciliation_refresh(uuid,uuid,uuid) to service_role;

comment on table public.story_reconciliation_runs is
  'Bounded dry-run/apply audit for deterministic repair of false-separated, untouched Stories.';
comment on table public.story_reconciliation_attempts is
  'Append-only reconciliation disposition with exact evidence revisions, item IDs, confidence, anchors, and reasons.';
comment on function public.reconcile_story_pair(uuid,uuid,uuid,bigint,bigint,uuid[],uuid[],numeric,numeric,jsonb) is
  'Transactionally rechecks human-authority, evidence, source-review, provenance, confidence, ambiguity, time-window, and run-bound guards before moving Story evidence.';
comment on function public.complete_story_reconciliation_refresh(uuid,uuid,uuid) is
  'Clears a durable reconciliation recovery marker only after current deterministic enrichment and scores were written for the applied target Story.';

commit;
