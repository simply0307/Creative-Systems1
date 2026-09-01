begin;

alter table public.sources
  add column adapter_config jsonb not null default '{}'::jsonb,
  add constraint sources_adapter_config_object_check check (jsonb_typeof(adapter_config) = 'object');

alter table public.stories
  add column evidence_revision bigint not null default 1 check (evidence_revision > 0);

alter table public.story_enrichments
  add column analysis_kind text not null default 'deterministic',
  add column operation_type text not null default 'enrich_story',
  add column input_fingerprint text,
  add column cache_key text,
  add column prompt_version text not null default 'deterministic-v1',
  add column briefing jsonb not null default '{}'::jsonb,
  add column completed_at timestamptz not null default now(),
  add constraint story_enrichments_analysis_kind_check check (analysis_kind in ('deterministic','ai')),
  add constraint story_enrichments_operation_type_check check (operation_type = 'enrich_story'),
  add constraint story_enrichments_input_fingerprint_check check (input_fingerprint is null or input_fingerprint ~ '^[0-9a-f]{64}$'),
  add constraint story_enrichments_cache_key_check check (cache_key is null or cache_key ~ '^[0-9a-f]{64}$'),
  add constraint story_enrichments_raw_output_object_check check (jsonb_typeof(raw_output) = 'object'),
  add constraint story_enrichments_briefing_object_check check (jsonb_typeof(briefing) = 'object'),
  add constraint story_enrichments_ai_metadata_check check (
    analysis_kind <> 'ai' or (
      input_fingerprint is not null and cache_key is not null and
      nullif(btrim(provider), '') is not null and nullif(btrim(model), '') is not null and
      nullif(btrim(model_version), '') is not null and nullif(btrim(schema_version), '') is not null and
      nullif(btrim(prompt_version), '') is not null
    )
  );

drop index public.story_enrichments_current_unique;
create unique index story_enrichments_current_kind_unique
  on public.story_enrichments(story_id, analysis_kind) where is_current;
create index story_enrichments_story_history_idx
  on public.story_enrichments(story_id, analysis_kind, created_at desc);
create index story_enrichments_ai_cache_idx
  on public.story_enrichments(story_id, cache_key, created_at desc)
  where analysis_kind = 'ai' and cache_key is not null;

alter table public.story_scores
  add column analysis_kind text not null default 'deterministic',
  add column input_fingerprint text,
  add constraint story_scores_analysis_kind_check check (analysis_kind in ('deterministic','ai')),
  add constraint story_scores_input_fingerprint_check check (input_fingerprint is null or input_fingerprint ~ '^[0-9a-f]{64}$');

drop index public.story_scores_current_unique;
create unique index story_scores_current_kind_unique
  on public.story_scores(story_id, analysis_kind) where is_current;
create index story_scores_story_history_idx
  on public.story_scores(story_id, analysis_kind, created_at desc);

create function public.bump_story_evidence_revision()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.evidence_revision = old.evidence_revision + 1;
  return new;
end;
$$;

create function public.bump_related_story_evidence_revision()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_story_id uuid;
begin
  if tg_op = 'UPDATE' and old.story_id is distinct from new.story_id then
    update public.stories
    set evidence_revision = evidence_revision + 1
    where id in (old.story_id, new.story_id);
    return new;
  end if;
  target_story_id := case when tg_op = 'DELETE' then old.story_id else new.story_id end;
  update public.stories
  set evidence_revision = evidence_revision + 1
  where id = target_story_id;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create function public.bump_source_item_story_evidence_revision()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.stories as stories
  set evidence_revision = stories.evidence_revision + 1
  where stories.id in (
    select links.story_id
    from public.story_sources as links
    where links.source_item_id = new.id and links.detached_at is null
  );
  return new;
end;
$$;

create function public.bump_source_story_evidence_revision()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.stories as stories
  set evidence_revision = stories.evidence_revision + 1
  where stories.id in (
    select links.story_id
    from public.story_sources as links
    join public.source_items as items on items.id = links.source_item_id
    where items.source_id = new.id and links.detached_at is null
  );
  return new;
end;
$$;

create trigger stories_evidence_revision_before_update
  before update of canonical_title, first_seen_at, last_activity_at, event_date on public.stories
  for each row when (
    old.canonical_title is distinct from new.canonical_title or
    old.first_seen_at is distinct from new.first_seen_at or
    old.last_activity_at is distinct from new.last_activity_at or
    old.event_date is distinct from new.event_date
  ) execute function public.bump_story_evidence_revision();
create trigger story_sources_evidence_revision_after_change
  after insert or delete or update of detached_at, attached_at, story_id, source_item_id on public.story_sources
  for each row execute function public.bump_related_story_evidence_revision();
create trigger source_items_evidence_revision_after_update
  after update of source_id, headline, normalized_headline, description, publisher, canonical_url, published_at, content_hash on public.source_items
  for each row when (
    old.source_id is distinct from new.source_id or old.headline is distinct from new.headline or
    old.normalized_headline is distinct from new.normalized_headline or old.description is distinct from new.description or
    old.publisher is distinct from new.publisher or old.canonical_url is distinct from new.canonical_url or
    old.published_at is distinct from new.published_at or old.content_hash is distinct from new.content_hash
  ) execute function public.bump_source_item_story_evidence_revision();
create trigger sources_evidence_revision_after_update
  after update of name, source_type on public.sources
  for each row when (old.name is distinct from new.name or old.source_type is distinct from new.source_type)
  execute function public.bump_source_story_evidence_revision();
create trigger story_counties_evidence_revision_after_change
  after insert or delete on public.story_counties
  for each row execute function public.bump_related_story_evidence_revision();
create trigger story_municipalities_evidence_revision_after_change
  after insert or delete on public.story_municipalities
  for each row execute function public.bump_related_story_evidence_revision();
create trigger story_enrichments_evidence_revision_after_insert
  after insert on public.story_enrichments
  for each row when (new.analysis_kind = 'deterministic' and new.is_current)
  execute function public.bump_related_story_evidence_revision();

create table public.story_ai_state (
  story_id uuid primary key references public.stories(id) on delete cascade,
  enrichment_status text not null default 'pending'
    check (enrichment_status in ('pending','running','succeeded','failed')),
  requested_generation bigint not null default 1 check (requested_generation > 0),
  successful_generation bigint not null default 0 check (successful_generation between 0 and requested_generation),
  claimed_generation bigint check (claimed_generation is null or claimed_generation between 1 and requested_generation),
  current_evidence_revision bigint not null check (current_evidence_revision > 0),
  claimed_evidence_revision bigint check (claimed_evidence_revision is null or claimed_evidence_revision > 0),
  current_input_fingerprint text not null check (current_input_fingerprint ~ '^[0-9a-f]{64}$'),
  claimed_input_fingerprint text check (claimed_input_fingerprint is null or claimed_input_fingerprint ~ '^[0-9a-f]{64}$'),
  last_successful_fingerprint text check (last_successful_fingerprint is null or last_successful_fingerprint ~ '^[0-9a-f]{64}$'),
  current_cache_key text not null check (current_cache_key ~ '^[0-9a-f]{64}$'),
  enrichment_version text not null,
  schema_version text not null,
  prompt_version text not null,
  provider text not null,
  model text not null,
  priority smallint not null default 25 check (priority between 0 and 100),
  request_reason text not null default 'new_story',
  requested_by text not null default 'system',
  requested_at timestamptz not null default now(),
  last_attempted_at timestamptz,
  last_enriched_at timestamptz,
  enrichment_error_code text,
  enrichment_error text,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  lease_token uuid,
  lease_owner text,
  lease_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (num_nonnulls(
    lease_token, lease_owner, lease_expires_at,
    claimed_generation, claimed_input_fingerprint, claimed_evidence_revision
  ) in (0, 6)),
  check ((enrichment_status = 'running') = (num_nonnulls(
    lease_token, lease_owner, lease_expires_at,
    claimed_generation, claimed_input_fingerprint, claimed_evidence_revision
  ) = 6))
);
create index story_ai_state_claim_idx
  on public.story_ai_state(enrichment_status, next_attempt_at, priority desc, requested_at)
  where enrichment_status in ('pending','failed');
create index story_ai_state_lease_idx
  on public.story_ai_state(lease_expires_at) where enrichment_status = 'running';

create table public.ai_call_attempts (
  id uuid primary key default gen_random_uuid(),
  request_sequence bigint generated always as identity unique,
  story_id uuid not null references public.stories(id) on delete restrict,
  ingestion_run_id uuid references public.ingestion_runs(id) on delete set null,
  operation_type text not null check (operation_type in ('enrich_story','compare_sources','story_development','editorial_context')),
  status text not null check (status in ('queued','running','succeeded','failed','rejected','cache_hit','skipped')),
  request_generation bigint check (request_generation is null or request_generation > 0),
  evidence_revision bigint not null check (evidence_revision > 0),
  input_fingerprint text not null check (input_fingerprint ~ '^[0-9a-f]{64}$'),
  cache_key text check (cache_key is null or cache_key ~ '^[0-9a-f]{64}$'),
  enrichment_version text not null,
  provider text,
  model text,
  model_version text,
  schema_version text not null,
  prompt_version text not null,
  provider_called boolean not null default false,
  cache_hit boolean not null default false,
  cached_from_enrichment_id uuid references public.story_enrichments(id) on delete set null,
  provider_request_id text,
  requested_by text not null default 'system',
  request_reason text not null default '',
  started_at timestamptz not null default now(),
  provider_started_at timestamptz,
  completed_at timestamptz,
  latency_ms bigint check (latency_ms is null or latency_ms >= 0),
  provider_latency_ms bigint check (provider_latency_ms is null or provider_latency_ms >= 0),
  input_tokens bigint check (input_tokens is null or input_tokens >= 0),
  output_tokens bigint check (output_tokens is null or output_tokens >= 0),
  total_tokens bigint check (total_tokens is null or total_tokens >= 0),
  usage_metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(usage_metadata) = 'object'),
  error_code text,
  error_message text,
  lease_token uuid,
  lease_owner text,
  lease_expires_at timestamptz,
  created_at timestamptz not null default now(),
  check ((provider is null) = (model is null)),
  check (not provider_called or (provider is not null and provider_started_at is not null)),
  constraint ai_call_attempts_cache_hit_check check ((status = 'cache_hit') = cache_hit and (not cache_hit or not provider_called)),
  check ((status in ('queued','running')) = (completed_at is null)),
  check (num_nonnulls(lease_token, lease_owner, lease_expires_at) in (0, 3)),
  constraint ai_call_attempts_basic_lease_check check (
    operation_type <> 'enrich_story' or num_nonnulls(lease_token, lease_owner, lease_expires_at) = 0
  ),
  check (operation_type = 'enrich_story' or (status = 'running') = (
    num_nonnulls(lease_token, lease_owner, lease_expires_at) = 3
  )),
  check (status not in ('failed','rejected') or nullif(btrim(error_message), '') is not null)
);
create unique index ai_call_attempts_one_queued_idx
  on public.ai_call_attempts(story_id, operation_type) where status = 'queued';
create unique index ai_call_attempts_one_running_idx
  on public.ai_call_attempts(story_id, operation_type) where status = 'running';
create index ai_call_attempts_story_time_idx on public.ai_call_attempts(story_id, started_at desc);
create index ai_call_attempts_activity_time_idx on public.ai_call_attempts(started_at desc);
create index ai_call_attempts_run_time_idx on public.ai_call_attempts(ingestion_run_id, started_at desc) where ingestion_run_id is not null;
create index ai_call_attempts_failures_idx on public.ai_call_attempts(started_at desc) where status in ('failed','rejected');
create index ai_call_attempts_provider_idx on public.ai_call_attempts(provider, model, started_at desc) where provider_called;
create index ai_call_attempts_cached_enrichment_idx on public.ai_call_attempts(cached_from_enrichment_id) where cached_from_enrichment_id is not null;
create index ai_call_attempts_analysis_lease_idx on public.ai_call_attempts(lease_expires_at, id)
  where status = 'running' and operation_type <> 'enrich_story';
create index ai_call_attempts_compare_queue_idx on public.ai_call_attempts(started_at, id)
  where status = 'queued' and operation_type = 'compare_sources';
create index ai_call_attempts_analysis_config_queue_idx
  on public.ai_call_attempts(enrichment_version, provider, model, schema_version, prompt_version, started_at, id)
  where status = 'queued' and operation_type = 'compare_sources';

alter table public.story_enrichments add column ai_call_attempt_id uuid references public.ai_call_attempts(id) on delete restrict;
alter table public.story_scores add column ai_call_attempt_id uuid references public.ai_call_attempts(id) on delete restrict;
create index story_enrichments_ai_call_attempt_idx on public.story_enrichments(ai_call_attempt_id) where ai_call_attempt_id is not null;
create index story_scores_ai_call_attempt_idx on public.story_scores(ai_call_attempt_id) where ai_call_attempt_id is not null;

create table public.story_analyses (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references public.stories(id) on delete cascade,
  operation_type text not null check (operation_type in ('compare_sources','story_development','editorial_context')),
  evidence_revision bigint not null check (evidence_revision > 0),
  input_fingerprint text not null check (input_fingerprint ~ '^[0-9a-f]{64}$'),
  cache_key text not null check (cache_key ~ '^[0-9a-f]{64}$'),
  enrichment_version text not null,
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  provider text not null,
  model text not null,
  model_version text not null,
  schema_version text not null,
  prompt_version text not null,
  ai_call_attempt_id uuid not null unique references public.ai_call_attempts(id) on delete restrict,
  requested_by text not null,
  is_current boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index story_analyses_current_kind_unique
  on public.story_analyses(story_id, operation_type) where is_current;
create index story_analyses_story_history_idx on public.story_analyses(story_id, operation_type, created_at desc);

alter table public.ai_call_attempts
  add column cached_from_analysis_id uuid references public.story_analyses(id) on delete set null,
  add constraint ai_call_attempts_cache_target_check check (
    (not cache_hit and num_nonnulls(cached_from_enrichment_id, cached_from_analysis_id) = 0) or
    (cache_hit and operation_type = 'enrich_story' and cached_from_enrichment_id is not null and cached_from_analysis_id is null) or
    (cache_hit and operation_type <> 'enrich_story' and cached_from_enrichment_id is null and cached_from_analysis_id is not null)
  );
create index ai_call_attempts_cached_analysis_idx on public.ai_call_attempts(cached_from_analysis_id) where cached_from_analysis_id is not null;

alter table public.editorial_decisions drop constraint editorial_decisions_action_type_check;
alter table public.editorial_decisions add constraint editorial_decisions_action_type_check
  check (action_type in ('status_change','route','merge','detach','attach','note','ai_refresh','deep_analysis'));

create index if not exists sources_county_id_idx on public.sources(county_id) where county_id is not null;
create index if not exists sources_municipality_id_idx on public.sources(municipality_id) where municipality_id is not null;
create index if not exists stories_merged_into_story_id_idx on public.stories(merged_into_story_id) where merged_into_story_id is not null;
create index if not exists story_sources_source_item_id_idx on public.story_sources(source_item_id);

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
    raise exception 'Story evidence changed while AI input was prepared' using errcode = '40001';
  end if;
  select states.* into existing
  from public.story_ai_state as states
  where states.story_id = p_story_id
  for update of states;
  if p_expected_state_updated_at is not null and (
    existing.story_id is null or existing.updated_at is distinct from p_expected_state_updated_at
  ) then
    raise exception 'Story AI state changed after scheduled reconciliation selected it' using errcode = '40001';
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
      current.prompt_version is distinct from excluded.prompt_version
    then 1 else 0 end,
    enrichment_status = case
      when current.enrichment_status = 'running' then 'running'
      when (p_force and current.enrichment_status <> 'pending') or
        current.current_evidence_revision is distinct from excluded.current_evidence_revision or
        current.current_input_fingerprint is distinct from excluded.current_input_fingerprint or
        current.current_cache_key is distinct from excluded.current_cache_key or
        current.enrichment_version is distinct from excluded.enrichment_version or
        current.schema_version is distinct from excluded.schema_version or
        current.prompt_version is distinct from excluded.prompt_version
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
    request_reason = case when p_force or current.current_evidence_revision is distinct from excluded.current_evidence_revision or current.current_cache_key is distinct from excluded.current_cache_key then excluded.request_reason else current.request_reason end,
    requested_by = case when p_force or current.current_evidence_revision is distinct from excluded.current_evidence_revision or current.current_cache_key is distinct from excluded.current_cache_key then excluded.requested_by else current.requested_by end,
    requested_at = case when p_force or current.current_evidence_revision is distinct from excluded.current_evidence_revision or current.current_cache_key is distinct from excluded.current_cache_key then now() else current.requested_at end,
    next_attempt_at = case when p_force or current.current_evidence_revision is distinct from excluded.current_evidence_revision or current.current_cache_key is distinct from excluded.current_cache_key then now() else current.next_attempt_at end,
    attempt_count = case when
      (p_force and current.enrichment_status not in ('pending','running')) or
      current.current_evidence_revision is distinct from excluded.current_evidence_revision or
      current.current_input_fingerprint is distinct from excluded.current_input_fingerprint or
      current.current_cache_key is distinct from excluded.current_cache_key or
      current.enrichment_version is distinct from excluded.enrichment_version or
      current.schema_version is distinct from excluded.schema_version or
      current.prompt_version is distinct from excluded.prompt_version
    then 0 else current.attempt_count end,
    enrichment_error_code = case when p_force or current.current_evidence_revision is distinct from excluded.current_evidence_revision or current.current_cache_key is distinct from excluded.current_cache_key then null else current.enrichment_error_code end,
    enrichment_error = case when p_force or current.current_evidence_revision is distinct from excluded.current_evidence_revision or current.current_cache_key is distinct from excluded.current_cache_key then null else current.enrichment_error end,
    updated_at = now()
  returning * into result;
  return result;
end;
$$;

create or replace function public.list_story_ai_revision_mismatches(
  p_limit integer default 50,
  p_updated_before timestamptz default now()
) returns table (story_id uuid, priority smallint, updated_at timestamptz)
language sql
security invoker
set search_path = ''
as $$
  select states.story_id, states.priority, states.updated_at
  from public.story_ai_state as states
  join public.stories as stories on stories.id = states.story_id
  where stories.status <> 'merged'
    and states.current_evidence_revision is distinct from stories.evidence_revision
    and states.updated_at <= p_updated_before
  order by states.priority desc, states.requested_at, states.story_id
  limit least(250, greatest(0, p_limit));
$$;

create or replace function public.expire_stale_story_ai_enrichments(
  p_limit integer default 100
) returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  expired record;
  expired_count integer := 0;
begin
  for expired in
    select state.story_id
    from public.story_ai_state as state
    where state.enrichment_status = 'running' and state.lease_expires_at < now()
    order by state.lease_expires_at, state.story_id
    for update of state skip locked
    limit least(1000, greatest(0, p_limit))
  loop
    update public.ai_call_attempts as attempts
    set status = 'failed', completed_at = now(), error_code = 'lease_expired',
        error_message = 'AI worker lease expired before completion',
        latency_ms = greatest(0, floor(extract(epoch from (now() - attempts.started_at)) * 1000))::bigint
    where attempts.story_id = expired.story_id and attempts.operation_type = 'enrich_story' and attempts.status = 'running';

    update public.story_ai_state
    set enrichment_status = 'failed', lease_token = null, lease_owner = null, lease_expires_at = null,
        claimed_generation = null, claimed_evidence_revision = null, claimed_input_fingerprint = null,
        enrichment_error_code = 'lease_expired', enrichment_error = 'AI worker lease expired before completion',
        next_attempt_at = now(), updated_at = now()
    where story_id = expired.story_id;
    expired_count := expired_count + 1;
  end loop;
  return expired_count;
end;
$$;

create or replace function public.claim_story_ai_enrichments(
  p_limit integer,
  p_worker text,
  p_enrichment_version text,
  p_schema_version text,
  p_prompt_version text,
  p_provider text,
  p_model text,
  p_lease_seconds integer default 600
) returns setof public.story_ai_state
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if nullif(btrim(p_enrichment_version),'') is null or nullif(btrim(p_schema_version),'') is null
    or nullif(btrim(p_prompt_version),'') is null or nullif(btrim(p_provider),'') is null
    or nullif(btrim(p_model),'') is null then
    raise exception 'Expected AI enrichment identity is required' using errcode = '22023';
  end if;
  perform public.expire_stale_story_ai_enrichments(100);
  return query
  with candidates as (
    select state.story_id
    from public.story_ai_state as state
    join public.stories as story on story.id = state.story_id and story.status <> 'merged'
    where state.enrichment_status in ('pending','failed') and state.next_attempt_at <= now()
      and state.enrichment_version = p_enrichment_version
      and state.schema_version = p_schema_version
      and state.prompt_version = p_prompt_version
      and state.provider = p_provider
      and state.model = p_model
      and (state.last_successful_fingerprint is distinct from state.current_input_fingerprint
        or state.successful_generation < state.requested_generation)
    order by state.priority desc, state.requested_at, state.story_id
    for update of state skip locked
    limit least(100, greatest(0, p_limit))
  )
  update public.story_ai_state as state
  set enrichment_status = 'running', claimed_generation = state.requested_generation,
      claimed_evidence_revision = state.current_evidence_revision,
      claimed_input_fingerprint = state.current_input_fingerprint,
      lease_token = gen_random_uuid(), lease_owner = left(coalesce(p_worker, 'worker'), 300),
      lease_expires_at = now() + make_interval(secs => least(900, greatest(30, p_lease_seconds))),
      last_attempted_at = now(), attempt_count = state.attempt_count + 1,
      enrichment_error_code = null, enrichment_error = null, updated_at = now()
  from candidates where state.story_id = candidates.story_id
  returning state.*;
end;
$$;

create or replace function public.claim_story_ai_enrichment(
  p_story_id uuid,
  p_worker text,
  p_enrichment_version text,
  p_schema_version text,
  p_prompt_version text,
  p_provider text,
  p_model text,
  p_lease_seconds integer default 600
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  result public.story_ai_state;
begin
  if nullif(btrim(p_enrichment_version),'') is null or nullif(btrim(p_schema_version),'') is null
    or nullif(btrim(p_prompt_version),'') is null or nullif(btrim(p_provider),'') is null
    or nullif(btrim(p_model),'') is null then
    raise exception 'Expected AI enrichment identity is required' using errcode = '22023';
  end if;
  select * into result from public.story_ai_state where story_id = p_story_id for update;
  if result.story_id is not null and result.enrichment_status = 'running' and result.lease_expires_at < now() then
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
    where story_id = p_story_id
    returning * into result;
  end if;
  if result.story_id is null or result.enrichment_status not in ('pending','failed')
    or result.next_attempt_at > now()
    or result.enrichment_version is distinct from p_enrichment_version
    or result.schema_version is distinct from p_schema_version
    or result.prompt_version is distinct from p_prompt_version
    or result.provider is distinct from p_provider
    or result.model is distinct from p_model then
    return null;
  end if;
  update public.story_ai_state set enrichment_status = 'running',
    claimed_generation = requested_generation, claimed_evidence_revision = current_evidence_revision,
    claimed_input_fingerprint = current_input_fingerprint,
    lease_token = gen_random_uuid(), lease_owner = left(coalesce(p_worker,'worker'),300),
    lease_expires_at = now() + make_interval(secs => least(900, greatest(30, p_lease_seconds))),
    last_attempted_at = now(), attempt_count = attempt_count + 1,
    enrichment_error_code = null, enrichment_error = null, updated_at = now()
  where story_id = p_story_id returning * into result;
  return to_jsonb(result);
end;
$$;

create or replace function public.create_story_ai_call_attempt(
  p_call_attempt_id uuid,
  p_story_id uuid,
  p_lease_token uuid,
  p_ingestion_run_id uuid default null
) returns public.ai_call_attempts
language plpgsql
security invoker
set search_path = ''
as $$
declare
  state public.story_ai_state;
  attempt public.ai_call_attempts;
begin
  select states.* into state
  from public.story_ai_state as states
  where states.story_id = p_story_id
  for update of states;
  if state.story_id is null or state.enrichment_status <> 'running'
    or state.lease_token is distinct from p_lease_token or state.lease_expires_at <= now()
    or state.requested_generation is distinct from state.claimed_generation
    or state.current_evidence_revision is distinct from state.claimed_evidence_revision
    or state.current_input_fingerprint is distinct from state.claimed_input_fingerprint then
    raise exception 'AI enrichment lease is no longer valid' using errcode = '55000';
  end if;

  insert into public.ai_call_attempts (
    id, story_id, ingestion_run_id, operation_type, status, request_generation,
    evidence_revision, input_fingerprint, cache_key, enrichment_version, provider, model, schema_version,
    prompt_version, provider_called, requested_by, request_reason
  ) values (
    p_call_attempt_id, p_story_id, p_ingestion_run_id, 'enrich_story', 'running',
    state.claimed_generation, state.claimed_evidence_revision, state.claimed_input_fingerprint,
    state.current_cache_key, state.enrichment_version, state.provider, state.model, state.schema_version,
    state.prompt_version, false, state.requested_by, state.request_reason
  ) on conflict (id) do nothing;

  select attempts.* into attempt
  from public.ai_call_attempts as attempts
  where attempts.id = p_call_attempt_id
  for update of attempts;
  if attempt.id is null or attempt.story_id is distinct from p_story_id
    or attempt.operation_type <> 'enrich_story' or attempt.status <> 'running'
    or attempt.request_generation is distinct from state.claimed_generation
    or attempt.evidence_revision is distinct from state.claimed_evidence_revision
    or attempt.input_fingerprint is distinct from state.claimed_input_fingerprint then
    raise exception 'AI call attempt identity is invalid' using errcode = '55000';
  end if;
  return attempt;
end;
$$;

create or replace function public.begin_story_ai_provider_call(
  p_call_attempt_id uuid,
  p_story_id uuid,
  p_lease_token uuid
) returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  state public.story_ai_state;
  live_evidence_revision bigint;
  changed_count integer;
begin
  select stories.evidence_revision into live_evidence_revision
  from public.stories as stories
  where stories.id = p_story_id and stories.status <> 'merged'
  for update of stories;
  if live_evidence_revision is null then return false; end if;
  select states.* into state
  from public.story_ai_state as states
  where states.story_id = p_story_id
  for update of states;
  if state.story_id is null or state.enrichment_status <> 'running'
    or state.lease_token is distinct from p_lease_token or state.lease_expires_at <= now()
    or state.requested_generation is distinct from state.claimed_generation
    or state.current_evidence_revision is distinct from state.claimed_evidence_revision
    or state.current_input_fingerprint is distinct from state.claimed_input_fingerprint
    or state.claimed_evidence_revision is distinct from live_evidence_revision then
    return false;
  end if;
  update public.ai_call_attempts as attempts
  set provider_called = true, provider_started_at = coalesce(attempts.provider_started_at, now())
  where attempts.id = p_call_attempt_id and attempts.story_id = p_story_id
    and attempts.operation_type = 'enrich_story' and attempts.status = 'running'
    and attempts.request_generation = state.claimed_generation
    and attempts.evidence_revision = state.claimed_evidence_revision
    and attempts.input_fingerprint = state.claimed_input_fingerprint
    and not attempts.provider_called;
  get diagnostics changed_count = row_count;
  if changed_count = 1 then return true; end if;
  return exists (
    select 1 from public.ai_call_attempts as attempts
    where attempts.id = p_call_attempt_id and attempts.story_id = p_story_id
      and attempts.status = 'running' and attempts.provider_called
      and attempts.request_generation = state.claimed_generation
      and attempts.evidence_revision = state.claimed_evidence_revision
      and attempts.input_fingerprint = state.claimed_input_fingerprint
  );
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
    raise exception 'Story evidence changed before enrichment cache reuse' using errcode = '40001';
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
    raise exception 'AI enrichment cache identity is no longer current' using errcode = '40001';
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
    raise exception 'Current AI enrichment cache entry is unavailable' using errcode = '40001';
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

create or replace function public.complete_story_ai_enrichment(
  p_story_id uuid,
  p_lease_token uuid,
  p_call_attempt_id uuid,
  p_output jsonb,
  p_model_version text,
  p_provider_request_id text,
  p_latency_ms bigint,
  p_provider_latency_ms bigint,
  p_input_tokens bigint,
  p_output_tokens bigint,
  p_total_tokens bigint,
  p_usage_metadata jsonb
) returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  state public.story_ai_state;
  enrichment jsonb := p_output -> 'enrichment';
  scores jsonb := p_output -> 'scores';
  briefing jsonb := p_output -> 'briefing';
  live_evidence_revision bigint;
begin
  select stories.evidence_revision into live_evidence_revision
  from public.stories
  where stories.id = p_story_id
  for update;
  if live_evidence_revision is null then
    raise exception 'Story is unavailable for AI enrichment' using errcode = 'P0002';
  end if;
  select * into state from public.story_ai_state where story_id = p_story_id for update;
  if state.story_id is null or state.enrichment_status <> 'running' or state.lease_token is distinct from p_lease_token
    or state.lease_expires_at <= now() then
    raise exception 'AI enrichment lease is no longer valid' using errcode = '55000';
  end if;
  perform 1 from public.ai_call_attempts
    where id = p_call_attempt_id and story_id = p_story_id and operation_type = 'enrich_story'
      and status = 'running' and provider_called
      and request_generation = state.claimed_generation
      and evidence_revision = state.claimed_evidence_revision
      and input_fingerprint = state.claimed_input_fingerprint
    for update;
  if not found then raise exception 'AI call attempt is not running' using errcode = '55000'; end if;

  if state.requested_generation > state.claimed_generation
    or state.current_input_fingerprint is distinct from state.claimed_input_fingerprint
    or state.current_evidence_revision is distinct from state.claimed_evidence_revision
    or live_evidence_revision is distinct from state.claimed_evidence_revision then
    update public.ai_call_attempts set status = 'skipped', completed_at = now(), provider_request_id = p_provider_request_id,
      model_version = coalesce(nullif(p_model_version,''), state.model),
      latency_ms = p_latency_ms, provider_latency_ms = p_provider_latency_ms,
      input_tokens = p_input_tokens, output_tokens = p_output_tokens, total_tokens = p_total_tokens,
      usage_metadata = coalesce(p_usage_metadata, '{}'::jsonb),
      error_code = 'superseded',
      error_message = 'Story evidence or enrichment identity changed during the provider call'
    where id = p_call_attempt_id;
    update public.story_ai_state set enrichment_status = 'pending', lease_token = null, lease_owner = null,
      lease_expires_at = null, claimed_generation = null, claimed_evidence_revision = null,
      claimed_input_fingerprint = null, next_attempt_at = now(), updated_at = now()
    where story_id = p_story_id;
    return false;
  end if;

  if jsonb_typeof(enrichment) <> 'object' or jsonb_typeof(scores) <> 'object' or jsonb_typeof(briefing) <> 'object' then
    raise exception 'AI output is missing a validated object' using errcode = '22023';
  end if;

  update public.story_enrichments set is_current = false
    where story_id = p_story_id and analysis_kind = 'ai' and is_current;
  insert into public.story_enrichments (
    story_id, nj_relevance, scope, counties, municipalities, topics, people, organizations,
    event_type, event_date, public_impact, civic_utility, novelty, human_interest,
    emotional_register, reath_potential, satire_potential, confidence, provider, model,
    model_version, schema_version, raw_output, is_current, analysis_kind, operation_type,
    input_fingerprint, cache_key, prompt_version, briefing, ai_call_attempt_id
  ) values (
    p_story_id, (enrichment->>'nj_relevance')::smallint, enrichment->>'scope',
    array(select jsonb_array_elements_text(enrichment->'counties')),
    array(select jsonb_array_elements_text(enrichment->'municipalities')),
    array(select jsonb_array_elements_text(enrichment->'topics')),
    array(select jsonb_array_elements_text(enrichment->'people')),
    array(select jsonb_array_elements_text(enrichment->'organizations')),
    enrichment->>'event_type', nullif(enrichment->>'event_date','')::date,
    (enrichment->>'public_impact')::smallint, (enrichment->>'civic_utility')::smallint,
    (enrichment->>'novelty')::smallint, (enrichment->>'human_interest')::smallint,
    enrichment->>'emotional_register', (enrichment->>'reath_potential')::smallint,
    (enrichment->>'satire_potential')::smallint, (enrichment->>'confidence')::numeric,
    state.provider, state.model, coalesce(nullif(p_model_version,''), state.model), state.schema_version,
    p_output, true, 'ai', 'enrich_story', state.claimed_input_fingerprint, state.current_cache_key,
    state.prompt_version, briefing, p_call_attempt_id
  );

  update public.story_scores set is_current = false
    where story_id = p_story_id and analysis_kind = 'ai' and is_current;
  insert into public.story_scores (
    story_id, local_impact, civic_utility, significance, momentum, novelty, human_interest,
    emotional_resonance, reath_potential, satire_potential, locality, confidence, reasons,
    provider, model_version, is_current, analysis_kind, input_fingerprint, ai_call_attempt_id
  ) values (
    p_story_id, (scores->>'local_impact')::smallint, (scores->>'civic_utility')::smallint,
    (scores->>'significance')::smallint, (scores->>'momentum')::smallint,
    (scores->>'novelty')::smallint, (scores->>'human_interest')::smallint,
    (scores->>'emotional_resonance')::smallint, (scores->>'reath_potential')::smallint,
    (scores->>'satire_potential')::smallint, (scores->>'locality')::smallint,
    (scores->>'confidence')::smallint, scores->'reasons', state.provider,
    coalesce(nullif(p_model_version,''), state.model), true, 'ai', state.claimed_input_fingerprint, p_call_attempt_id
  );

  update public.ai_call_attempts set status = 'succeeded', completed_at = now(),
    provider_request_id = p_provider_request_id, model_version = coalesce(nullif(p_model_version,''), state.model), latency_ms = p_latency_ms,
    provider_latency_ms = p_provider_latency_ms, input_tokens = p_input_tokens,
    output_tokens = p_output_tokens, total_tokens = p_total_tokens,
    usage_metadata = coalesce(p_usage_metadata, '{}'::jsonb)
  where id = p_call_attempt_id;

  update public.story_ai_state set enrichment_status = 'succeeded',
    successful_generation = claimed_generation, last_successful_fingerprint = claimed_input_fingerprint,
    last_enriched_at = now(), enrichment_error_code = null, enrichment_error = null,
    priority = 25, attempt_count = 0, lease_token = null, lease_owner = null, lease_expires_at = null,
    claimed_generation = null, claimed_evidence_revision = null, claimed_input_fingerprint = null, updated_at = now()
  where story_id = p_story_id;
  return true;
end;
$$;

create or replace function public.release_story_ai_enrichment_claim(
  p_story_id uuid,
  p_lease_token uuid,
  p_error_code text,
  p_error_message text
) returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  state public.story_ai_state;
  has_newer_request boolean;
begin
  select * into state from public.story_ai_state where story_id = p_story_id for update;
  if state.story_id is null or state.enrichment_status <> 'running' or state.lease_token is distinct from p_lease_token then
    return false;
  end if;
  has_newer_request := state.requested_generation > state.claimed_generation
    or state.current_evidence_revision is distinct from state.claimed_evidence_revision
    or state.current_input_fingerprint is distinct from state.claimed_input_fingerprint;
  update public.ai_call_attempts as attempts
  set status = 'failed', completed_at = now(),
      latency_ms = greatest(0, floor(extract(epoch from (now() - attempts.started_at)) * 1000))::bigint,
      error_code = left(coalesce(p_error_code,'worker_error'),200),
      error_message = left(coalesce(p_error_message,'AI worker failed before the provider call'),4000)
  where attempts.story_id = p_story_id and attempts.operation_type = 'enrich_story'
    and attempts.status = 'running'
    and attempts.request_generation = state.claimed_generation
    and attempts.evidence_revision = state.claimed_evidence_revision
    and attempts.input_fingerprint = state.claimed_input_fingerprint;
  update public.story_ai_state set enrichment_status = case when has_newer_request then 'pending' else 'failed' end,
    enrichment_error_code = left(coalesce(p_error_code,'worker_error'),200),
    enrichment_error = left(coalesce(p_error_message,'AI worker failed before the provider call'),4000),
    next_attempt_at = case when has_newer_request then now() else now() + make_interval(secs => least(3600, 60 * greatest(1, attempt_count))) end,
    lease_token = null, lease_owner = null, lease_expires_at = null,
    claimed_generation = null, claimed_evidence_revision = null, claimed_input_fingerprint = null, updated_at = now()
  where story_id = p_story_id;
  return true;
end;
$$;

create or replace function public.fail_story_ai_enrichment(
  p_story_id uuid,
  p_lease_token uuid,
  p_call_attempt_id uuid,
  p_outcome text,
  p_error_code text,
  p_error_message text,
  p_latency_ms bigint,
  p_provider_latency_ms bigint,
  p_model_version text,
  p_provider_request_id text,
  p_input_tokens bigint,
  p_output_tokens bigint,
  p_total_tokens bigint,
  p_usage_metadata jsonb
) returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  state public.story_ai_state;
  has_newer_request boolean;
begin
  select * into state from public.story_ai_state where story_id = p_story_id for update;
  if state.story_id is null or state.enrichment_status <> 'running' or state.lease_token is distinct from p_lease_token
    or state.lease_expires_at <= now() then
    return false;
  end if;
  perform 1 from public.ai_call_attempts as attempts
  where attempts.id = p_call_attempt_id and attempts.story_id = p_story_id
    and attempts.operation_type = 'enrich_story' and attempts.status = 'running'
    and attempts.request_generation = state.claimed_generation
    and attempts.evidence_revision = state.claimed_evidence_revision
    and attempts.input_fingerprint = state.claimed_input_fingerprint
  for update of attempts;
  if not found then return false; end if;
  has_newer_request := state.requested_generation > state.claimed_generation
    or state.current_evidence_revision is distinct from state.claimed_evidence_revision
    or state.current_input_fingerprint is distinct from state.claimed_input_fingerprint;
  update public.ai_call_attempts as attempts
  set status = case when p_outcome = 'rejected' and attempts.provider_called then 'rejected' else 'failed' end,
    completed_at = now(), latency_ms = p_latency_ms, provider_latency_ms = p_provider_latency_ms,
    model_version = coalesce(nullif(p_model_version,''), attempts.model_version, attempts.model),
    provider_request_id = p_provider_request_id,
    input_tokens = p_input_tokens, output_tokens = p_output_tokens, total_tokens = p_total_tokens,
    usage_metadata = coalesce(p_usage_metadata, '{}'::jsonb),
    error_code = left(coalesce(p_error_code,'provider_error'),200),
    error_message = left(coalesce(p_error_message,'AI provider failed'),4000)
  where id = p_call_attempt_id;
  update public.story_ai_state set enrichment_status = case when has_newer_request then 'pending' else 'failed' end,
    enrichment_error_code = left(coalesce(p_error_code,'provider_error'),200),
    enrichment_error = left(coalesce(p_error_message,'AI provider failed'),4000),
    next_attempt_at = case when has_newer_request then now() else now() + make_interval(secs => least(3600, 60 * greatest(1, attempt_count))) end,
    lease_token = null, lease_owner = null, lease_expires_at = null,
    claimed_generation = null, claimed_evidence_revision = null, claimed_input_fingerprint = null, updated_at = now()
  where story_id = p_story_id;
  return true;
end;
$$;

create or replace function public.expire_story_analysis_attempts(
  p_story_id uuid,
  p_operation_type text
) returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  expired_count integer;
begin
  update public.ai_call_attempts as attempts
  set status = 'failed', completed_at = now(), error_code = 'lease_expired',
      error_message = 'AI analysis worker lease expired before completion',
      latency_ms = greatest(0, floor(extract(epoch from (now() - attempts.started_at)) * 1000))::bigint,
      lease_token = null, lease_owner = null, lease_expires_at = null
  where attempts.story_id = p_story_id and attempts.operation_type = p_operation_type
    and attempts.status = 'running' and attempts.lease_expires_at < now();
  get diagnostics expired_count = row_count;
  return expired_count;
end;
$$;

create or replace function public.expire_stale_story_analysis_attempts(
  p_limit integer default 100
) returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  expired_count integer;
begin
  with stale as (
    select attempts.id
    from public.ai_call_attempts as attempts
    where attempts.operation_type <> 'enrich_story'
      and attempts.status = 'running'
      and attempts.lease_expires_at < now()
    order by attempts.lease_expires_at, attempts.id
    for update of attempts skip locked
    limit least(1000, greatest(0, p_limit))
  )
  update public.ai_call_attempts as attempts
  set status = 'failed', completed_at = now(), error_code = 'lease_expired',
      error_message = 'AI analysis worker lease expired before completion',
      latency_ms = greatest(0, floor(extract(epoch from (now() - attempts.started_at)) * 1000))::bigint,
      lease_token = null, lease_owner = null, lease_expires_at = null
  from stale
  where attempts.id = stale.id;
  get diagnostics expired_count = row_count;
  return expired_count;
end;
$$;

create or replace function public.supersede_story_analysis_attempt(
  p_call_attempt_id uuid,
  p_replacement_cache_key text
) returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  attempt public.ai_call_attempts;
  attempt_story_id uuid;
begin
  select attempts.story_id into attempt_story_id
  from public.ai_call_attempts as attempts
  where attempts.id = p_call_attempt_id;
  if attempt_story_id is null then return false; end if;
  perform 1 from public.stories as stories where stories.id = attempt_story_id for update of stories;
  select attempts.* into attempt
  from public.ai_call_attempts as attempts
  where attempts.id = p_call_attempt_id
  for update of attempts;
  if attempt.id is null or attempt.operation_type = 'enrich_story'
    or (attempt.status <> 'queued' and not (attempt.status = 'running' and not attempt.provider_called))
    or attempt.cache_key is not distinct from p_replacement_cache_key then
    return false;
  end if;
  update public.ai_call_attempts as attempts
  set status = 'skipped', completed_at = now(),
      latency_ms = greatest(0, floor(extract(epoch from (now() - attempts.started_at)) * 1000))::bigint,
      error_code = 'superseded', error_message = 'A newer editor analysis request replaced this queued identity',
      lease_token = null, lease_owner = null, lease_expires_at = null
  where attempts.id = p_call_attempt_id;
  return true;
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
    raise exception 'Story evidence changed while AI input was prepared' using errcode = '40001';
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

create or replace function public.claim_story_analysis_attempt(
  p_call_attempt_id uuid,
  p_worker text,
  p_enrichment_version text,
  p_provider text,
  p_model text,
  p_schema_version text,
  p_prompt_version text,
  p_lease_seconds integer default 180
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  attempt public.ai_call_attempts;
  attempt_story_id uuid;
begin
  if nullif(btrim(p_enrichment_version),'') is null
    or nullif(btrim(p_provider),'') is null or nullif(btrim(p_model),'') is null
    or nullif(btrim(p_schema_version),'') is null or nullif(btrim(p_prompt_version),'') is null then
    raise exception 'Expected AI analysis identity is required' using errcode = '22023';
  end if;
  select attempts.story_id into attempt_story_id
  from public.ai_call_attempts as attempts
  where attempts.id = p_call_attempt_id;
  if attempt_story_id is null then return null; end if;
  perform 1 from public.stories as stories where stories.id = attempt_story_id for update of stories;
  select attempts.* into attempt
  from public.ai_call_attempts as attempts
  where attempts.id = p_call_attempt_id
  for update of attempts;
  if attempt.id is null or attempt.operation_type = 'enrich_story' then
    return null;
  end if;
  if attempt.enrichment_version is distinct from p_enrichment_version
    or attempt.provider is distinct from p_provider or attempt.model is distinct from p_model
    or attempt.schema_version is distinct from p_schema_version
    or attempt.prompt_version is distinct from p_prompt_version then
    return null;
  end if;
  if attempt.status = 'running' and attempt.lease_expires_at < now() then
    update public.ai_call_attempts as attempts
    set status = 'failed', completed_at = now(), error_code = 'lease_expired',
        error_message = 'AI analysis worker lease expired before completion',
        latency_ms = greatest(0, floor(extract(epoch from (now() - attempts.started_at)) * 1000))::bigint,
        lease_token = null, lease_owner = null, lease_expires_at = null
    where attempts.id = p_call_attempt_id;
    return null;
  end if;
  if attempt.status <> 'queued' then
    return null;
  end if;
  if exists (
    select 1 from public.ai_call_attempts as running
    where running.story_id = attempt.story_id and running.operation_type = attempt.operation_type
      and running.status = 'running' and running.id <> attempt.id
  ) then
    return null;
  end if;
  update public.ai_call_attempts as attempts
  set status = 'running',
      lease_token = gen_random_uuid(), lease_owner = left(coalesce(p_worker,'analysis-worker'),300),
      lease_expires_at = now() + make_interval(secs => least(600, greatest(30, p_lease_seconds)))
  where attempts.id = p_call_attempt_id
  returning attempts.* into attempt;
  return to_jsonb(attempt);
end;
$$;

create or replace function public.begin_story_analysis_provider_call(
  p_call_attempt_id uuid,
  p_lease_token uuid
) returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  attempt_story_id uuid;
  live_evidence_revision bigint;
  changed_count integer;
begin
  select attempts.story_id into attempt_story_id
  from public.ai_call_attempts as attempts
  where attempts.id = p_call_attempt_id;
  if attempt_story_id is null then return false; end if;
  select stories.evidence_revision into live_evidence_revision
  from public.stories as stories
  where stories.id = attempt_story_id and stories.status <> 'merged'
  for update of stories;
  if live_evidence_revision is null then return false; end if;
  update public.ai_call_attempts as attempts
  set provider_called = true, provider_started_at = coalesce(attempts.provider_started_at, now())
  where attempts.id = p_call_attempt_id
    and attempts.operation_type <> 'enrich_story'
    and attempts.status = 'running'
    and attempts.lease_token = p_lease_token
    and attempts.lease_expires_at > now()
    and attempts.evidence_revision = live_evidence_revision
    and not attempts.provider_called;
  get diagnostics changed_count = row_count;
  if changed_count = 1 then return true; end if;
  return exists (
    select 1 from public.ai_call_attempts as attempts
    where attempts.id = p_call_attempt_id
      and attempts.operation_type <> 'enrich_story'
      and attempts.status = 'running'
      and attempts.provider_called
      and attempts.lease_token = p_lease_token
      and attempts.lease_expires_at > now()
      and attempts.evidence_revision = live_evidence_revision
  );
end;
$$;

create or replace function public.complete_story_analysis(
  p_story_id uuid,
  p_operation_type text,
  p_call_attempt_id uuid,
  p_lease_token uuid,
  p_input_fingerprint text,
  p_result jsonb,
  p_model_version text,
  p_provider_request_id text,
  p_latency_ms bigint,
  p_provider_latency_ms bigint,
  p_input_tokens bigint,
  p_output_tokens bigint,
  p_total_tokens bigint,
  p_usage_metadata jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  attempt public.ai_call_attempts;
  analysis public.story_analyses;
  live_evidence_revision bigint;
  has_newer_request boolean;
begin
  select stories.evidence_revision into live_evidence_revision
  from public.stories as stories
  where stories.id = p_story_id and stories.status <> 'merged'
  for update of stories;
  if live_evidence_revision is null then
    raise exception 'Story is unavailable for AI analysis' using errcode = 'P0002';
  end if;
  perform 1
  from public.story_ai_state as states
  where states.story_id = p_story_id
  for update of states;
  select attempts.* into attempt
  from public.ai_call_attempts as attempts
  where attempts.id = p_call_attempt_id
    and attempts.story_id = p_story_id
    and attempts.operation_type = p_operation_type
    and attempts.status = 'running'
    and attempts.provider_called
    and attempts.lease_token = p_lease_token
    and attempts.lease_expires_at > now()
  for update of attempts;
  if attempt.id is null then
    raise exception 'AI analysis lease is no longer valid' using errcode = '55000';
  end if;
  if attempt.input_fingerprint is distinct from p_input_fingerprint or jsonb_typeof(p_result) <> 'object' then
    raise exception 'AI analysis output identity is invalid' using errcode = '22023';
  end if;
  select coalesce((
    select newer.cache_key is distinct from attempt.cache_key
    from public.ai_call_attempts as newer
    where newer.story_id = p_story_id
      and newer.operation_type = p_operation_type
      and newer.request_sequence > attempt.request_sequence
      and not (newer.status = 'skipped' and newer.error_code = 'superseded')
    order by newer.request_sequence desc
    limit 1
  ), false) into has_newer_request;
  if attempt.evidence_revision is distinct from live_evidence_revision
    or has_newer_request then
    update public.ai_call_attempts as attempts
    set status = 'skipped', completed_at = now(),
        model_version = coalesce(nullif(p_model_version,''), attempts.model),
        provider_request_id = p_provider_request_id, latency_ms = p_latency_ms,
        provider_latency_ms = p_provider_latency_ms, input_tokens = p_input_tokens,
        output_tokens = p_output_tokens, total_tokens = p_total_tokens,
        usage_metadata = coalesce(p_usage_metadata, '{}'::jsonb),
        error_code = 'superseded', error_message = 'Story evidence or analysis identity changed during the provider call',
        lease_token = null, lease_owner = null, lease_expires_at = null
    where attempts.id = p_call_attempt_id;
    return null;
  end if;

  update public.story_analyses as analyses
  set is_current = false
  where analyses.story_id = p_story_id
    and analyses.operation_type = p_operation_type
    and analyses.is_current;
  insert into public.story_analyses (
    story_id, operation_type, evidence_revision, input_fingerprint, cache_key, enrichment_version, result, provider, model, model_version,
    schema_version, prompt_version, ai_call_attempt_id, requested_by
  ) values (
    p_story_id, p_operation_type, attempt.evidence_revision, p_input_fingerprint, attempt.cache_key, attempt.enrichment_version, p_result, attempt.provider,
    attempt.model, coalesce(nullif(p_model_version,''), attempt.model), attempt.schema_version,
    attempt.prompt_version, p_call_attempt_id, attempt.requested_by
  ) returning * into analysis;

  update public.ai_call_attempts as attempts
  set status = 'succeeded', completed_at = now(), model_version = coalesce(nullif(p_model_version,''), attempts.model),
      provider_request_id = p_provider_request_id, latency_ms = p_latency_ms,
      provider_latency_ms = p_provider_latency_ms, input_tokens = p_input_tokens,
      output_tokens = p_output_tokens, total_tokens = p_total_tokens,
      usage_metadata = coalesce(p_usage_metadata, '{}'::jsonb),
      lease_token = null, lease_owner = null, lease_expires_at = null
  where attempts.id = p_call_attempt_id;
  return to_jsonb(analysis);
end;
$$;

create or replace function public.fail_story_analysis_attempt(
  p_call_attempt_id uuid,
  p_lease_token uuid,
  p_outcome text,
  p_error_code text,
  p_error_message text,
  p_latency_ms bigint,
  p_provider_latency_ms bigint,
  p_model_version text,
  p_provider_request_id text,
  p_input_tokens bigint,
  p_output_tokens bigint,
  p_total_tokens bigint,
  p_usage_metadata jsonb
) returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  attempt public.ai_call_attempts;
begin
  select attempts.* into attempt
  from public.ai_call_attempts as attempts
  where attempts.id = p_call_attempt_id
  for update of attempts;
  if attempt.id is null or attempt.status <> 'running' or attempt.lease_token is distinct from p_lease_token then
    return false;
  end if;
  update public.ai_call_attempts as attempts
  set status = case when p_outcome = 'rejected' and attempts.provider_called then 'rejected' else 'failed' end,
      completed_at = now(), latency_ms = p_latency_ms,
      provider_latency_ms = p_provider_latency_ms,
      model_version = coalesce(nullif(p_model_version,''), attempts.model_version, attempts.model),
      provider_request_id = p_provider_request_id,
      input_tokens = p_input_tokens, output_tokens = p_output_tokens, total_tokens = p_total_tokens,
      usage_metadata = coalesce(p_usage_metadata, '{}'::jsonb),
      error_code = left(coalesce(p_error_code,'provider_error'),200),
      error_message = left(coalesce(p_error_message,'AI analysis provider failed'),4000),
      lease_token = null, lease_owner = null, lease_expires_at = null
  where attempts.id = p_call_attempt_id;
  return true;
end;
$$;

alter table public.story_ai_state enable row level security;
alter table public.ai_call_attempts enable row level security;
alter table public.story_analyses enable row level security;

revoke all on table public.story_ai_state, public.ai_call_attempts, public.story_analyses from public, anon, authenticated, service_role;
grant select, insert, update on table public.story_ai_state, public.ai_call_attempts, public.story_analyses to service_role;

revoke all on function public.bump_story_evidence_revision() from public, anon, authenticated;
revoke all on function public.bump_related_story_evidence_revision() from public, anon, authenticated;
revoke all on function public.bump_source_item_story_evidence_revision() from public, anon, authenticated;
revoke all on function public.bump_source_story_evidence_revision() from public, anon, authenticated;
revoke all on function public.request_story_ai_enrichment(uuid,bigint,text,text,text,text,text,text,text,integer,text,text,boolean,timestamptz) from public, anon, authenticated;
revoke all on function public.list_story_ai_revision_mismatches(integer,timestamptz) from public, anon, authenticated;
revoke all on function public.expire_stale_story_ai_enrichments(integer) from public, anon, authenticated;
revoke all on function public.claim_story_ai_enrichments(integer,text,text,text,text,text,text,integer) from public, anon, authenticated;
revoke all on function public.claim_story_ai_enrichment(uuid,text,text,text,text,text,text,integer) from public, anon, authenticated;
revoke all on function public.create_story_ai_call_attempt(uuid,uuid,uuid,uuid) from public, anon, authenticated;
revoke all on function public.begin_story_ai_provider_call(uuid,uuid,uuid) from public, anon, authenticated;
revoke all on function public.record_story_ai_enrichment_cache_hit(uuid,bigint,text,text,text) from public, anon, authenticated;
revoke all on function public.complete_story_ai_enrichment(uuid,uuid,uuid,jsonb,text,text,bigint,bigint,bigint,bigint,bigint,jsonb) from public, anon, authenticated;
revoke all on function public.release_story_ai_enrichment_claim(uuid,uuid,text,text) from public, anon, authenticated;
revoke all on function public.fail_story_ai_enrichment(uuid,uuid,uuid,text,text,text,bigint,bigint,text,text,bigint,bigint,bigint,jsonb) from public, anon, authenticated;
revoke all on function public.expire_story_analysis_attempts(uuid,text) from public, anon, authenticated;
revoke all on function public.expire_stale_story_analysis_attempts(integer) from public, anon, authenticated;
revoke all on function public.supersede_story_analysis_attempt(uuid,text) from public, anon, authenticated;
revoke all on function public.request_story_analysis_attempt(uuid,bigint,text,text,text,text,text,text,text,text,text,text) from public, anon, authenticated;
revoke all on function public.claim_story_analysis_attempt(uuid,text,text,text,text,text,text,integer) from public, anon, authenticated;
revoke all on function public.begin_story_analysis_provider_call(uuid,uuid) from public, anon, authenticated;
revoke all on function public.complete_story_analysis(uuid,text,uuid,uuid,text,jsonb,text,text,bigint,bigint,bigint,bigint,bigint,jsonb) from public, anon, authenticated;
revoke all on function public.fail_story_analysis_attempt(uuid,uuid,text,text,text,bigint,bigint,text,text,bigint,bigint,bigint,jsonb) from public, anon, authenticated;
grant execute on function public.bump_story_evidence_revision() to service_role;
grant execute on function public.bump_related_story_evidence_revision() to service_role;
grant execute on function public.bump_source_item_story_evidence_revision() to service_role;
grant execute on function public.bump_source_story_evidence_revision() to service_role;
grant execute on function public.request_story_ai_enrichment(uuid,bigint,text,text,text,text,text,text,text,integer,text,text,boolean,timestamptz) to service_role;
grant execute on function public.list_story_ai_revision_mismatches(integer,timestamptz) to service_role;
grant execute on function public.expire_stale_story_ai_enrichments(integer) to service_role;
grant execute on function public.claim_story_ai_enrichments(integer,text,text,text,text,text,text,integer) to service_role;
grant execute on function public.claim_story_ai_enrichment(uuid,text,text,text,text,text,text,integer) to service_role;
grant execute on function public.create_story_ai_call_attempt(uuid,uuid,uuid,uuid) to service_role;
grant execute on function public.begin_story_ai_provider_call(uuid,uuid,uuid) to service_role;
grant execute on function public.record_story_ai_enrichment_cache_hit(uuid,bigint,text,text,text) to service_role;
grant execute on function public.complete_story_ai_enrichment(uuid,uuid,uuid,jsonb,text,text,bigint,bigint,bigint,bigint,bigint,jsonb) to service_role;
grant execute on function public.release_story_ai_enrichment_claim(uuid,uuid,text,text) to service_role;
grant execute on function public.fail_story_ai_enrichment(uuid,uuid,uuid,text,text,text,bigint,bigint,text,text,bigint,bigint,bigint,jsonb) to service_role;
grant execute on function public.expire_story_analysis_attempts(uuid,text) to service_role;
grant execute on function public.expire_stale_story_analysis_attempts(integer) to service_role;
grant execute on function public.supersede_story_analysis_attempt(uuid,text) to service_role;
grant execute on function public.request_story_analysis_attempt(uuid,bigint,text,text,text,text,text,text,text,text,text,text) to service_role;
grant execute on function public.claim_story_analysis_attempt(uuid,text,text,text,text,text,text,integer) to service_role;
grant execute on function public.begin_story_analysis_provider_call(uuid,uuid) to service_role;
grant execute on function public.complete_story_analysis(uuid,text,uuid,uuid,text,jsonb,text,text,bigint,bigint,bigint,bigint,bigint,jsonb) to service_role;
grant execute on function public.fail_story_analysis_attempt(uuid,uuid,text,text,text,bigint,bigint,text,text,bigint,bigint,bigint,jsonb) to service_role;

comment on table public.story_ai_state is 'Lease-safe material-change gate for optional story-level AI enrichment.';
comment on table public.ai_call_attempts is 'Append-only cost, latency, cache, and failure ledger for optional AI operations.';
comment on table public.story_analyses is 'Editor-requested deep analysis only; never an automatic publication surface.';

commit;
