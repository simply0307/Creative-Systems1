-- The currently published Netlify deploy cannot be replaced while production
-- deploys are paused for account-credit exhaustion. Its legacy scheduled
-- function may still invoke this RPC, so enforce manual-only operation at the
-- canonical database admission boundary as defense in depth.
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

  insert into public.ingestion_runs (trigger_type, triggered_by)
  values (p_trigger_type, nullif(left(coalesce(p_triggered_by, ''), 300), ''))
  returning * into started;
  return jsonb_build_object('admitted', true, 'run', to_jsonb(started));
end;
$$;

revoke all on function public.start_ingestion_run(text,text,integer)
  from public, anon, authenticated;
grant execute on function public.start_ingestion_run(text,text,integer)
  to service_role;

comment on function public.start_ingestion_run(text,text,integer) is
  'Single-flight ingestion admission. Scheduled triggers are rejected; only explicit manual and acceptance-test runs may be admitted.';
