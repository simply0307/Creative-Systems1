create table if not exists public.creative_os_runtime_contract (
  id text primary key,
  schema_contract_version integer not null check (schema_contract_version > 0),
  mutation_authority text not null check (length(btrim(mutation_authority)) > 0),
  production_project_ref text not null check (production_project_ref ~ '^[a-z0-9]{20}$'),
  required_storage_buckets text[] not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint creative_os_runtime_contract_singleton check (id = 'creative-os'),
  constraint creative_os_runtime_contract_required_buckets check (
    required_storage_buckets @> array['artifacts','exports','imports-raw','imports-processed','thumbnails']::text[]
    and cardinality(required_storage_buckets) = 5
  )
);

alter table public.creative_os_runtime_contract enable row level security;

revoke all on table public.creative_os_runtime_contract from public, anon, authenticated;
grant select on table public.creative_os_runtime_contract to service_role;

create policy "Service role reads Creative OS runtime contract"
on public.creative_os_runtime_contract
for select
to service_role
using (true);

comment on table public.creative_os_runtime_contract is
  'Singleton compatibility contract required before the Creative OS API may become ready or mutate canonical state.';

insert into public.creative_os_runtime_contract (
  id,
  schema_contract_version,
  mutation_authority,
  production_project_ref,
  required_storage_buckets,
  metadata
)
values (
  'creative-os',
  1,
  'creative-os-api',
  'okqkljexfzolzxysjaha',
  array['artifacts','exports','imports-raw','imports-processed','thumbnails']::text[],
  jsonb_build_object(
    'contract', 'creative-os-runtime',
    'migration', '20260807101623_establish_runtime_contract',
    'created_by', 'repository-migration'
  )
)
on conflict (id) do nothing;

do $$
begin
  if not exists (
    select 1
    from public.creative_os_runtime_contract
    where id = 'creative-os'
      and schema_contract_version = 1
      and mutation_authority = 'creative-os-api'
      and production_project_ref = 'okqkljexfzolzxysjaha'
      and required_storage_buckets = array['artifacts','exports','imports-raw','imports-processed','thumbnails']::text[]
  ) then
    raise exception 'Existing Creative OS runtime contract conflicts with version 1';
  end if;
end;
$$;
