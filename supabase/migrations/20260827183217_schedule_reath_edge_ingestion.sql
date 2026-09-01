-- Keep the deterministic ingester on Supabase's free operating path. The
-- function remains private behind a separately provisioned schedule token in
-- both Edge Function secrets and Vault; no credential is committed here.
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

do $$
declare
  existing_job record;
begin
  for existing_job in
    select jobid
    from cron.job
    where jobname in ('reath-edge-ingest-half-hourly', 'reath-edge-reconcile-six-hourly')
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;
end
$$;

select cron.schedule(
  'reath-edge-ingest-half-hourly',
  '*/30 * * * *',
  $schedule$
    select net.http_post(
      url := 'https://okqkljexfzolzxysjaha.supabase.co/functions/v1/reath-ingest',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-reath-schedule-token', (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'reath_edge_schedule_token_v1'
        )
      ),
      body := jsonb_build_object('mode', 'ingest'),
      timeout_milliseconds := 140000
    ) as request_id;
  $schedule$
);

select cron.schedule(
  'reath-edge-reconcile-six-hourly',
  '17 */6 * * *',
  $schedule$
    select net.http_post(
      url := 'https://okqkljexfzolzxysjaha.supabase.co/functions/v1/reath-ingest',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-reath-schedule-token', (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'reath_edge_schedule_token_v1'
        )
      ),
      body := jsonb_build_object('mode', 'reconcile'),
      timeout_milliseconds := 140000
    ) as request_id;
  $schedule$
);
