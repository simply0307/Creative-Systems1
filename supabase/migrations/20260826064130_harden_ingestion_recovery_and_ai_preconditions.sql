begin;

alter table public.source_items
  drop constraint if exists source_items_processing_status_check;
alter table public.source_items
  add constraint source_items_processing_status_check
  check (processing_status in ('pending','processing','processed','error','ignored'));

alter table public.source_items
  add column processing_token uuid,
  add column processing_started_at timestamptz;
alter table public.source_items
  add constraint source_items_processing_lease_check
  check (
    (processing_status = 'processing' and processing_token is not null and processing_started_at is not null)
    or
    (processing_status <> 'processing' and processing_token is null and processing_started_at is null)
  );

alter table public.source_run_results
  drop constraint if exists source_run_results_status_check;
alter table public.source_run_results
  add constraint source_run_results_status_check
  check (status in ('succeeded','partial','failed'));
alter table public.source_run_results
  add column items_deferred integer not null default 0 check (items_deferred >= 0);

-- Preserve abandoned activation attempts as evidence while making the ledger
-- indexable. A genuinely live newest row is retained; all stale or overlapping
-- predecessors are made terminal before the single-flight index is installed.
update public.ingestion_runs
set status = 'failed',
    errors = greatest(errors, 1),
    error_summary = 'Worker exceeded the Netlify background execution window before recording completion',
    completed_at = now(),
    duration_ms = least(2147483647, greatest(0, floor(extract(epoch from (now() - started_at)) * 1000)))::integer
where status = 'running'
  and started_at < now() - interval '16 minutes';

with overlapping as (
  select id, row_number() over (order by started_at desc, id desc) as position
  from public.ingestion_runs
  where status = 'running'
)
update public.ingestion_runs as runs
set status = 'failed',
    errors = greatest(runs.errors, 1),
    error_summary = 'Overlapping activation worker was superseded while single-flight protection was installed',
    completed_at = now(),
    duration_ms = least(2147483647, greatest(0, floor(extract(epoch from (now() - runs.started_at)) * 1000)))::integer
from overlapping
where runs.id = overlapping.id and overlapping.position > 1;

create unique index ingestion_runs_single_running_unique
  on public.ingestion_runs(status)
  where status = 'running';

create or replace function public.start_ingestion_run(
  p_trigger_type text,
  p_triggered_by text default null,
  p_stale_after_seconds integer default 960
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  active public.ingestion_runs;
  started public.ingestion_runs;
begin
  if p_trigger_type not in ('scheduled','manual','acceptance_test') then
    raise exception 'Invalid ingestion trigger type' using errcode = '22023';
  end if;
  if p_stale_after_seconds < 900 or p_stale_after_seconds > 3600 then
    raise exception 'Invalid ingestion stale-run threshold' using errcode = '22023';
  end if;

  lock table public.ingestion_runs in exclusive mode;
  update public.ingestion_runs
  set status = 'failed',
      errors = greatest(errors, 1),
      error_summary = 'Worker exceeded the Netlify background execution window before recording completion',
      completed_at = now(),
      duration_ms = least(2147483647, greatest(0, floor(extract(epoch from (now() - started_at)) * 1000)))::integer
  where status = 'running'
    and started_at < now() - make_interval(secs => p_stale_after_seconds);

  select runs.* into active
  from public.ingestion_runs as runs
  where runs.status = 'running'
  order by runs.started_at desc
  limit 1;
  if active.id is not null then
    return jsonb_build_object('admitted', false, 'run', to_jsonb(active));
  end if;

  insert into public.ingestion_runs (trigger_type, triggered_by)
  values (p_trigger_type, nullif(left(coalesce(p_triggered_by, ''), 300), ''))
  returning * into started;
  return jsonb_build_object('admitted', true, 'run', to_jsonb(started));
end;
$$;

create or replace function public.finish_ingestion_run(
  p_run_id uuid,
  p_status text,
  p_sources_attempted integer,
  p_items_fetched integer,
  p_items_inserted integer,
  p_duplicates integer,
  p_errors integer,
  p_error_summary text,
  p_duration_ms integer
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  finished public.ingestion_runs;
begin
  if p_status not in ('succeeded','partial','failed') then
    raise exception 'Invalid terminal ingestion status' using errcode = '22023';
  end if;
  update public.ingestion_runs
  set status = p_status,
      sources_attempted = greatest(0, p_sources_attempted),
      items_fetched = greatest(0, p_items_fetched),
      items_inserted = greatest(0, p_items_inserted),
      duplicates = greatest(0, p_duplicates),
      errors = greatest(0, p_errors),
      error_summary = nullif(left(coalesce(p_error_summary, ''), 5000), ''),
      completed_at = now(),
      duration_ms = greatest(0, p_duration_ms)
  where id = p_run_id and status = 'running'
  returning * into finished;
  return case when finished.id is null then null else to_jsonb(finished) end;
end;
$$;

create or replace function public.assign_source_item_to_story(
  p_source_item_id uuid,
  p_processing_token uuid,
  p_story_id uuid,
  p_canonical_title text,
  p_first_seen_at timestamptz,
  p_last_activity_at timestamptz,
  p_scope text,
  p_link_method text,
  p_confidence numeric,
  p_signals jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  assigned public.stories;
begin
  perform 1
  from public.source_items as items
  where items.id = p_source_item_id
    and items.processing_status = 'processing'
    and items.processing_token = p_processing_token
  for update of items;
  if not found then
    raise exception 'Source-item processing claim is no longer current' using errcode = 'PT412';
  end if;
  if p_scope not in ('state','regional','county','municipality','unknown')
    or p_link_method not in ('created','deterministic','semantic')
    or p_confidence < 0 or p_confidence > 1 then
    raise exception 'Invalid Story assignment' using errcode = '22023';
  end if;

  if p_story_id is null then
    insert into public.stories (
      canonical_title, first_seen_at, last_activity_at, scope, confidence
    ) values (
      p_canonical_title, p_first_seen_at, p_last_activity_at, p_scope, 0.6
    ) returning * into assigned;
  else
    update public.stories
    set last_activity_at = greatest(last_activity_at, p_last_activity_at)
    where id = p_story_id and status <> 'merged'
    returning * into assigned;
    if assigned.id is null then
      raise exception 'Story is unavailable for source assignment' using errcode = 'P0002';
    end if;
  end if;

  insert into public.story_sources (
    story_id, source_item_id, link_method, confidence, signals, attached_by
  ) values (
    assigned.id, p_source_item_id, p_link_method, p_confidence,
    coalesce(p_signals, '{}'::jsonb), 'system'
  );
  return to_jsonb(assigned);
end;
$$;

-- Repair states emitted by the pre-recovery worker ordering. Detached-only
-- evidence remains processed because the human editorial decision is final.
update public.source_items as items
set processing_status = 'error',
    processing_error = 'Interrupted ingestion requires deterministic recovery',
    processing_token = null,
    processing_started_at = null
where items.processing_status = 'processed'
  and (
    not exists (
      select 1 from public.story_sources as links
      where links.source_item_id = items.id
    )
    or exists (
      select 1
      from public.story_sources as links
      where links.source_item_id = items.id and links.detached_at is null
        and (
          not exists (select 1 from public.editorial_queue as queue where queue.story_id = links.story_id)
          or not exists (
            select 1 from public.story_enrichments as enrichments
            where enrichments.story_id = links.story_id and enrichments.analysis_kind = 'deterministic' and enrichments.is_current
          )
          or not exists (
            select 1 from public.story_scores as scores
            where scores.story_id = links.story_id and scores.analysis_kind = 'deterministic' and scores.is_current
          )
        )
    )
  );

create or replace function public.request_story_ai_enrichment(
  p_story_id uuid,
  p_evidence_revision bigint,
  p_input_fingerprint text,
  p_cache_key text,
  p_enrichment_version text,
  p_schema_version text,
  p_prompt_version text,
  p_provider text,
  p_model text,
  p_priority integer default 25,
  p_request_reason text default 'material_change',
  p_requested_by text default 'system',
  p_force boolean default false,
  p_expected_state_updated_at timestamptz default null
) returns public.story_ai_state
language plpgsql
security invoker
set search_path = ''
as $$
declare
  result public.story_ai_state;
  existing public.story_ai_state;
  live_evidence_revision bigint;
begin
  if p_input_fingerprint !~ '^[0-9a-f]{64}$' or p_cache_key !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid AI fingerprint or cache key' using errcode = '22023';
  end if;
  if nullif(btrim(p_provider), '') is null or nullif(btrim(p_model), '') is null then
    raise exception 'Provider and model are required' using errcode = '22023';
  end if;
  select stories.evidence_revision into live_evidence_revision
  from public.stories as stories
  where stories.id = p_story_id and stories.status <> 'merged'
  for update of stories;
  if live_evidence_revision is null then
    raise exception 'Story is unavailable for AI enrichment' using errcode = 'P0002';
  end if;
  if live_evidence_revision is distinct from p_evidence_revision then
    raise exception 'Story evidence changed while AI input was prepared' using errcode = 'PT412';
  end if;
  select states.* into existing
  from public.story_ai_state as states
  where states.story_id = p_story_id
  for update of states;
  if p_expected_state_updated_at is not null and (
    existing.story_id is null or existing.updated_at is distinct from p_expected_state_updated_at
  ) then
    raise exception 'Story AI state changed after scheduled reconciliation selected it' using errcode = 'PT412';
  end if;
  if existing.story_id is not null and existing.enrichment_status = 'running' and existing.lease_expires_at < now() then
    update public.ai_call_attempts as attempts
    set status = 'failed', completed_at = now(), error_code = 'lease_expired',
        error_message = 'AI worker lease expired before completion',
        latency_ms = greatest(0, floor(extract(epoch from (now() - attempts.started_at)) * 1000))::bigint
    where attempts.story_id = p_story_id and attempts.operation_type = 'enrich_story' and attempts.status = 'running';
    update public.story_ai_state
    set enrichment_status = 'failed', lease_token = null, lease_owner = null, lease_expires_at = null,
        claimed_generation = null, claimed_evidence_revision = null, claimed_input_fingerprint = null,
        enrichment_error_code = 'lease_expired', enrichment_error = 'AI worker lease expired before completion',
        next_attempt_at = now(), updated_at = now()
    where story_id = p_story_id;
  end if;

  insert into public.story_ai_state as current (
    story_id, current_evidence_revision, current_input_fingerprint, current_cache_key, enrichment_version,
    schema_version, prompt_version, provider, model, priority, request_reason, requested_by
  ) values (
    p_story_id, live_evidence_revision,
    p_input_fingerprint, p_cache_key, p_enrichment_version,
    p_schema_version, p_prompt_version, p_provider, p_model,
    least(100, greatest(0, p_priority)), left(coalesce(p_request_reason, ''), 200), left(coalesce(p_requested_by, 'system'), 300)
  )
  on conflict (story_id) do update set
    requested_generation = current.requested_generation + case when
      (p_force and current.enrichment_status not in ('pending','running')) or
      current.current_evidence_revision is distinct from excluded.current_evidence_revision or
      current.current_input_fingerprint is distinct from excluded.current_input_fingerprint or
      current.current_cache_key is distinct from excluded.current_cache_key or
      current.enrichment_version is distinct from excluded.enrichment_version or
      current.schema_version is distinct from excluded.schema_version or
      current.prompt_version is distinct from excluded.prompt_version or
      current.provider is distinct from excluded.provider or
      current.model is distinct from excluded.model
    then 1 else 0 end,
    enrichment_status = case
      when current.enrichment_status = 'running' then 'running'
      when (p_force and current.enrichment_status <> 'pending') or
        current.current_evidence_revision is distinct from excluded.current_evidence_revision or
        current.current_input_fingerprint is distinct from excluded.current_input_fingerprint or
        current.current_cache_key is distinct from excluded.current_cache_key or
        current.enrichment_version is distinct from excluded.enrichment_version or
        current.schema_version is distinct from excluded.schema_version or
        current.prompt_version is distinct from excluded.prompt_version or
        current.provider is distinct from excluded.provider or
        current.model is distinct from excluded.model
      then 'pending' else current.enrichment_status end,
    current_evidence_revision = excluded.current_evidence_revision,
    current_input_fingerprint = excluded.current_input_fingerprint,
    current_cache_key = excluded.current_cache_key,
    enrichment_version = excluded.enrichment_version,
    schema_version = excluded.schema_version,
    prompt_version = excluded.prompt_version,
    provider = excluded.provider,
    model = excluded.model,
    priority = greatest(current.priority, excluded.priority),
    request_reason = case when p_force
      or current.current_evidence_revision is distinct from excluded.current_evidence_revision
      or current.current_input_fingerprint is distinct from excluded.current_input_fingerprint
      or current.current_cache_key is distinct from excluded.current_cache_key
      or current.enrichment_version is distinct from excluded.enrichment_version
      or current.schema_version is distinct from excluded.schema_version
      or current.prompt_version is distinct from excluded.prompt_version
      or current.provider is distinct from excluded.provider
      or current.model is distinct from excluded.model
      then excluded.request_reason else current.request_reason end,
    requested_by = case when p_force
      or current.current_evidence_revision is distinct from excluded.current_evidence_revision
      or current.current_input_fingerprint is distinct from excluded.current_input_fingerprint
      or current.current_cache_key is distinct from excluded.current_cache_key
      or current.enrichment_version is distinct from excluded.enrichment_version
      or current.schema_version is distinct from excluded.schema_version
      or current.prompt_version is distinct from excluded.prompt_version
      or current.provider is distinct from excluded.provider
      or current.model is distinct from excluded.model
      then excluded.requested_by else current.requested_by end,
    requested_at = case when p_force
      or current.current_evidence_revision is distinct from excluded.current_evidence_revision
      or current.current_input_fingerprint is distinct from excluded.current_input_fingerprint
      or current.current_cache_key is distinct from excluded.current_cache_key
      or current.enrichment_version is distinct from excluded.enrichment_version
      or current.schema_version is distinct from excluded.schema_version
      or current.prompt_version is distinct from excluded.prompt_version
      or current.provider is distinct from excluded.provider
      or current.model is distinct from excluded.model
      then now() else current.requested_at end,
    next_attempt_at = case when p_force
      or current.current_evidence_revision is distinct from excluded.current_evidence_revision
      or current.current_input_fingerprint is distinct from excluded.current_input_fingerprint
      or current.current_cache_key is distinct from excluded.current_cache_key
      or current.enrichment_version is distinct from excluded.enrichment_version
      or current.schema_version is distinct from excluded.schema_version
      or current.prompt_version is distinct from excluded.prompt_version
      or current.provider is distinct from excluded.provider
      or current.model is distinct from excluded.model
      then now() else current.next_attempt_at end,
    attempt_count = case when
      (p_force and current.enrichment_status not in ('pending','running')) or
      current.current_evidence_revision is distinct from excluded.current_evidence_revision or
      current.current_input_fingerprint is distinct from excluded.current_input_fingerprint or
      current.current_cache_key is distinct from excluded.current_cache_key or
      current.enrichment_version is distinct from excluded.enrichment_version or
      current.schema_version is distinct from excluded.schema_version or
      current.prompt_version is distinct from excluded.prompt_version or
      current.provider is distinct from excluded.provider or
      current.model is distinct from excluded.model
    then 0 else current.attempt_count end,
    enrichment_error_code = case when p_force
      or current.current_evidence_revision is distinct from excluded.current_evidence_revision
      or current.current_input_fingerprint is distinct from excluded.current_input_fingerprint
      or current.current_cache_key is distinct from excluded.current_cache_key
      or current.enrichment_version is distinct from excluded.enrichment_version
      or current.schema_version is distinct from excluded.schema_version
      or current.prompt_version is distinct from excluded.prompt_version
      or current.provider is distinct from excluded.provider
      or current.model is distinct from excluded.model
      then null else current.enrichment_error_code end,
    enrichment_error = case when p_force
      or current.current_evidence_revision is distinct from excluded.current_evidence_revision
      or current.current_input_fingerprint is distinct from excluded.current_input_fingerprint
      or current.current_cache_key is distinct from excluded.current_cache_key
      or current.enrichment_version is distinct from excluded.enrichment_version
      or current.schema_version is distinct from excluded.schema_version
      or current.prompt_version is distinct from excluded.prompt_version
      or current.provider is distinct from excluded.provider
      or current.model is distinct from excluded.model
      then null else current.enrichment_error end,
    updated_at = now()
  returning * into result;
  return result;
end;
$$;


create or replace function public.record_story_ai_enrichment_cache_hit(
  p_story_id uuid,
  p_evidence_revision bigint,
  p_input_fingerprint text,
  p_cache_key text,
  p_requested_by text
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  live_evidence_revision bigint;
  state public.story_ai_state;
  cached public.story_enrichments;
  attempt public.ai_call_attempts;
begin
  select stories.evidence_revision into live_evidence_revision
  from public.stories as stories
  where stories.id = p_story_id and stories.status <> 'merged'
  for update of stories;
  if live_evidence_revision is null then
    raise exception 'Story is unavailable for AI enrichment' using errcode = 'P0002';
  end if;
  if live_evidence_revision is distinct from p_evidence_revision then
    raise exception 'Story evidence changed before enrichment cache reuse' using errcode = 'PT412';
  end if;

  select states.* into state
  from public.story_ai_state as states
  where states.story_id = p_story_id
  for update of states;
  if state.story_id is null or state.enrichment_status <> 'succeeded'
    or state.last_enriched_at is null or state.last_enriched_at < now() - interval '60 seconds'
    or state.current_evidence_revision is distinct from p_evidence_revision
    or state.current_input_fingerprint is distinct from p_input_fingerprint
    or state.last_successful_fingerprint is distinct from p_input_fingerprint
    or state.current_cache_key is distinct from p_cache_key then
    raise exception 'AI enrichment cache identity is no longer current' using errcode = 'PT412';
  end if;

  select enrichments.* into cached
  from public.story_enrichments as enrichments
  where enrichments.story_id = p_story_id and enrichments.analysis_kind = 'ai'
    and enrichments.is_current and enrichments.input_fingerprint = p_input_fingerprint
    and enrichments.cache_key = p_cache_key
    and enrichments.provider = state.provider and enrichments.model = state.model
    and enrichments.schema_version = state.schema_version and enrichments.prompt_version = state.prompt_version
  for update of enrichments;
  if cached.id is null then
    raise exception 'Current AI enrichment cache entry is unavailable' using errcode = 'PT412';
  end if;

  insert into public.ai_call_attempts (
    story_id, operation_type, status, request_generation, evidence_revision,
    input_fingerprint, cache_key, enrichment_version, provider, model, model_version, schema_version,
    prompt_version, provider_called, cache_hit, cached_from_enrichment_id,
    requested_by, request_reason, completed_at
  ) values (
    p_story_id, 'enrich_story', 'cache_hit', state.successful_generation, p_evidence_revision,
    p_input_fingerprint, p_cache_key, state.enrichment_version, cached.provider, cached.model, cached.model_version,
    cached.schema_version, cached.prompt_version, false, true, cached.id,
    left(coalesce(p_requested_by,'system'),300), 'editor_refresh_cooldown', now()
  ) returning * into attempt;
  return to_jsonb(attempt);
end;
$$;


create or replace function public.request_story_analysis_attempt(
  p_story_id uuid,
  p_evidence_revision bigint,
  p_operation_type text,
  p_input_fingerprint text,
  p_cache_key text,
  p_enrichment_version text,
  p_provider text,
  p_model text,
  p_schema_version text,
  p_prompt_version text,
  p_requested_by text,
  p_request_reason text default 'editor_request'
) returns public.ai_call_attempts
language plpgsql
security invoker
set search_path = ''
as $$
declare
  live_evidence_revision bigint;
  attempt public.ai_call_attempts;
  cached public.story_analyses;
begin
  if p_operation_type not in ('compare_sources','story_development','editorial_context')
    or p_input_fingerprint !~ '^[0-9a-f]{64}$' or p_cache_key !~ '^[0-9a-f]{64}$'
    or nullif(btrim(p_enrichment_version),'') is null
    or nullif(btrim(p_provider),'') is null or nullif(btrim(p_model),'') is null then
    raise exception 'Invalid AI analysis request identity' using errcode = '22023';
  end if;

  select stories.evidence_revision into live_evidence_revision
  from public.stories as stories
  where stories.id = p_story_id and stories.status <> 'merged'
  for update of stories;
  if live_evidence_revision is null then
    raise exception 'Story is unavailable for AI analysis' using errcode = 'P0002';
  end if;
  if live_evidence_revision is distinct from p_evidence_revision then
    raise exception 'Story evidence changed while AI input was prepared' using errcode = 'PT412';
  end if;

  update public.ai_call_attempts as attempts
  set status = 'failed', completed_at = now(), error_code = 'lease_expired',
      error_message = 'AI analysis worker lease expired before completion',
      latency_ms = greatest(0, floor(extract(epoch from (now() - attempts.started_at)) * 1000))::bigint,
      lease_token = null, lease_owner = null, lease_expires_at = null
  where attempts.story_id = p_story_id and attempts.operation_type = p_operation_type
    and attempts.status = 'running' and attempts.lease_expires_at < now();

  select attempts.* into attempt
  from public.ai_call_attempts as attempts
  where attempts.story_id = p_story_id and attempts.operation_type = p_operation_type
    and attempts.status in ('queued','running')
  order by attempts.request_sequence desc
  limit 1
  for update of attempts;
  if attempt.id is not null
    and attempt.evidence_revision = live_evidence_revision
    and attempt.input_fingerprint = p_input_fingerprint
    and attempt.cache_key = p_cache_key
    and attempt.enrichment_version = p_enrichment_version
    and attempt.provider = p_provider and attempt.model = p_model
    and attempt.schema_version = p_schema_version and attempt.prompt_version = p_prompt_version then
    return attempt;
  end if;

  update public.ai_call_attempts as attempts
  set status = 'skipped', completed_at = now(),
      latency_ms = greatest(0, floor(extract(epoch from (now() - attempts.started_at)) * 1000))::bigint,
      error_code = 'superseded', error_message = 'A newer editor analysis request replaced this queued identity',
      lease_token = null, lease_owner = null, lease_expires_at = null
  where attempts.story_id = p_story_id and attempts.operation_type = p_operation_type
    and (attempts.status = 'queued' or (attempts.status = 'running' and not attempts.provider_called));

  select attempts.* into attempt
  from public.ai_call_attempts as attempts
  where attempts.story_id = p_story_id
    and attempts.operation_type = p_operation_type
    and attempts.status = 'running'
    and attempts.provider_called
    and attempts.evidence_revision = live_evidence_revision
    and attempts.input_fingerprint = p_input_fingerprint
    and attempts.cache_key = p_cache_key
    and attempts.enrichment_version = p_enrichment_version
    and attempts.provider = p_provider
    and attempts.model = p_model
    and attempts.schema_version = p_schema_version
    and attempts.prompt_version = p_prompt_version
  order by attempts.request_sequence desc
  limit 1
  for update of attempts;
  if attempt.id is not null then
    return attempt;
  end if;

  select analyses.* into cached
  from public.story_analyses as analyses
  where analyses.story_id = p_story_id and analyses.operation_type = p_operation_type
    and analyses.evidence_revision = live_evidence_revision
    and analyses.input_fingerprint = p_input_fingerprint and analyses.cache_key = p_cache_key
    and analyses.enrichment_version = p_enrichment_version
    and analyses.provider = p_provider and analyses.model = p_model
    and analyses.schema_version = p_schema_version and analyses.prompt_version = p_prompt_version
    and analyses.is_current
  for update of analyses;
  if cached.id is not null then
    insert into public.ai_call_attempts (
      story_id, operation_type, status, evidence_revision, input_fingerprint, cache_key, enrichment_version,
      provider, model, model_version, schema_version, prompt_version, provider_called,
      cache_hit, cached_from_analysis_id, requested_by, request_reason, completed_at
    ) values (
      p_story_id, p_operation_type, 'cache_hit', live_evidence_revision,
      p_input_fingerprint, p_cache_key, cached.enrichment_version, cached.provider, cached.model, cached.model_version,
      cached.schema_version, cached.prompt_version, false, true, cached.id,
      left(coalesce(p_requested_by,'system'),300), left(coalesce(p_request_reason,''),200), now()
    ) returning * into attempt;
    return attempt;
  end if;

  insert into public.ai_call_attempts (
    story_id, operation_type, status, evidence_revision, input_fingerprint, cache_key, enrichment_version,
    provider, model, schema_version, prompt_version, provider_called,
    requested_by, request_reason
  ) values (
    p_story_id, p_operation_type, 'queued', live_evidence_revision,
    p_input_fingerprint, p_cache_key, p_enrichment_version, p_provider, p_model, p_schema_version,
    p_prompt_version, false, left(coalesce(p_requested_by,'system'),300),
    left(coalesce(p_request_reason,''),200)
  ) returning * into attempt;
  return attempt;
end;
$$;


comment on index public.ingestion_runs_single_running_unique is
  'Prevents overlapping ingestion workers; stale runs are failed before a replacement starts.';

revoke all on function public.start_ingestion_run(text,text,integer) from public, anon, authenticated;
revoke all on function public.finish_ingestion_run(uuid,text,integer,integer,integer,integer,integer,text,integer) from public, anon, authenticated;
revoke all on function public.assign_source_item_to_story(uuid,uuid,uuid,text,timestamptz,timestamptz,text,text,numeric,jsonb) from public, anon, authenticated;
grant execute on function public.start_ingestion_run(text,text,integer) to service_role;
grant execute on function public.finish_ingestion_run(uuid,text,integer,integer,integer,integer,integer,text,integer) to service_role;
grant execute on function public.assign_source_item_to_story(uuid,uuid,uuid,text,timestamptz,timestamptz,text,text,numeric,jsonb) to service_role;

commit;
