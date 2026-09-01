-- Reath ingestion is editor initiated. Remove every Reath-owned automatic job
-- and its now-unneeded cron history while leaving unrelated project jobs alone.
do $$
declare
  reath_job_ids bigint[];
  reath_job_id bigint;
begin
  select coalesce(array_agg(jobid), '{}'::bigint[])
  into reath_job_ids
  from cron.job
  where jobname in ('reath-edge-ingest-half-hourly', 'reath-edge-reconcile-six-hourly');

  foreach reath_job_id in array reath_job_ids
  loop
    perform cron.unschedule(reath_job_id);
  end loop;

  delete from cron.job_run_details
  where jobid = any(reath_job_ids);
end
$$;

-- This maintenance RPC is invoked by the protected manual-ingestion worker
-- before it polls providers. It removes only unprocessed, unlinked evidence
-- older than the requested retention window. Published evidence and Story
-- provenance are never deleted.
create function public.run_manual_ingestion_maintenance(
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
  where item.processing_status in ('pending', 'error')
    and coalesce(item.published_at, item.discovered_at, item.created_at) < cutoff_at
    and not exists (
      select 1
      from public.story_sources as link
      where link.source_item_id = item.id
    );
  get diagnostics aged_backlog_deleted = row_count;

  -- These checks should remain zero because the table's canonical URL,
  -- source/GUID, and source/content-hash uniqueness constraints are the final
  -- race guards. Report the invariant on every manual run rather than deleting
  -- cross-publisher corroboration that happens to share syndicated text.
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

revoke all on function public.run_manual_ingestion_maintenance(integer)
  from public, anon, authenticated;
grant execute on function public.run_manual_ingestion_maintenance(integer)
  to service_role;

comment on function public.run_manual_ingestion_maintenance(integer) is
  'Manual-ingestion preflight: releases stale claims and deletes only unlinked processing backlog older than the retention window.';
