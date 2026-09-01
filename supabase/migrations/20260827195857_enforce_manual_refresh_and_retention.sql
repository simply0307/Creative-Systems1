-- Keep the retention rule at the database boundary so the currently published
-- manual worker receives it even before Netlify deploy credits reset.
create or replace function public.run_manual_ingestion_maintenance(
  p_retention_days integer default 30
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  cutoff_at timestamptz;
  stale_claims_released integer := 0;
  aged_backlog_deleted integer := 0;
  exact_article_duplicates integer := 0;
begin
  if p_retention_days < 30 or p_retention_days > 365 then
    raise exception 'Manual-ingestion retention must be between 30 and 365 days'
      using errcode = '22023';
  end if;

  cutoff_at := now() - make_interval(days => p_retention_days);

  update public.source_items as item
  set processing_status = 'error',
      processing_error = 'Stale processing claim released by manual ingestion',
      processing_token = null,
      processing_started_at = null,
      updated_at = now()
  where item.processing_status = 'processing'
    and coalesce(item.processing_started_at, item.updated_at) < now() - interval '20 minutes';
  get diagnostics stale_claims_released = row_count;

  delete from public.source_items as item
  where item.processing_status in ('pending', 'error', 'ignored')
    and coalesce(item.published_at, item.discovered_at, item.created_at) < cutoff_at
    and not exists (
      select 1
      from public.story_sources as link
      where link.source_item_id = item.id
    );
  get diagnostics aged_backlog_deleted = row_count;

  select coalesce(sum(duplicate_count - 1), 0)::integer
  into exact_article_duplicates
  from (
    select count(*)::integer as duplicate_count
    from public.source_items
    group by canonical_url
    having count(*) > 1
  ) as duplicates;

  return jsonb_build_object(
    'retention_days', p_retention_days,
    'cutoff_at', cutoff_at,
    'stale_claims_released', stale_claims_released,
    'aged_backlog_deleted', aged_backlog_deleted,
    'exact_article_duplicates', exact_article_duplicates
  );
end;
$$;

create function public.enforce_source_item_retention()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.published_at is not null
     and new.published_at < now() - interval '30 days' then
    new.processing_status := 'ignored';
    new.processing_error := 'Outside the 30-day manual-ingestion window';
    new.raw_metadata := coalesce(new.raw_metadata, '{}'::jsonb)
      || jsonb_build_object('retention_ignored', true, 'retention_days', 30);
  end if;
  return new;
end;
$$;

drop trigger if exists source_items_manual_retention on public.source_items;
create trigger source_items_manual_retention
before insert on public.source_items
for each row execute function public.enforce_source_item_retention();

revoke all on function public.enforce_source_item_retention()
  from public, anon, authenticated;
grant execute on function public.enforce_source_item_retention()
  to service_role;

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
  maintenance jsonb := null;
begin
  if p_trigger_type not in ('scheduled','manual','acceptance_test') then
    raise exception 'Invalid ingestion trigger type' using errcode = '22023';
  end if;
  if p_trigger_type = 'scheduled' then
    return jsonb_build_object(
      'admitted', false,
      'run', null,
      'reason', 'manual_only'
    );
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
    return jsonb_build_object('admitted', false, 'run', to_jsonb(active), 'reason', 'already_running');
  end if;

  if p_trigger_type = 'manual' then
    maintenance := public.run_manual_ingestion_maintenance(30);
    update public.sources as source
    set last_checked_at = null
    where source.active;
  end if;

  insert into public.ingestion_runs (trigger_type, triggered_by)
  values (p_trigger_type, nullif(left(coalesce(p_triggered_by, ''), 300), ''))
  returning * into started;
  return jsonb_build_object(
    'admitted', true,
    'run', to_jsonb(started),
    'maintenance', maintenance
  );
end;
$$;

revoke all on function public.run_manual_ingestion_maintenance(integer)
  from public, anon, authenticated;
grant execute on function public.run_manual_ingestion_maintenance(integer)
  to service_role;
revoke all on function public.start_ingestion_run(text,text,integer)
  from public, anon, authenticated;
grant execute on function public.start_ingestion_run(text,text,integer)
  to service_role;

comment on function public.enforce_source_item_retention() is
  'Marks feed evidence published outside the 30-day manual window ignored before processing.';
comment on function public.start_ingestion_run(text,text,integer) is
  'Manual-only admission: runs retention maintenance and makes every active Source due before admitting the editor-initiated worker.';
