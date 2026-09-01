-- Rebuild the explicitly disposable Creative OS application schema as the
-- Reath Digest News Ingester. Supabase-managed schemas are intentionally left
-- intact. Project authority: okqkljexfzolzxysjaha only.

drop schema if exists public cascade;
create schema public;

grant usage on schema public to postgres, anon, authenticated, service_role;
grant all on schema public to postgres, service_role;
alter default privileges in schema public revoke all on tables from public, anon, authenticated;
alter default privileges in schema public revoke all on sequences from public, anon, authenticated;
alter default privileges in schema public revoke all on functions from public, anon, authenticated;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant execute on functions to service_role;

create extension if not exists pgcrypto with schema extensions;

create function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.counties (
  id smallint primary key,
  state_code char(2) not null default 'NJ' check (state_code = 'NJ'),
  name text not null unique,
  slug text not null unique,
  fips_code char(3) not null unique,
  treasury_code char(2) not null unique,
  created_at timestamptz not null default now()
);

create table public.municipalities (
  id uuid primary key default gen_random_uuid(),
  county_id smallint not null references public.counties(id),
  name text not null,
  slug text not null,
  municipality_type text not null default 'other' check (municipality_type in ('borough','city','town','township','village','other')),
  aliases text[] not null default '{}',
  treasury_code char(4) not null unique,
  census_geoid char(11) not null unique,
  gnis_code text,
  legislative_districts smallint[] not null default '{}',
  local_code text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (county_id, slug)
);

create table public.sources (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  source_type text not null check (source_type in ('journalism','government','municipality','courts','legislature','transit','emergency','culture','business','other')),
  homepage_url text not null,
  feed_url text not null unique,
  ingestion_method text not null default 'rss' check (ingestion_method in ('rss','atom','api','html')),
  scope text not null default 'state' check (scope in ('state','county','municipality')),
  county_id smallint references public.counties(id),
  municipality_id uuid references public.municipalities(id),
  topics text[] not null default '{}',
  priority smallint not null default 50 check (priority between 0 and 100),
  poll_interval_minutes integer not null default 30 check (poll_interval_minutes between 5 and 10080),
  last_checked_at timestamptz,
  last_success_at timestamptz,
  last_error_at timestamptz,
  last_error text,
  failure_streak integer not null default 0 check (failure_streak >= 0),
  recent_item_count integer not null default 0 check (recent_item_count >= 0),
  active boolean not null default true,
  rights_notes text not null default '',
  editorial_notes text not null default '',
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((scope <> 'county') or county_id is not null),
  check ((scope <> 'municipality') or municipality_id is not null)
);

create table public.source_items (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.sources(id) on delete restrict,
  external_guid text,
  url text not null,
  canonical_url text not null unique,
  headline text not null,
  normalized_headline text not null,
  description text not null default '',
  author text,
  publisher text not null,
  published_at timestamptz,
  discovered_at timestamptz not null default now(),
  raw_metadata jsonb not null default '{}'::jsonb,
  content_hash char(64) not null,
  processing_status text not null default 'pending' check (processing_status in ('pending','processed','error','ignored')),
  processing_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_id, content_hash)
);
create unique index source_items_source_guid_unique
  on public.source_items(source_id, external_guid)
  where external_guid is not null and btrim(external_guid) <> '';

create table public.stories (
  id uuid primary key default gen_random_uuid(),
  canonical_title text not null,
  summary_internal text not null default '',
  why_it_may_matter text not null default '',
  disputed_or_different text not null default '',
  unknowns text not null default '',
  status text not null default 'developing' check (status in ('developing','dormant','closed','merged')),
  merged_into_story_id uuid references public.stories(id),
  first_seen_at timestamptz not null,
  last_activity_at timestamptz not null,
  event_date date,
  scope text not null default 'state' check (scope in ('state','regional','county','municipality','unknown')),
  confidence numeric(4,3) not null default 0.5 check (confidence between 0 and 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (merged_into_story_id is null or merged_into_story_id <> id),
  check ((status = 'merged') = (merged_into_story_id is not null))
);

create table public.story_sources (
  story_id uuid not null references public.stories(id) on delete cascade,
  source_item_id uuid not null references public.source_items(id) on delete restrict,
  link_method text not null check (link_method in ('created','deterministic','semantic','editor_merge','editor_attach')),
  confidence numeric(4,3) not null check (confidence between 0 and 1),
  signals jsonb not null default '{}'::jsonb,
  attached_at timestamptz not null default now(),
  attached_by text not null default 'system',
  detached_at timestamptz,
  detached_by text,
  detach_reason text,
  primary key (story_id, source_item_id)
);
create unique index story_sources_active_source_unique
  on public.story_sources(source_item_id)
  where detached_at is null;

create table public.story_counties (
  story_id uuid not null references public.stories(id) on delete cascade,
  county_id smallint not null references public.counties(id),
  confidence numeric(4,3) not null default 1 check (confidence between 0 and 1),
  source text not null default 'deterministic',
  created_at timestamptz not null default now(),
  primary key (story_id, county_id)
);

create table public.story_municipalities (
  story_id uuid not null references public.stories(id) on delete cascade,
  municipality_id uuid not null references public.municipalities(id),
  confidence numeric(4,3) not null default 1 check (confidence between 0 and 1),
  source text not null default 'deterministic',
  created_at timestamptz not null default now(),
  primary key (story_id, municipality_id)
);

create table public.story_enrichments (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references public.stories(id) on delete cascade,
  nj_relevance smallint not null check (nj_relevance between 0 and 100),
  scope text not null check (scope in ('state','regional','county','municipality','unknown')),
  counties text[] not null default '{}',
  municipalities text[] not null default '{}',
  topics text[] not null default '{}',
  people text[] not null default '{}',
  organizations text[] not null default '{}',
  event_type text not null default 'other',
  event_date date,
  public_impact smallint not null check (public_impact between 0 and 100),
  civic_utility smallint not null check (civic_utility between 0 and 100),
  novelty smallint not null check (novelty between 0 and 100),
  human_interest smallint not null check (human_interest between 0 and 100),
  emotional_register text not null default 'neutral',
  reath_potential smallint not null check (reath_potential between 0 and 100),
  satire_potential smallint not null check (satire_potential between 0 and 100),
  confidence numeric(4,3) not null check (confidence between 0 and 1),
  provider text not null,
  model text not null,
  model_version text not null,
  schema_version text not null,
  raw_output jsonb not null,
  is_current boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index story_enrichments_current_unique
  on public.story_enrichments(story_id)
  where is_current;

create table public.story_scores (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references public.stories(id) on delete cascade,
  local_impact smallint not null check (local_impact between 0 and 100),
  civic_utility smallint not null check (civic_utility between 0 and 100),
  significance smallint not null check (significance between 0 and 100),
  momentum smallint not null check (momentum between 0 and 100),
  novelty smallint not null check (novelty between 0 and 100),
  human_interest smallint not null check (human_interest between 0 and 100),
  emotional_resonance smallint not null check (emotional_resonance between 0 and 100),
  reath_potential smallint not null check (reath_potential between 0 and 100),
  satire_potential smallint not null check (satire_potential between 0 and 100),
  locality smallint not null check (locality between 0 and 100),
  confidence smallint not null check (confidence between 0 and 100),
  reasons jsonb not null default '{}'::jsonb,
  provider text not null,
  model_version text not null,
  is_current boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index story_scores_current_unique
  on public.story_scores(story_id)
  where is_current;

create table public.editorial_queue (
  story_id uuid primary key references public.stories(id) on delete cascade,
  status text not null default 'new' check (status in ('new','watch','keep','ignore')),
  route text check (route in ('digest','civic_relay','funnies','longform')),
  decided_by text,
  decided_at timestamptz,
  routed_by text,
  routed_at timestamptz,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.editorial_decisions (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references public.stories(id) on delete restrict,
  actor_id text not null,
  actor_email text,
  actor_role text not null,
  action_type text not null check (action_type in ('status_change','route','merge','detach','attach','note')),
  from_value jsonb not null default '{}'::jsonb,
  to_value jsonb not null default '{}'::jsonb,
  reason text not null default '',
  created_at timestamptz not null default now()
);

create table public.ingestion_runs (
  id uuid primary key default gen_random_uuid(),
  trigger_type text not null check (trigger_type in ('scheduled','manual','acceptance_test')),
  triggered_by text,
  status text not null default 'running' check (status in ('running','succeeded','partial','failed')),
  sources_attempted integer not null default 0 check (sources_attempted >= 0),
  items_fetched integer not null default 0 check (items_fetched >= 0),
  items_inserted integer not null default 0 check (items_inserted >= 0),
  duplicates integer not null default 0 check (duplicates >= 0),
  errors integer not null default 0 check (errors >= 0),
  error_summary text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  duration_ms integer check (duration_ms is null or duration_ms >= 0)
);

create table public.source_run_results (
  id uuid primary key default gen_random_uuid(),
  ingestion_run_id uuid not null references public.ingestion_runs(id) on delete cascade,
  source_id uuid not null references public.sources(id) on delete restrict,
  status text not null check (status in ('succeeded','failed')),
  items_fetched integer not null default 0 check (items_fetched >= 0),
  items_inserted integer not null default 0 check (items_inserted >= 0),
  duplicates integer not null default 0 check (duplicates >= 0),
  errors integer not null default 0 check (errors >= 0),
  error_message text,
  duration_ms integer not null check (duration_ms >= 0),
  created_at timestamptz not null default now(),
  unique (ingestion_run_id, source_id)
);

create index sources_due_idx on public.sources(active, last_checked_at, priority desc);
create index sources_health_idx on public.sources(active, failure_streak desc, last_success_at);
create index source_items_source_published_idx on public.source_items(source_id, published_at desc);
create index source_items_processing_idx on public.source_items(processing_status, discovered_at);
create index source_items_headline_idx on public.source_items(normalized_headline);
create index stories_activity_idx on public.stories(status, last_activity_at desc);
create index stories_event_date_idx on public.stories(event_date desc) where event_date is not null;
create index story_sources_story_active_idx on public.story_sources(story_id, attached_at desc) where detached_at is null;
create index story_counties_county_idx on public.story_counties(county_id, story_id);
create index story_municipalities_municipality_idx on public.story_municipalities(municipality_id, story_id);
create index editorial_queue_status_idx on public.editorial_queue(status, updated_at desc);
create index editorial_queue_route_idx on public.editorial_queue(route, updated_at desc) where route is not null;
create index editorial_decisions_story_idx on public.editorial_decisions(story_id, created_at desc);
create index source_run_results_source_idx on public.source_run_results(source_id, created_at desc);

create trigger municipalities_set_updated_at before update on public.municipalities
  for each row execute function public.set_updated_at();
create trigger sources_set_updated_at before update on public.sources
  for each row execute function public.set_updated_at();
create trigger source_items_set_updated_at before update on public.source_items
  for each row execute function public.set_updated_at();
create trigger stories_set_updated_at before update on public.stories
  for each row execute function public.set_updated_at();
create trigger editorial_queue_set_updated_at before update on public.editorial_queue
  for each row execute function public.set_updated_at();

create function public.set_editorial_state(
  p_story_id uuid,
  p_status text,
  p_route text,
  p_notes text,
  p_actor_id text,
  p_actor_email text,
  p_actor_role text,
  p_reason text default ''
)
returns public.editorial_queue
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  before_row public.editorial_queue;
  after_row public.editorial_queue;
begin
  if p_status not in ('new','watch','keep','ignore') then
    raise exception 'Invalid editorial status';
  end if;
  if p_route is not null and p_route not in ('digest','civic_relay','funnies','longform') then
    raise exception 'Invalid editorial route';
  end if;

  select * into before_row from public.editorial_queue where story_id = p_story_id for update;
  if not found then raise exception 'Story queue row not found'; end if;

  update public.editorial_queue
  set status = p_status,
      route = p_route,
      notes = coalesce(p_notes, notes),
      decided_by = case when status is distinct from p_status then p_actor_id else decided_by end,
      decided_at = case when status is distinct from p_status then now() else decided_at end,
      routed_by = case when route is distinct from p_route then p_actor_id else routed_by end,
      routed_at = case when route is distinct from p_route then now() else routed_at end
  where story_id = p_story_id
  returning * into after_row;

  if before_row.status is distinct from after_row.status then
    insert into public.editorial_decisions (
      story_id, actor_id, actor_email, actor_role, action_type, from_value, to_value, reason
    ) values (
      p_story_id, p_actor_id, p_actor_email, p_actor_role, 'status_change',
      jsonb_build_object('status', before_row.status), jsonb_build_object('status', after_row.status), coalesce(p_reason, '')
    );
  end if;
  if before_row.route is distinct from after_row.route then
    insert into public.editorial_decisions (
      story_id, actor_id, actor_email, actor_role, action_type, from_value, to_value, reason
    ) values (
      p_story_id, p_actor_id, p_actor_email, p_actor_role, 'route',
      jsonb_build_object('route', before_row.route), jsonb_build_object('route', after_row.route), coalesce(p_reason, '')
    );
  end if;

  return after_row;
end;
$$;

create function public.merge_stories(
  p_target_story_id uuid,
  p_source_story_id uuid,
  p_actor_id text,
  p_actor_email text,
  p_actor_role text,
  p_reason text default ''
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  moved_count integer := 0;
  moved_source_ids uuid[] := '{}'::uuid[];
begin
  if p_target_story_id = p_source_story_id then raise exception 'Cannot merge a story into itself'; end if;
  perform 1 from public.stories where id = p_target_story_id and status <> 'merged' for update;
  if not found then raise exception 'Target story not found or already merged'; end if;
  perform 1 from public.stories where id = p_source_story_id and status <> 'merged' for update;
  if not found then raise exception 'Source story not found or already merged'; end if;

  select coalesce(array_agg(source_item_id), '{}'::uuid[]) into moved_source_ids
  from public.story_sources
  where story_id = p_source_story_id and detached_at is null;

  update public.story_sources
  set detached_at = now(), detached_by = p_actor_id, detach_reason = 'Merged into story ' || p_target_story_id::text
  where story_id = p_source_story_id and source_item_id = any(moved_source_ids);

  insert into public.story_sources (
    story_id, source_item_id, link_method, confidence, signals, attached_at, attached_by
  )
  select p_target_story_id, source_item_id, 'editor_merge', 1,
         signals || jsonb_build_object('merged_from_story_id', p_source_story_id), now(), p_actor_id
  from public.story_sources
  where story_id = p_source_story_id and source_item_id = any(moved_source_ids)
  on conflict (story_id, source_item_id) do update
  set detached_at = null,
      detached_by = null,
      detach_reason = null,
      link_method = 'editor_merge',
      confidence = 1,
      signals = story_sources.signals || excluded.signals,
      attached_at = now(),
      attached_by = p_actor_id;
  get diagnostics moved_count = row_count;

  insert into public.story_counties (story_id, county_id, confidence, source)
  select p_target_story_id, county_id, confidence, 'editor_merge'
  from public.story_counties where story_id = p_source_story_id
  on conflict (story_id, county_id) do update set confidence = greatest(story_counties.confidence, excluded.confidence);

  insert into public.story_municipalities (story_id, municipality_id, confidence, source)
  select p_target_story_id, municipality_id, confidence, 'editor_merge'
  from public.story_municipalities where story_id = p_source_story_id
  on conflict (story_id, municipality_id) do update set confidence = greatest(story_municipalities.confidence, excluded.confidence);

  update public.stories
  set last_activity_at = greatest(last_activity_at, (select last_activity_at from public.stories where id = p_source_story_id))
  where id = p_target_story_id;
  update public.stories set status = 'merged', merged_into_story_id = p_target_story_id where id = p_source_story_id;

  insert into public.editorial_decisions (
    story_id, actor_id, actor_email, actor_role, action_type, from_value, to_value, reason
  ) values (
    p_target_story_id, p_actor_id, p_actor_email, p_actor_role, 'merge',
    jsonb_build_object('source_story_id', p_source_story_id), jsonb_build_object('target_story_id', p_target_story_id), coalesce(p_reason, '')
  );

  return jsonb_build_object('target_story_id', p_target_story_id, 'source_story_id', p_source_story_id, 'source_links_moved', moved_count);
end;
$$;

create function public.detach_story_source(
  p_story_id uuid,
  p_source_item_id uuid,
  p_actor_id text,
  p_actor_email text,
  p_actor_role text,
  p_reason text
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'A detach reason is required'; end if;
  update public.story_sources
  set detached_at = now(), detached_by = p_actor_id, detach_reason = p_reason
  where story_id = p_story_id and source_item_id = p_source_item_id and detached_at is null;
  if not found then raise exception 'Active story/source link not found'; end if;

  insert into public.editorial_decisions (
    story_id, actor_id, actor_email, actor_role, action_type, from_value, to_value, reason
  ) values (
    p_story_id, p_actor_id, p_actor_email, p_actor_role, 'detach',
    jsonb_build_object('source_item_id', p_source_item_id, 'attached', true),
    jsonb_build_object('source_item_id', p_source_item_id, 'attached', false), p_reason
  );
  return jsonb_build_object('story_id', p_story_id, 'source_item_id', p_source_item_id, 'detached', true);
end;
$$;

insert into public.counties (id, name, slug, fips_code, treasury_code) values
  (1, 'Atlantic', 'atlantic', '001', '01'),
  (2, 'Bergen', 'bergen', '003', '02'),
  (3, 'Burlington', 'burlington', '005', '03'),
  (4, 'Camden', 'camden', '007', '04'),
  (5, 'Cape May', 'cape-may', '009', '05'),
  (6, 'Cumberland', 'cumberland', '011', '06'),
  (7, 'Essex', 'essex', '013', '07'),
  (8, 'Gloucester', 'gloucester', '015', '08'),
  (9, 'Hudson', 'hudson', '017', '09'),
  (10, 'Hunterdon', 'hunterdon', '019', '10'),
  (11, 'Mercer', 'mercer', '021', '11'),
  (12, 'Middlesex', 'middlesex', '023', '12'),
  (13, 'Monmouth', 'monmouth', '025', '13'),
  (14, 'Morris', 'morris', '027', '14'),
  (15, 'Ocean', 'ocean', '029', '15'),
  (16, 'Passaic', 'passaic', '031', '16'),
  (17, 'Salem', 'salem', '033', '17'),
  (18, 'Somerset', 'somerset', '035', '18'),
  (19, 'Sussex', 'sussex', '037', '19'),
  (20, 'Union', 'union', '039', '20'),
  (21, 'Warren', 'warren', '041', '21');

-- GENERATED_MUNICIPALITY_SEED_START
-- Generated from NJGIN Municipalities MapServer/2 (https://maps.nj.gov/arcgis/rest/services/Framework/Government_Boundaries/MapServer/2/query?where=1%3D1&outFields=MUN%2CCOUNTY%2CMUN_LABEL%2CMUN_TYPE%2CNAME%2CGNIS%2CMUN_CODE%2CSSN%2CCENSUS2020&returnGeometry=false&f=json).
-- Expected/current row count: 564. Do not hand-edit this block.
insert into public.municipalities (county_id, name, slug, municipality_type, aliases, treasury_code, census_geoid, gnis_code, local_code) values
  (1, 'Absecon City', 'absecon-city', 'city', array['Absecon', 'ABSECON CITY']::text[], '0101', '3400100100', '885134', '0101'),
  (1, 'Atlantic City', 'atlantic-city', 'city', array['Atlantic City', 'ATLANTIC CITY']::text[], '0102', '3400102080', '885142', '0102'),
  (1, 'Brigantine City', 'brigantine-city', 'city', array['Brigantine', 'BRIGANTINE CITY']::text[], '0103', '3400107810', '885171', '0103'),
  (1, 'Buena Borough', 'buena-borough', 'borough', array['Buena Borough', 'BUENA BORO']::text[], '0104', '3400108680', '885173', '0104'),
  (1, 'Buena Vista Township', 'buena-vista-township', 'township', array['Buena Vista Township', 'BUENA VISTA TWP']::text[], '0105', '3400108710', '882048', '0105'),
  (1, 'Corbin City', 'corbin-city', 'city', array['Corbin City', 'CORBIN CITY']::text[], '0106', '3400115160', '885192', '0106'),
  (1, 'Egg Harbor City', 'egg-harbor-city', 'city', array['Egg Harbor City', 'EGG HARBOR CITY']::text[], '0107', '3400120350', '885204', '0107'),
  (1, 'Egg Harbor Township', 'egg-harbor-township', 'township', array['Egg Harbor Township', 'EGG HARBOR TWP']::text[], '0108', '3400120290', '882051', '0108'),
  (1, 'Estell Manor City', 'estell-manor-city', 'city', array['Estell Manor', 'ESTELL MANOR CITY']::text[], '0109', '3400121870', '885212', '0109'),
  (1, 'Folsom Borough', 'folsom-borough', 'borough', array['Folsom Borough', 'FOLSOM BORO']::text[], '0110', '3400123940', '885222', '0110'),
  (1, 'Galloway Township', 'galloway-township', 'township', array['Galloway Township', 'GALLOWAY TWP']::text[], '0111', '3400125560', '882052', '0111'),
  (1, 'Hamilton Township', 'hamilton-township', 'township', array['Hamilton Township', 'HAMILTON TWP']::text[], '0112', '3400129280', '882049', '0112'),
  (1, 'Hammonton Town', 'hammonton-town', 'town', array['Hammonton', 'HAMMONTON TOWN']::text[], '0113', '3400129430', '885242', '0113'),
  (1, 'Linwood City', 'linwood-city', 'city', array['Linwood', 'LINWOOD CITY']::text[], '0114', '3400140530', '885280', '0114'),
  (1, 'Longport Borough', 'longport-borough', 'borough', array['Longport Borough', 'LONGPORT BORO']::text[], '0115', '3400141370', '885286', '0115'),
  (1, 'Margate City', 'margate-city', 'city', array['Margate City', 'MARGATE CITY']::text[], '0116', '3400143890', '885292', '0116'),
  (1, 'Mullica Township', 'mullica-township', 'township', array['Mullica Township', 'MULLICA TWP']::text[], '0117', '3400149410', '882053', '0117'),
  (1, 'Northfield City', 'northfield-city', 'city', array['Northfield', 'NORTHFIELD CITY']::text[], '0118', '3400152950', '885324', '0118'),
  (1, 'Pleasantville City', 'pleasantville-city', 'city', array['Pleasantville', 'PLEASANTVILLE CITY']::text[], '0119', '3400159640', '885356', '0119'),
  (1, 'Port Republic City', 'port-republic-city', 'city', array['Port Republic', 'PORT REPUBLIC CITY']::text[], '0120', '3400160600', '885360', '0120'),
  (1, 'Somers Point City', 'somers-point-city', 'city', array['Somers Point', 'SOMERS POINT CITY']::text[], '0121', '3400168430', '885397', '0121'),
  (1, 'Ventnor City', 'ventnor-city', 'city', array['Ventnor City', 'VENTNOR CITY']::text[], '0122', '3400175620', '885426', '0122'),
  (1, 'Weymouth Township', 'weymouth-township', 'township', array['Weymouth Township', 'WEYMOUTH TWP']::text[], '0123', '3400180330', '882050', '0123'),
  (2, 'Allendale Borough', 'allendale-borough', 'borough', array['Allendale Borough', 'ALLENDALE BORO']::text[], '0201', '3400300700', '885135', '0201'),
  (2, 'Alpine Borough', 'alpine-borough', 'borough', array['Alpine Borough', 'ALPINE BORO']::text[], '0202', '3400301090', '885139', '0202'),
  (2, 'Bergenfield Borough', 'bergenfield-borough', 'borough', array['Bergenfield Borough', 'BERGENFIELD BORO']::text[], '0203', '3400305170', '885157', '0203'),
  (2, 'Bogota Borough', 'bogota-borough', 'borough', array['Bogota Borough', 'BOGOTA BORO']::text[], '0204', '3400306490', '885163', '0204'),
  (2, 'Carlstadt Borough', 'carlstadt-borough', 'borough', array['Carlstadt Borough', 'CARLSTADT BORO']::text[], '0205', '3400310480', '885180', '0205'),
  (2, 'Cliffside Park Borough', 'cliffside-park-borough', 'borough', array['Cliffside Park Borough', 'CLIFFSIDE PARK BORO']::text[], '0206', '3400313570', '885187', '0206'),
  (2, 'Closter Borough', 'closter-borough', 'borough', array['Closter Borough', 'CLOSTER BORO']::text[], '0207', '3400313810', '885190', '0207'),
  (2, 'Cresskill Borough', 'cresskill-borough', 'borough', array['Cresskill Borough', 'CRESSKILL BORO']::text[], '0208', '3400315820', '885193', '0208'),
  (2, 'Demarest Borough', 'demarest-borough', 'borough', array['Demarest Borough', 'DEMAREST BORO']::text[], '0209', '3400317530', '885195', '0209'),
  (2, 'Dumont Borough', 'dumont-borough', 'borough', array['Dumont Borough', 'DUMONT BORO']::text[], '0210', '3400318400', '885197', '0210'),
  (2, 'East Rutherford Borough', 'east-rutherford-borough', 'borough', array['East Rutherford Borough', 'EAST RUTHERFORD BORO']::text[], '0212', '3400319510', '885201', '0212'),
  (2, 'Edgewater Borough', 'edgewater-borough', 'borough', array['Edgewater Borough', 'EDGEWATER BORO']::text[], '0213', '3400320020', '885203', '0213'),
  (2, 'Elmwood Park Borough', 'elmwood-park-borough', 'borough', array['Elmwood Park Borough', 'ELMWOOD PARK BORO']::text[], '0211', '3400321300', '885207', '0211'),
  (2, 'Emerson Borough', 'emerson-borough', 'borough', array['Emerson Borough', 'EMERSON BORO']::text[], '0214', '3400321450', '885208', '0214'),
  (2, 'Englewood City', 'englewood-city', 'city', array['Englewood', 'ENGLEWOOD CITY']::text[], '0215', '3400321480', '885209', '0215'),
  (2, 'Englewood Cliffs Borough', 'englewood-cliffs-borough', 'borough', array['Englewood Cliffs Borough', 'ENGLEWOOD CLIFFS BORO']::text[], '0216', '3400321510', '885210', '0216'),
  (2, 'Fair Lawn Borough', 'fair-lawn-borough', 'borough', array['Fair Lawn Borough', 'FAIR LAWN BORO']::text[], '0217', '3400322470', '885214', '0217'),
  (2, 'Fairview Borough', 'fairview-borough', 'borough', array['Fairview Borough', 'FAIRVIEW BORO']::text[], '0218', '3400322560', '885215', '0218'),
  (2, 'Fort Lee Borough', 'fort-lee-borough', 'borough', array['Fort Lee Borough', 'FORT LEE BORO']::text[], '0219', '3400324420', '885223', '0219'),
  (2, 'Franklin Lakes Borough', 'franklin-lakes-borough', 'borough', array['Franklin Lakes Borough', 'FRANKLIN LAKES BORO']::text[], '0220', '3400324990', '885225', '0220'),
  (2, 'Garfield City', 'garfield-city', 'city', array['Garfield', 'GARFIELD CITY']::text[], '0221', '3400325770', '885228', '0221'),
  (2, 'Glen Rock Borough', 'glen-rock-borough', 'borough', array['Glen Rock Borough', 'GLEN ROCK BORO']::text[], '0222', '3400326640', '885233', '0222'),
  (2, 'Hackensack City', 'hackensack-city', 'city', array['Hackensack', 'HACKENSACK CITY']::text[], '0223', '3400328680', '885236', '0223'),
  (2, 'Harrington Park Borough', 'harrington-park-borough', 'borough', array['Harrington Park Borough', 'HARRINGTON PARK BORO']::text[], '0224', '3400330150', '885244', '0224'),
  (2, 'Hasbrouck Heights Borough', 'hasbrouck-heights-borough', 'borough', array['Hasbrouck Heights Borough', 'HASBROUCK HEIGHTS BORO']::text[], '0225', '3400330420', '885247', '0225'),
  (2, 'Haworth Borough', 'haworth-borough', 'borough', array['Haworth Borough', 'HAWORTH BORO']::text[], '0226', '3400330540', '885248', '0226'),
  (2, 'Hillsdale Borough', 'hillsdale-borough', 'borough', array['Hillsdale Borough', 'HILLSDALE BORO']::text[], '0227', '3400331920', '885255', '0227'),
  (2, 'Ho-Ho-Kus Borough', 'ho-ho-kus-borough', 'borough', array['Ho-Ho-Kus Borough', 'HO-HO-KUS BORO']::text[], '0228', '3400332310', '885258', '0228'),
  (2, 'Leonia Borough', 'leonia-borough', 'borough', array['Leonia Borough', 'LEONIA BORO']::text[], '0229', '3400340020', '885276', '0229'),
  (2, 'Little Ferry Borough', 'little-ferry-borough', 'borough', array['Little Ferry Borough', 'LITTLE FERRY BORO']::text[], '0230', '3400340680', '885281', '0230'),
  (2, 'Lodi Borough', 'lodi-borough', 'borough', array['Lodi Borough', 'LODI BORO']::text[], '0231', '3400341100', '885284', '0231'),
  (2, 'Lyndhurst Township', 'lyndhurst-township', 'township', array['Lyndhurst Township', 'LYNDHURST TWP']::text[], '0232', '3400342090', '882225', '0232'),
  (2, 'Mahwah Township', 'mahwah-township', 'township', array['Mahwah Township', 'MAHWAH TWP']::text[], '0233', '3400342750', '882312', '0233'),
  (2, 'Maywood Borough', 'maywood-borough', 'borough', array['Maywood Borough', 'MAYWOOD BORO']::text[], '0234', '3400344880', '885294', '0234'),
  (2, 'Midland Park Borough', 'midland-park-borough', 'borough', array['Midland Park Borough', 'MIDLAND PARK BORO']::text[], '0235', '3400346110', '885300', '0235'),
  (2, 'Montvale Borough', 'montvale-borough', 'borough', array['Montvale Borough', 'MONTVALE BORO']::text[], '0236', '3400347610', '885306', '0236'),
  (2, 'Moonachie Borough', 'moonachie-borough', 'borough', array['Moonachie Borough', 'MOONACHIE BORO']::text[], '0237', '3400347700', '885307', '0237'),
  (2, 'New Milford Borough', 'new-milford-borough', 'borough', array['New Milford Borough', 'NEW MILFORD BORO']::text[], '0238', '3400351660', '885320', '0238'),
  (2, 'North Arlington Borough', 'north-arlington-borough', 'borough', array['North Arlington Borough', 'NORTH ARLINGTON BORO']::text[], '0239', '3400352320', '885323', '0239'),
  (2, 'Northvale Borough', 'northvale-borough', 'borough', array['Northvale Borough', 'NORTHVALE BORO']::text[], '0240', '3400353430', '885327', '0240'),
  (2, 'Norwood Borough', 'norwood-borough', 'borough', array['Norwood Borough', 'NORWOOD BORO']::text[], '0241', '3400353610', '885329', '0241'),
  (2, 'Oakland Borough', 'oakland-borough', 'borough', array['Oakland Borough', 'OAKLAND BORO']::text[], '0242', '3400353850', '885330', '0242'),
  (2, 'Old Tappan Borough', 'old-tappan-borough', 'borough', array['Old Tappan Borough', 'OLD TAPPAN BORO']::text[], '0243', '3400354870', '885336', '0243'),
  (2, 'Oradell Borough', 'oradell-borough', 'borough', array['Oradell Borough', 'ORADELL BORO']::text[], '0244', '3400354990', '885337', '0244'),
  (2, 'Palisades Park Borough', 'palisades-park-borough', 'borough', array['Palisades Park Borough', 'PALISADES PARK BORO']::text[], '0245', '3400355770', '885338', '0245'),
  (2, 'Paramus Borough', 'paramus-borough', 'borough', array['Paramus Borough', 'PARAMUS BORO']::text[], '0246', '3400355950', '885340', '0246'),
  (2, 'Park Ridge Borough', 'park-ridge-borough', 'borough', array['Park Ridge Borough', 'PARK RIDGE BORO']::text[], '0247', '3400356130', '885341', '0247'),
  (2, 'Ramsey Borough', 'ramsey-borough', 'borough', array['Ramsey Borough', 'RAMSEY BORO']::text[], '0248', '3400361680', '885364', '0248'),
  (2, 'Ridgefield Borough', 'ridgefield-borough', 'borough', array['Ridgefield Borough', 'RIDGEFIELD BORO']::text[], '0249', '3400362910', '885367', '0249'),
  (2, 'Ridgefield Park Village', 'ridgefield-park-village', 'village', array['Ridgefield Park Village', 'RIDGEFIELD PARK VILLAGE']::text[], '0250', '3400362940', '885368', '0250'),
  (2, 'Ridgewood Village', 'ridgewood-village', 'village', array['Ridgewood Village', 'RIDGEWOOD VILLAGE']::text[], '0251', '3400363000', '885369', '0251'),
  (2, 'River Edge Borough', 'river-edge-borough', 'borough', array['River Edge Borough', 'RIVER EDGE BORO']::text[], '0252', '3400363360', '885372', '0252'),
  (2, 'River Vale Township', 'river-vale-township', 'township', array['River Vale Township', 'RIVER VALE TWP']::text[], '0253', '3400363690', '882310', '0253'),
  (2, 'Rochelle Park Township', 'rochelle-park-township', 'township', array['Rochelle Park Township', 'ROCHELLE PARK TWP']::text[], '0254', '3400363990', '882307', '0254'),
  (2, 'Rockleigh Borough', 'rockleigh-borough', 'borough', array['Rockleigh Borough', 'ROCKLEIGH BORO']::text[], '0255', '3400364170', '885375', '0255'),
  (2, 'Rutherford Borough', 'rutherford-borough', 'borough', array['Rutherford Borough', 'RUTHERFORD BORO']::text[], '0256', '3400365280', '885383', '0256'),
  (2, 'Saddle Brook Township', 'saddle-brook-township', 'township', array['Saddle Brook Township', 'SADDLE BROOK TWP']::text[], '0257', '3400365340', '882308', '0257'),
  (2, 'Saddle River Borough', 'saddle-river-borough', 'borough', array['Saddle River Borough', 'SADDLE RIVER BORO']::text[], '0258', '3400365400', '885384', '0258'),
  (2, 'South Hackensack Township', 'south-hackensack-township', 'township', array['South Hackensack Township', 'SOUTH HACKENSACK TWP']::text[], '0259', '3400368970', '882226', '0259'),
  (2, 'Teaneck Township', 'teaneck-township', 'township', array['Teaneck Township', 'TEANECK TWP']::text[], '0260', '3400372360', '882227', '0260'),
  (2, 'Tenafly Borough', 'tenafly-borough', 'borough', array['Tenafly Borough', 'TENAFLY BORO']::text[], '0261', '3400372420', '885417', '0261'),
  (2, 'Teterboro Borough', 'teterboro-borough', 'borough', array['Teterboro Borough', 'TETERBORO BORO']::text[], '0262', '3400372480', '885418', '0262'),
  (2, 'Upper Saddle River Borough', 'upper-saddle-river-borough', 'borough', array['Upper Saddle River Borough', 'UPPER SADDLE RIVER BORO']::text[], '0263', '3400375140', '885425', '0263'),
  (2, 'Waldwick Borough', 'waldwick-borough', 'borough', array['Waldwick Borough', 'WALDWICK BORO']::text[], '0264', '3400376400', '885429', '0264'),
  (2, 'Wallington Borough', 'wallington-borough', 'borough', array['Wallington Borough', 'WALLINGTON BORO']::text[], '0265', '3400376490', '885430', '0265'),
  (2, 'Washington Township', 'washington-township', 'township', array['Washington Township', 'WASHINGTON TWP']::text[], '0266', '3400377135', '882311', '0266'),
  (2, 'Westwood Borough', 'westwood-borough', 'borough', array['Westwood Borough', 'WESTWOOD BORO']::text[], '0267', '3400380270', '885442', '0267'),
  (2, 'Wood-Ridge Borough', 'wood-ridge-borough', 'borough', array['Wood-Ridge Borough', 'WOOD-RIDGE BORO']::text[], '0269', '3400382570', '885451', '0269'),
  (2, 'Woodcliff Lake Borough', 'woodcliff-lake-borough', 'borough', array['Woodcliff Lake Borough', 'WOODCLIFF LAKE BORO']::text[], '0268', '3400382300', '885449', '0268'),
  (2, 'Wyckoff Township', 'wyckoff-township', 'township', array['Wyckoff Township', 'WYCKOFF TWP']::text[], '0270', '3400383050', '882309', '0270'),
  (3, 'Bass River Township', 'bass-river-township', 'township', array['Bass River Township', 'BASS RIVER TWP']::text[], '0301', '3400503370', '882086', '0301'),
  (3, 'Beverly City', 'beverly-city', 'city', array['Beverly', 'BEVERLY CITY']::text[], '0302', '3400505740', '885160', '0302'),
  (3, 'Bordentown City', 'bordentown-city', 'city', array['Bordentown', 'BORDENTOWN CITY']::text[], '0303', '3400506670', '885165', '0303'),
  (3, 'Bordentown Township', 'bordentown-township', 'township', array['Bordentown Township', 'BORDENTOWN TWP']::text[], '0304', '3400506700', '882110', '0304'),
  (3, 'Burlington City', 'burlington-city', 'city', array['Burlington', 'BURLINGTON CITY']::text[], '0305', '3400508920', '885174', '0305'),
  (3, 'Burlington Township', 'burlington-township', 'township', array['Burlington Township', 'BURLINGTON TWP']::text[], '0306', '3400508950', '882102', '0306'),
  (3, 'Chesterfield Township', 'chesterfield-township', 'township', array['Chesterfield Township', 'CHESTERFIELD TWP']::text[], '0307', '3400512670', '882109', '0307'),
  (3, 'Cinnaminson Township', 'cinnaminson-township', 'township', array['Cinnaminson Township', 'CINNAMINSON TWP']::text[], '0308', '3400512940', '882096', '0308'),
  (3, 'Delanco Township', 'delanco-township', 'township', array['Delanco Township', 'DELANCO TWP']::text[], '0309', '3400517080', '882100', '0309'),
  (3, 'Delran Township', 'delran-township', 'township', array['Delran Township', 'DELRAN TWP']::text[], '0310', '3400517440', '882097', '0310'),
  (3, 'Eastampton Township', 'eastampton-township', 'township', array['Eastampton Township', 'EASTAMPTON TWP']::text[], '0311', '3400518790', '882105', '0311'),
  (3, 'Edgewater Park Township', 'edgewater-park-township', 'township', array['Edgewater Park Township', 'EDGEWATER PARK TWP']::text[], '0312', '3400520050', '882101', '0312'),
  (3, 'Evesham Township', 'evesham-township', 'township', array['Evesham Township', 'EVESHAM TWP']::text[], '0313', '3400522110', '882082', '0313'),
  (3, 'Fieldsboro Borough', 'fieldsboro-borough', 'borough', array['Fieldsboro Borough', 'FIELDSBORO BORO']::text[], '0314', '3400523250', '885219', '0314'),
  (3, 'Florence Township', 'florence-township', 'township', array['Florence Township', 'FLORENCE TWP']::text[], '0315', '3400523850', '882107', '0315'),
  (3, 'Hainesport Township', 'hainesport-township', 'township', array['Hainesport Township', 'HAINESPORT TWP']::text[], '0316', '3400529010', '882092', '0316'),
  (3, 'Lumberton Township', 'lumberton-township', 'township', array['Lumberton Township', 'LUMBERTON TWP']::text[], '0317', '3400542060', '882091', '0317'),
  (3, 'Mansfield Township', 'mansfield-township', 'township', array['Mansfield Township', 'MANSFIELD TWP']::text[], '0318', '3400543290', '882108', '0318'),
  (3, 'Maple Shade Township', 'maple-shade-township', 'township', array['Maple Shade Township', 'MAPLE SHADE TWP']::text[], '0319', '3400543740', '882094', '0319'),
  (3, 'Medford Lakes Borough', 'medford-lakes-borough', 'borough', array['Medford Lakes Borough', 'MEDFORD LAKES BORO']::text[], '0321', '3400545210', '885295', '0321'),
  (3, 'Medford Township', 'medford-township', 'township', array['Medford Township', 'MEDFORD TWP']::text[], '0320', '3400545120', '882083', '0320'),
  (3, 'Moorestown Township', 'moorestown-township', 'township', array['Moorestown Township', 'MOORESTOWN TWP']::text[], '0322', '3400547880', '882095', '0322'),
  (3, 'Mount Holly Township', 'mount-holly-township', 'township', array['Mount Holly Township', 'MOUNT HOLLY TWP']::text[], '0323', '3400548900', '882104', '0323'),
  (3, 'Mount Laurel Township', 'mount-laurel-township', 'township', array['Mount Laurel Township', 'MOUNT LAUREL TWP']::text[], '0324', '3400549020', '882093', '0324'),
  (3, 'New Hanover Township', 'new-hanover-township', 'township', array['New Hanover Township', 'NEW HANOVER TWP']::text[], '0325', '3400551510', '882088', '0325'),
  (3, 'North Hanover Township', 'north-hanover-township', 'township', array['North Hanover Township', 'NORTH HANOVER TWP']::text[], '0326', '3400553070', '882087', '0326'),
  (3, 'Palmyra Borough', 'palmyra-borough', 'borough', array['Palmyra Borough', 'PALMYRA BORO']::text[], '0327', '3400555800', '885339', '0327'),
  (3, 'Pemberton Borough', 'pemberton-borough', 'borough', array['Pemberton Borough', 'PEMBERTON BORO']::text[], '0328', '3400557480', '885346', '0328'),
  (3, 'Pemberton Township', 'pemberton-township', 'township', array['Pemberton Township', 'PEMBERTON TWP']::text[], '0329', '3400557510', '882089', '0329'),
  (3, 'Riverside Township', 'riverside-township', 'township', array['Riverside Township', 'RIVERSIDE TWP']::text[], '0330', '3400563510', '882098', '0330'),
  (3, 'Riverton Borough', 'riverton-borough', 'borough', array['Riverton Borough', 'RIVERTON BORO']::text[], '0331', '3400563660', '885373', '0331'),
  (3, 'Shamong Township', 'shamong-township', 'township', array['Shamong Township', 'SHAMONG TWP']::text[], '0332', '3400566810', '882084', '0332'),
  (3, 'Southampton Township', 'southampton-township', 'township', array['Southampton Township', 'SOUTHAMPTON TWP']::text[], '0333', '3400568610', '882090', '0333'),
  (3, 'Springfield Township', 'springfield-township', 'township', array['Springfield Township', 'SPRINGFIELD TWP']::text[], '0334', '3400569990', '882106', '0334'),
  (3, 'Tabernacle Township', 'tabernacle-township', 'township', array['Tabernacle Township', 'TABERNACLE TWP']::text[], '0335', '3400572060', '882081', '0335'),
  (3, 'Washington Township', 'washington-township', 'township', array['Washington Township', 'WASHINGTON TWP']::text[], '0336', '3400577150', '882085', '0336'),
  (3, 'Westampton Township', 'westampton-township', 'township', array['Westampton Township', 'WESTAMPTON TWP']::text[], '0337', '3400578200', '882103', '0337'),
  (3, 'Willingboro Township', 'willingboro-township', 'township', array['Willingboro Township', 'WILLINGBORO TWP']::text[], '0338', '3400581440', '882099', '0338'),
  (3, 'Woodland Township', 'woodland-township', 'township', array['Woodland Township', 'WOODLAND TWP']::text[], '0339', '3400582420', '882080', '0339'),
  (3, 'Wrightstown Borough', 'wrightstown-borough', 'borough', array['Wrightstown Borough', 'WRIGHTSTOWN BORO']::text[], '0340', '3400582960', '885453', '0340'),
  (4, 'Audubon Borough', 'audubon-borough', 'borough', array['Audubon Borough', 'AUDUBON BORO']::text[], '0401', '3400702200', '885144', '0401'),
  (4, 'Audubon Park Borough', 'audubon-park-borough', 'borough', array['Audubon Park Borough', 'AUDUBON PARK BORO']::text[], '0402', '3400702230', '885145', '0402'),
  (4, 'Barrington Borough', 'barrington-borough', 'borough', array['Barrington Borough', 'BARRINGTON BORO']::text[], '0403', '3400703250', '885149', '0403'),
  (4, 'Bellmawr Borough', 'bellmawr-borough', 'borough', array['Bellmawr Borough', 'BELLMAWR BORO']::text[], '0404', '3400704750', '885154', '0404'),
  (4, 'Berlin Borough', 'berlin-borough', 'borough', array['Berlin Borough', 'BERLIN BORO']::text[], '0405', '3400705440', '885158', '0405'),
  (4, 'Berlin Township', 'berlin-township', 'township', array['Berlin Township', 'BERLIN TWP']::text[], '0406', '3400705470', '882152', '0406'),
  (4, 'Brooklawn Borough', 'brooklawn-borough', 'borough', array['Brooklawn Borough', 'BROOKLAWN BORO']::text[], '0407', '3400708170', '885172', '0407'),
  (4, 'Camden City', 'camden-city', 'city', array['Camden', 'CAMDEN CITY']::text[], '0408', '3400710000', '885177', '0408'),
  (4, 'Cherry Hill Township', 'cherry-hill-township', 'township', array['Cherry Hill Township', 'CHERRY HILL TWP']::text[], '0409', '3400712280', '882155', '0409'),
  (4, 'Chesilhurst Borough', 'chesilhurst-borough', 'borough', array['Chesilhurst Borough', 'CHESILHURST BORO']::text[], '0410', '3400712550', '885183', '0410'),
  (4, 'Clementon Borough', 'clementon-borough', 'borough', array['Clementon Borough', 'CLEMENTON BORO']::text[], '0411', '3400713420', '885186', '0411'),
  (4, 'Collingswood Borough', 'collingswood-borough', 'borough', array['Collingswood Borough', 'COLLINGSWOOD BORO']::text[], '0412', '3400714260', '885191', '0412'),
  (4, 'Gibbsboro Borough', 'gibbsboro-borough', 'borough', array['Gibbsboro Borough', 'GIBBSBORO BORO']::text[], '0413', '3400726070', '885230', '0413'),
  (4, 'Gloucester City', 'gloucester-city', 'city', array['Gloucester City', 'GLOUCESTER CITY']::text[], '0414', '3400726820', '885234', '0414'),
  (4, 'Gloucester Township', 'gloucester-township', 'township', array['Gloucester Township', 'GLOUCESTER TWP']::text[], '0415', '3400726760', '882154', '0415'),
  (4, 'Haddon Heights Borough', 'haddon-heights-borough', 'borough', array['Haddon Heights Borough', 'HADDON HEIGHTS BORO']::text[], '0418', '3400728800', '885239', '0418'),
  (4, 'Haddon Township', 'haddon-township', 'township', array['Haddon Township', 'HADDON TWP']::text[], '0416', '3400728740', '882156', '0416'),
  (4, 'Haddonfield Borough', 'haddonfield-borough', 'borough', array['Haddonfield Borough', 'HADDONFIELD BORO']::text[], '0417', '3400728770', '885238', '0417'),
  (4, 'Hi-Nella Borough', 'hi-nella-borough', 'borough', array['Hi-Nella Borough', 'HI-NELLA BORO']::text[], '0419', '3400732220', '885256', '0419'),
  (4, 'Laurel Springs Borough', 'laurel-springs-borough', 'borough', array['Laurel Springs Borough', 'LAUREL SPRINGS BORO']::text[], '0420', '3400739210', '885272', '0420'),
  (4, 'Lawnside Borough', 'lawnside-borough', 'borough', array['Lawnside Borough', 'LAWNSIDE BORO']::text[], '0421', '3400739420', '885274', '0421'),
  (4, 'Lindenwold Borough', 'lindenwold-borough', 'borough', array['Lindenwold Borough', 'LINDENWOLD BORO']::text[], '0422', '3400740440', '885279', '0422'),
  (4, 'Magnolia Borough', 'magnolia-borough', 'borough', array['Magnolia Borough', 'MAGNOLIA BORO']::text[], '0423', '3400742630', '885288', '0423'),
  (4, 'Merchantville Borough', 'merchantville-borough', 'borough', array['Merchantville Borough', 'MERCHANTVILLE BORO']::text[], '0424', '3400745510', '885297', '0424'),
  (4, 'Mount Ephraim Borough', 'mount-ephraim-borough', 'borough', array['Mount Ephraim Borough', 'MOUNT EPHRAIM BORO']::text[], '0425', '3400748750', '885313', '0425'),
  (4, 'Oaklyn Borough', 'oaklyn-borough', 'borough', array['Oaklyn Borough', 'OAKLYN BORO']::text[], '0426', '3400753880', '885331', '0426'),
  (4, 'Pennsauken Township', 'pennsauken-township', 'township', array['Pennsauken Township', 'PENNSAUKEN TWP']::text[], '0427', '3400757660', '882157', '0427'),
  (4, 'Pine Hill Borough', 'pine-hill-borough', 'borough', array['Pine Hill Borough', 'PINE HILL BORO']::text[], '0428', '3400758770', '885352', '0428'),
  (4, 'Runnemede Borough', 'runnemede-borough', 'borough', array['Runnemede Borough', 'RUNNEMEDE BORO']::text[], '0430', '3400765160', '885382', '0430'),
  (4, 'Somerdale Borough', 'somerdale-borough', 'borough', array['Somerdale Borough', 'SOMERDALE BORO']::text[], '0431', '3400768340', '885396', '0431'),
  (4, 'Stratford Borough', 'stratford-borough', 'borough', array['Stratford Borough', 'STRATFORD BORO']::text[], '0432', '3400771220', '885411', '0432'),
  (4, 'Tavistock Borough', 'tavistock-borough', 'borough', array['Tavistock Borough', 'TAVISTOCK BORO']::text[], '0433', '3400772240', '885416', '0433'),
  (4, 'Voorhees Township', 'voorhees-township', 'township', array['Voorhees Township', 'VOORHEES TWP']::text[], '0434', '3400776220', '882153', '0434'),
  (4, 'Waterford Township', 'waterford-township', 'township', array['Waterford Township', 'WATERFORD TWP']::text[], '0435', '3400777630', '882151', '0435'),
  (4, 'Winslow Township', 'winslow-township', 'township', array['Winslow Township', 'WINSLOW TWP']::text[], '0436', '3400781740', '882150', '0436'),
  (4, 'Woodlynne Borough', 'woodlynne-borough', 'borough', array['Woodlynne Borough', 'WOODLYNNE BORO']::text[], '0437', '3400782450', '885450', '0437'),
  (5, 'Avalon Borough', 'avalon-borough', 'borough', array['Avalon Borough', 'AVALON BORO']::text[], '0501', '3400902320', '885146', '0501'),
  (5, 'Cape May City', 'cape-may-city', 'city', array['Cape May', 'CAPE MAY CITY']::text[], '0502', '3400910270', '885178', '0502'),
  (5, 'Cape May Point Borough', 'cape-may-point-borough', 'borough', array['Cape May Point Borough', 'CAPE MAY POINT BORO']::text[], '0503', '3400910330', '885179', '0503'),
  (5, 'Dennis Township', 'dennis-township', 'township', array['Dennis Township', 'DENNIS TWP']::text[], '0504', '3400917560', '882046', '0504'),
  (5, 'Lower Township', 'lower-township', 'township', array['Lower Township', 'LOWER TWP']::text[], '0505', '3400941610', '882044', '0505'),
  (5, 'Middle Township', 'middle-township', 'township', array['Middle Township', 'MIDDLE TWP']::text[], '0506', '3400945810', '882045', '0506'),
  (5, 'North Wildwood City', 'north-wildwood-city', 'city', array['North Wildwood', 'NORTH WILDWOOD CITY']::text[], '0507', '3400953490', '885328', '0507'),
  (5, 'Ocean City', 'ocean-city', 'city', array['Ocean City', 'OCEAN CITY']::text[], '0508', '3400954360', '885332', '0508'),
  (5, 'Sea Isle City', 'sea-isle-city', 'city', array['Sea Isle City', 'SEA ISLE CITY']::text[], '0509', '3400966390', '885389', '0509'),
  (5, 'Stone Harbor Borough', 'stone-harbor-borough', 'borough', array['Stone Harbor Borough', 'STONE HARBOR BORO']::text[], '0510', '3400971010', '885410', '0510'),
  (5, 'Upper Township', 'upper-township', 'township', array['Upper Township', 'UPPER TWP']::text[], '0511', '3400974810', '882047', '0511'),
  (5, 'West Cape May Borough', 'west-cape-may-borough', 'borough', array['West Cape May Borough', 'WEST CAPE MAY BORO']::text[], '0512', '3400978530', '885435', '0512'),
  (5, 'West Wildwood Borough', 'west-wildwood-borough', 'borough', array['West Wildwood Borough', 'WEST WILDWOOD BORO']::text[], '0513', '3400980210', '885441', '0513'),
  (5, 'Wildwood City', 'wildwood-city', 'city', array['Wildwood', 'WILDWOOD CITY']::text[], '0514', '3400981170', '885444', '0514'),
  (5, 'Wildwood Crest Borough', 'wildwood-crest-borough', 'borough', array['Wildwood Crest Borough', 'WILDWOOD CREST BORO']::text[], '0515', '3400981200', '885445', '0515'),
  (5, 'Woodbine Borough', 'woodbine-borough', 'borough', array['Woodbine Borough', 'WOODBINE BORO']::text[], '0516', '3400981890', '885446', '0516'),
  (6, 'Bridgeton City', 'bridgeton-city', 'city', array['Bridgeton', 'BRIDGETON CITY']::text[], '0601', '3401107600', '885169', '0601'),
  (6, 'Commercial Township', 'commercial-township', 'township', array['Commercial Township', 'COMMERCIAL TWP']::text[], '0602', '3401114710', '882062', '0602'),
  (6, 'Deerfield Township', 'deerfield-township', 'township', array['Deerfield Township', 'DEERFIELD TWP']::text[], '0603', '3401116900', '882054', '0603'),
  (6, 'Downe Township', 'downe-township', 'township', array['Downe Township', 'DOWNE TWP']::text[], '0604', '3401118220', '882061', '0604'),
  (6, 'Fairfield Township', 'fairfield-township', 'township', array['Fairfield Township', 'FAIRFIELD TWP']::text[], '0605', '3401122350', '882059', '0605'),
  (6, 'Greenwich Township', 'greenwich-township', 'township', array['Greenwich Township', 'GREENWICH TWP']::text[], '0606', '3401128170', '882058', '0606'),
  (6, 'Hopewell Township', 'hopewell-township', 'township', array['Hopewell Township', 'HOPEWELL TWP']::text[], '0607', '3401133120', '882056', '0607'),
  (6, 'Lawrence Township', 'lawrence-township', 'township', array['Lawrence Township', 'LAWRENCE TWP']::text[], '0608', '3401139450', '882060', '0608'),
  (6, 'Maurice River Township', 'maurice-river-township', 'township', array['Maurice River Township', 'MAURICE RIVER TWP']::text[], '0609', '3401144580', '882063', '0609'),
  (6, 'Millville City', 'millville-city', 'city', array['Millville', 'MILLVILLE CITY']::text[], '0610', '3401146680', '885304', '0610'),
  (6, 'Shiloh Borough', 'shiloh-borough', 'borough', array['Shiloh Borough', 'SHILOH BORO']::text[], '0611', '3401167020', '885393', '0611'),
  (6, 'Stow Creek Township', 'stow-creek-township', 'township', array['Stow Creek Township', 'STOW CREEK TWP']::text[], '0612', '3401171160', '882057', '0612'),
  (6, 'Upper Deerfield Township', 'upper-deerfield-township', 'township', array['Upper Deerfield Township', 'UPPER DEERFIELD TWP']::text[], '0613', '3401174870', '882055', '0613'),
  (6, 'Vineland City', 'vineland-city', 'city', array['Vineland', 'VINELAND CITY']::text[], '0614', '3401176070', '885428', '0614'),
  (7, 'Belleville Township', 'belleville-township', 'township', array['Belleville Township', 'BELLEVILLE TWP']::text[], '0701', '3401304695', '1729713', '0701'),
  (7, 'Bloomfield Township', 'bloomfield-township', 'township', array['Bloomfield Township', 'BLOOMFIELD TWP']::text[], '0702', '3401306260', '1729714', '0702'),
  (7, 'Caldwell Borough', 'caldwell-borough', 'borough', array['Caldwell Borough', 'CALDWELL BORO']::text[], '0703', '3401309250', '2381010', '0703'),
  (7, 'Cedar Grove Township', 'cedar-grove-township', 'township', array['Cedar Grove Township', 'CEDAR GROVE TWP']::text[], '0704', '3401311200', '882222', '0704'),
  (7, 'City of Orange Township', 'city-of-orange-township', 'city', array['City of Orange Township', 'CITY OF ORANGE TWP']::text[], '0717', '3401313045', '1729742', '0717'),
  (7, 'East Orange City', 'east-orange-city', 'city', array['East Orange', 'EAST ORANGE CITY']::text[], '0705', '3401319390', '885200', '0705'),
  (7, 'Essex Fells Borough', 'essex-fells-borough', 'borough', array['Essex Fells Borough', 'ESSEX FELLS BORO']::text[], '0706', '3401321840', '2390558', '0706'),
  (7, 'Fairfield Township', 'fairfield-township', 'township', array['Fairfield Township', 'FAIRFIELD TWP']::text[], '0707', '3401322385', '1729722', '0707'),
  (7, 'Glen Ridge Borough', 'glen-ridge-borough', 'borough', array['Glen Ridge Borough', 'GLEN RIDGE BORO']::text[], '0708', '3401326610', '2390559', '0708'),
  (7, 'Irvington Township', 'irvington-township', 'township', array['Irvington Township', 'IRVINGTON TWP']::text[], '0709', '3401334450', '877363', '0709'),
  (7, 'Livingston Township', 'livingston-township', 'township', array['Livingston Township', 'LIVINGSTON TWP']::text[], '0710', '3401340890', '882219', '0710'),
  (7, 'Maplewood Township', 'maplewood-township', 'township', array['Maplewood Township', 'MAPLEWOOD TWP']::text[], '0711', '3401343800', '882220', '0711'),
  (7, 'Millburn Township', 'millburn-township', 'township', array['Millburn Township', 'MILLBURN TWP']::text[], '0712', '3401346380', '882221', '0712'),
  (7, 'Montclair Township', 'montclair-township', 'township', array['Montclair Township', 'MONTCLAIR TWP']::text[], '0713', '3401347500', '1729720', '0713'),
  (7, 'Newark City', 'newark-city', 'city', array['Newark', 'NEWARK CITY']::text[], '0714', '3401351000', '885317', '0714'),
  (7, 'North Caldwell Borough', 'north-caldwell-borough', 'borough', array['North Caldwell Borough', 'NORTH CALDWELL BORO']::text[], '0715', '3401352620', '878839', '0715'),
  (7, 'Nutley Township', 'nutley-township', 'township', array['Nutley Township', 'NUTLEY TWP']::text[], '0716', '3401353680', '1729715', '0716'),
  (7, 'Roseland Borough', 'roseland-borough', 'borough', array['Roseland Borough', 'ROSELAND BORO']::text[], '0718', '3401364590', '885378', '0718'),
  (7, 'South Orange Village', 'south-orange-village', 'village', array['South Orange Village', 'SOUTH ORANGE VILLAGE']::text[], '0719', '3401369274', '880741', '0719'),
  (7, 'Verona Township', 'verona-township', 'township', array['Verona Township', 'VERONA TWP']::text[], '0720', '3401375815', '1729716', '0720'),
  (7, 'West Caldwell Township', 'west-caldwell-township', 'township', array['West Caldwell Township', 'WEST CALDWELL TWP']::text[], '0721', '3401378510', '1729717', '0721'),
  (7, 'West Orange Township', 'west-orange-township', 'township', array['West Orange Township', 'WEST ORANGE TWP']::text[], '0722', '3401379800', '1729718', '0722'),
  (8, 'Clayton Borough', 'clayton-borough', 'borough', array['Clayton Borough', 'CLAYTON BORO']::text[], '0801', '3401513360', '885185', '0801'),
  (8, 'Deptford Township', 'deptford-township', 'township', array['Deptford Township', 'DEPTFORD TWP']::text[], '0802', '3401517710', '882149', '0802'),
  (8, 'East Greenwich Township', 'east-greenwich-township', 'township', array['East Greenwich Township', 'EAST GREENWICH TWP']::text[], '0803', '3401519180', '882141', '0803'),
  (8, 'Elk Township', 'elk-township', 'township', array['Elk Township', 'ELK TWP']::text[], '0804', '3401521060', '882139', '0804'),
  (8, 'Franklin Township', 'franklin-township', 'township', array['Franklin Township', 'FRANKLIN TWP']::text[], '0805', '3401524840', '882138', '0805'),
  (8, 'Glassboro Borough', 'glassboro-borough', 'borough', array['Glassboro Borough', 'GLASSBORO BORO']::text[], '0806', '3401526340', '885231', '0806'),
  (8, 'Greenwich Township', 'greenwich-township', 'township', array['Greenwich Township', 'GREENWICH TWP']::text[], '0807', '3401528185', '882142', '0807'),
  (8, 'Harrison Township', 'harrison-township', 'township', array['Harrison Township', 'HARRISON TWP']::text[], '0808', '3401530180', '882146', '0808'),
  (8, 'Logan Township', 'logan-township', 'township', array['Logan Township', 'LOGAN TWP']::text[], '0809', '3401541160', '882143', '0809'),
  (8, 'Mantua Township', 'mantua-township', 'township', array['Mantua Township', 'MANTUA TWP']::text[], '0810', '3401543440', '882147', '0810'),
  (8, 'Monroe Township', 'monroe-township', 'township', array['Monroe Township', 'MONROE TWP']::text[], '0811', '3401547250', '882137', '0811'),
  (8, 'National Park Borough', 'national-park-borough', 'borough', array['National Park Borough', 'NATIONAL PARK BORO']::text[], '0812', '3401549680', '885314', '0812'),
  (8, 'Newfield Borough', 'newfield-borough', 'borough', array['Newfield Borough', 'NEWFIELD BORO']::text[], '0813', '3401551390', '885319', '0813'),
  (8, 'Paulsboro Borough', 'paulsboro-borough', 'borough', array['Paulsboro Borough', 'PAULSBORO BORO']::text[], '0814', '3401557150', '885344', '0814'),
  (8, 'Pitman Borough', 'pitman-borough', 'borough', array['Pitman Borough', 'PITMAN BORO']::text[], '0815', '3401559070', '885354', '0815'),
  (8, 'South Harrison Township', 'south-harrison-township', 'township', array['South Harrison Township', 'SOUTH HARRISON TWP']::text[], '0816', '3401569030', '882145', '0816'),
  (8, 'Swedesboro Borough', 'swedesboro-borough', 'borough', array['Swedesboro Borough', 'SWEDESBORO BORO']::text[], '0817', '3401571850', '885415', '0817'),
  (8, 'Washington Township', 'washington-township', 'township', array['Washington Township', 'WASHINGTON TWP']::text[], '0818', '3401577180', '882140', '0818'),
  (8, 'Wenonah Borough', 'wenonah-borough', 'borough', array['Wenonah Borough', 'WENONAH BORO']::text[], '0819', '3401578110', '885434', '0819'),
  (8, 'West Deptford Township', 'west-deptford-township', 'township', array['West Deptford Township', 'WEST DEPTFORD TWP']::text[], '0820', '3401578800', '882148', '0820'),
  (8, 'Westville Borough', 'westville-borough', 'borough', array['Westville Borough', 'WESTVILLE BORO']::text[], '0821', '3401580120', '885440', '0821'),
  (8, 'Woodbury City', 'woodbury-city', 'city', array['Woodbury', 'WOODBURY CITY']::text[], '0822', '3401582120', '885447', '0822'),
  (8, 'Woodbury Heights Borough', 'woodbury-heights-borough', 'borough', array['Woodbury Heights Borough', 'WOODBURY HEIGHTS BORO']::text[], '0823', '3401582180', '885448', '0823'),
  (8, 'Woolwich Township', 'woolwich-township', 'township', array['Woolwich Township', 'WOOLWICH TWP']::text[], '0824', '3401582840', '882144', '0824'),
  (9, 'Bayonne City', 'bayonne-city', 'city', array['Bayonne', 'BAYONNE CITY']::text[], '0901', '3401703580', '885151', '0901'),
  (9, 'East Newark Borough', 'east-newark-borough', 'borough', array['East Newark Borough', 'EAST NEWARK BORO']::text[], '0902', '3401719360', '885199', '0902'),
  (9, 'Guttenberg Town', 'guttenberg-town', 'town', array['Guttenberg', 'GUTTENBERG TOWN']::text[], '0903', '3401728650', '885235', '0903'),
  (9, 'Harrison Town', 'harrison-town', 'town', array['Harrison', 'HARRISON TOWN']::text[], '0904', '3401730210', '885245', '0904'),
  (9, 'Hoboken City', 'hoboken-city', 'city', array['Hoboken', 'HOBOKEN CITY']::text[], '0905', '3401732250', '885257', '0905'),
  (9, 'Jersey City', 'jersey-city', 'city', array['Jersey City', 'JERSEY CITY']::text[], '0906', '3401736000', '885264', '0906'),
  (9, 'Kearny Town', 'kearny-town', 'town', array['Kearny', 'KEARNY TOWN']::text[], '0907', '3401736510', '885266', '0907'),
  (9, 'North Bergen Township', 'north-bergen-township', 'township', array['North Bergen Township', 'NORTH BERGEN TWP']::text[], '0908', '3401752470', '882223', '0908'),
  (9, 'Secaucus Town', 'secaucus-town', 'town', array['Secaucus', 'SECAUCUS TOWN']::text[], '0909', '3401766570', '885392', '0909'),
  (9, 'Union City', 'union-city', 'city', array['Union City', 'UNION CITY']::text[], '0910', '3401774630', '885424', '0910'),
  (9, 'Weehawken Township', 'weehawken-township', 'township', array['Weehawken Township', 'WEEHAWKEN TWP']::text[], '0911', '3401777930', '882224', '0911'),
  (9, 'West New York Town', 'west-new-york-town', 'town', array['West New York', 'WEST NEW YORK TOWN']::text[], '0912', '3401779610', '885438', '0912'),
  (10, 'Alexandria Township', 'alexandria-township', 'township', array['Alexandria Township', 'ALEXANDRIA TWP']::text[], '1001', '3401900550', '882186', '1001'),
  (10, 'Bethlehem Township', 'bethlehem-township', 'township', array['Bethlehem Township', 'BETHLEHEM TWP']::text[], '1002', '3401905650', '882189', '1002'),
  (10, 'Bloomsbury Borough', 'bloomsbury-borough', 'borough', array['Bloomsbury Borough', 'BLOOMSBURY BORO']::text[], '1003', '3401906370', '885162', '1003'),
  (10, 'Califon Borough', 'califon-borough', 'borough', array['Califon Borough', 'CALIFON BORO']::text[], '1004', '3401909280', '885176', '1004'),
  (10, 'Clinton Town', 'clinton-town', 'town', array['Clinton', 'CLINTON TOWN']::text[], '1005', '3401913720', '885189', '1005'),
  (10, 'Clinton Township', 'clinton-township', 'township', array['Clinton Township', 'CLINTON TWP']::text[], '1006', '3401913750', '882177', '1006'),
  (10, 'Delaware Township', 'delaware-township', 'township', array['Delaware Township', 'DELAWARE TWP']::text[], '1007', '3401917170', '882182', '1007'),
  (10, 'East Amwell Township', 'east-amwell-township', 'township', array['East Amwell Township', 'EAST AMWELL TWP']::text[], '1008', '3401918820', '882180', '1008'),
  (10, 'Flemington Borough', 'flemington-borough', 'borough', array['Flemington Borough', 'FLEMINGTON BORO']::text[], '1009', '3401923700', '885220', '1009'),
  (10, 'Franklin Township', 'franklin-township', 'township', array['Franklin Township', 'FRANKLIN TWP']::text[], '1010', '3401924870', '882184', '1010'),
  (10, 'Frenchtown Borough', 'frenchtown-borough', 'borough', array['Frenchtown Borough', 'FRENCHTOWN BORO']::text[], '1011', '3401925350', '885227', '1011'),
  (10, 'Glen Gardner Borough', 'glen-gardner-borough', 'borough', array['Glen Gardner Borough', 'GLEN GARDNER BORO']::text[], '1012', '3401926550', '885232', '1012'),
  (10, 'Hampton Borough', 'hampton-borough', 'borough', array['Hampton Borough', 'HAMPTON BORO']::text[], '1013', '3401929460', '885243', '1013'),
  (10, 'High Bridge Borough', 'high-bridge-borough', 'borough', array['High Bridge Borough', 'HIGH BRIDGE BORO']::text[], '1014', '3401931320', '885251', '1014'),
  (10, 'Holland Township', 'holland-township', 'township', array['Holland Township', 'HOLLAND TWP']::text[], '1015', '3401932460', '882185', '1015'),
  (10, 'Kingwood Township', 'kingwood-township', 'township', array['Kingwood Township', 'KINGWOOD TWP']::text[], '1016', '3401937065', '882183', '1016'),
  (10, 'Lambertville City', 'lambertville-city', 'city', array['Lambertville', 'LAMBERTVILLE CITY']::text[], '1017', '3401938610', '885271', '1017'),
  (10, 'Lebanon Borough', 'lebanon-borough', 'borough', array['Lebanon Borough', 'LEBANON BORO']::text[], '1018', '3401939630', '885275', '1018'),
  (10, 'Lebanon Township', 'lebanon-township', 'township', array['Lebanon Township', 'LEBANON TWP']::text[], '1019', '3401939660', '882191', '1019'),
  (10, 'Milford Borough', 'milford-borough', 'borough', array['Milford Borough', 'MILFORD BORO']::text[], '1020', '3401946260', '885301', '1020'),
  (10, 'Raritan Township', 'raritan-township', 'township', array['Raritan Township', 'RARITAN TWP']::text[], '1021', '3401961920', '882179', '1021'),
  (10, 'Readington Township', 'readington-township', 'township', array['Readington Township', 'READINGTON TWP']::text[], '1022', '3401962250', '882178', '1022'),
  (10, 'Stockton Borough', 'stockton-borough', 'borough', array['Stockton Borough', 'STOCKTON BORO']::text[], '1023', '3401970980', '885409', '1023'),
  (10, 'Tewksbury Township', 'tewksbury-township', 'township', array['Tewksbury Township', 'TEWKSBURY TWP']::text[], '1024', '3401972510', '882190', '1024'),
  (10, 'Union Township', 'union-township', 'township', array['Union Township', 'UNION TWP']::text[], '1025', '3401974420', '882188', '1025'),
  (10, 'West Amwell Township', 'west-amwell-township', 'township', array['West Amwell Township', 'WEST AMWELL TWP']::text[], '1026', '3401978230', '882181', '1026'),
  (11, 'East Windsor Township', 'east-windsor-township', 'township', array['East Windsor Township', 'EAST WINDSOR TWP']::text[], '1101', '3402119780', '882123', '1101'),
  (11, 'Ewing Township', 'ewing-township', 'township', array['Ewing Township', 'EWING TWP']::text[], '1102', '3402122185', '882128', '1102'),
  (11, 'Hamilton Township', 'hamilton-township', 'township', array['Hamilton Township', 'HAMILTON TWP']::text[], '1103', '3402129310', '882127', '1103'),
  (11, 'Hightstown Borough', 'hightstown-borough', 'borough', array['Hightstown Borough', 'HIGHTSTOWN BORO']::text[], '1104', '3402131620', '885254', '1104'),
  (11, 'Hopewell Borough', 'hopewell-borough', 'borough', array['Hopewell Borough', 'HOPEWELL BORO']::text[], '1105', '3402133150', '885260', '1105'),
  (11, 'Hopewell Township', 'hopewell-township', 'township', array['Hopewell Township', 'HOPEWELL TWP']::text[], '1106', '3402133180', '882129', '1106'),
  (11, 'Lawrence Township', 'lawrence-township', 'township', array['Lawrence Township', 'LAWRENCE TWP']::text[], '1107', '3402139510', '882126', '1107'),
  (11, 'Pennington Borough', 'pennington-borough', 'borough', array['Pennington Borough', 'PENNINGTON BORO']::text[], '1108', '3402157600', '885347', '1108'),
  (11, 'Princeton', 'princeton', 'borough', array['Princeton', 'PRINCETON']::text[], '1114', '3402160900', '2743608', '1114'),
  (11, 'Robbinsville Township', 'robbinsville-township', 'township', array['Robbinsville Township', 'ROBBINSVILLE TWP']::text[], '1112', '3402163850', '882122', '1112'),
  (11, 'Trenton City', 'trenton-city', 'city', array['Trenton', 'TRENTON CITY']::text[], '1111', '3402174000', '885421', '1111'),
  (11, 'West Windsor Township', 'west-windsor-township', 'township', array['West Windsor Township', 'WEST WINDSOR TWP']::text[], '1113', '3402180240', '882124', '1113'),
  (12, 'Carteret Borough', 'carteret-borough', 'borough', array['Carteret Borough', 'CARTERET BORO']::text[], '1201', '3402310750', '885181', '1201'),
  (12, 'Cranbury Township', 'cranbury-township', 'township', array['Cranbury Township', 'CRANBURY TWP']::text[], '1202', '3402315550', '882160', '1202'),
  (12, 'Dunellen Borough', 'dunellen-borough', 'borough', array['Dunellen Borough', 'DUNELLEN BORO']::text[], '1203', '3402318490', '885198', '1203'),
  (12, 'East Brunswick Township', 'east-brunswick-township', 'township', array['East Brunswick Township', 'EAST BRUNSWICK TWP']::text[], '1204', '3402319000', '882163', '1204'),
  (12, 'Edison Township', 'edison-township', 'township', array['Edison Township', 'EDISON TWP']::text[], '1205', '3402320230', '882166', '1205'),
  (12, 'Helmetta Borough', 'helmetta-borough', 'borough', array['Helmetta Borough', 'HELMETTA BORO']::text[], '1206', '3402330840', '885250', '1206'),
  (12, 'Highland Park Borough', 'highland-park-borough', 'borough', array['Highland Park Borough', 'HIGHLAND PARK BORO']::text[], '1207', '3402331470', '885252', '1207'),
  (12, 'Jamesburg Borough', 'jamesburg-borough', 'borough', array['Jamesburg Borough', 'JAMESBURG BORO']::text[], '1208', '3402334890', '885263', '1208'),
  (12, 'Metuchen Borough', 'metuchen-borough', 'borough', array['Metuchen Borough', 'METUCHEN BORO']::text[], '1209', '3402345690', '885298', '1210'),
  (12, 'Middlesex Borough', 'middlesex-borough', 'borough', array['Middlesex Borough', 'MIDDLESEX BORO']::text[], '1210', '3402345900', '885299', '1211'),
  (12, 'Milltown Borough', 'milltown-borough', 'borough', array['Milltown Borough', 'MILLTOWN BORO']::text[], '1211', '3402346620', '885303', '1212'),
  (12, 'Monroe Township', 'monroe-township', 'township', array['Monroe Township', 'MONROE TWP']::text[], '1212', '3402347280', '882159', '1213'),
  (12, 'New Brunswick City', 'new-brunswick-city', 'city', array['New Brunswick', 'NEW BRUNSWICK CITY']::text[], '1213', '3402351210', '885318', '1214'),
  (12, 'North Brunswick Township', 'north-brunswick-township', 'township', array['North Brunswick Township', 'NORTH BRUNSWICK TWP']::text[], '1214', '3402352560', '882164', '1215'),
  (12, 'Old Bridge Township', 'old-bridge-township', 'township', array['Old Bridge Township', 'OLD BRIDGE TWP']::text[], '1215', '3402354705', '882158', '1209'),
  (12, 'Perth Amboy City', 'perth-amboy-city', 'city', array['Perth Amboy', 'PERTH AMBOY CITY']::text[], '1216', '3402358200', '885349', '1216'),
  (12, 'Piscataway Township', 'piscataway-township', 'township', array['Piscataway Township', 'PISCATAWAY TWP']::text[], '1217', '3402359010', '882167', '1217'),
  (12, 'Plainsboro Township', 'plainsboro-township', 'township', array['Plainsboro Township', 'PLAINSBORO TWP']::text[], '1218', '3402359280', '882161', '1218'),
  (12, 'Sayreville Borough', 'sayreville-borough', 'borough', array['Sayreville Borough', 'SAYREVILLE BORO']::text[], '1219', '3402365790', '885386', '1219'),
  (12, 'South Amboy City', 'south-amboy-city', 'city', array['South Amboy', 'SOUTH AMBOY CITY']::text[], '1220', '3402368550', '885399', '1220'),
  (12, 'South Brunswick Township', 'south-brunswick-township', 'township', array['South Brunswick Township', 'SOUTH BRUNSWICK TWP']::text[], '1221', '3402368790', '882162', '1221'),
  (12, 'South Plainfield Borough', 'south-plainfield-borough', 'borough', array['South Plainfield Borough', 'SOUTH PLAINFIELD BORO']::text[], '1222', '3402369390', '885402', '1222'),
  (12, 'South River Borough', 'south-river-borough', 'borough', array['South River Borough', 'SOUTH RIVER BORO']::text[], '1223', '3402369420', '885403', '1223'),
  (12, 'Spotswood Borough', 'spotswood-borough', 'borough', array['Spotswood Borough', 'SPOTSWOOD BORO']::text[], '1224', '3402369810', '885405', '1224'),
  (12, 'Woodbridge Township', 'woodbridge-township', 'township', array['Woodbridge Township', 'WOODBRIDGE TWP']::text[], '1225', '3402382000', '882165', '1225'),
  (13, 'Aberdeen Township', 'aberdeen-township', 'township', array['Aberdeen Township', 'ABERDEEN TWP']::text[], '1301', '3402500070', '882121', '1330'),
  (13, 'Allenhurst Borough', 'allenhurst-borough', 'borough', array['Allenhurst Borough', 'ALLENHURST BORO']::text[], '1302', '3402500730', '885136', '1301'),
  (13, 'Allentown Borough', 'allentown-borough', 'borough', array['Allentown Borough', 'ALLENTOWN BORO']::text[], '1303', '3402500760', '885137', '1302'),
  (13, 'Asbury Park City', 'asbury-park-city', 'city', array['Asbury Park', 'ASBURY PARK CITY']::text[], '1304', '3402501960', '885141', '1303'),
  (13, 'Atlantic Highlands Borough', 'atlantic-highlands-borough', 'borough', array['Atlantic Highlands Borough', 'ATLANTIC HIGHLANDS BORO']::text[], '1305', '3402502110', '885143', '1304'),
  (13, 'Avon-by-the-Sea Borough', 'avon-by-the-sea-borough', 'borough', array['Avon-by-the-Sea Borough', 'AVON-BY-THE-SEA BORO']::text[], '1306', '3402502440', '885147', '1305'),
  (13, 'Belmar Borough', 'belmar-borough', 'borough', array['Belmar Borough', 'BELMAR BORO']::text[], '1307', '3402504930', '885155', '1306'),
  (13, 'Bradley Beach Borough', 'bradley-beach-borough', 'borough', array['Bradley Beach Borough', 'BRADLEY BEACH BORO']::text[], '1308', '3402506970', '885167', '1307'),
  (13, 'Brielle Borough', 'brielle-borough', 'borough', array['Brielle Borough', 'BRIELLE BORO']::text[], '1309', '3402507750', '885170', '1308'),
  (13, 'Colts Neck Township', 'colts-neck-township', 'township', array['Colts Neck Township', 'COLTS NECK TWP']::text[], '1310', '3402514560', '882602', '1309'),
  (13, 'Deal Borough', 'deal-borough', 'borough', array['Deal Borough', 'DEAL BORO']::text[], '1311', '3402516660', '885194', '1310'),
  (13, 'Eatontown Borough', 'eatontown-borough', 'borough', array['Eatontown Borough', 'EATONTOWN BORO']::text[], '1312', '3402519840', '885202', '1311'),
  (13, 'Englishtown Borough', 'englishtown-borough', 'borough', array['Englishtown Borough', 'ENGLISHTOWN BORO']::text[], '1313', '3402521570', '885211', '1312'),
  (13, 'Fair Haven Borough', 'fair-haven-borough', 'borough', array['Fair Haven Borough', 'FAIR HAVEN BORO']::text[], '1314', '3402522440', '885213', '1313'),
  (13, 'Farmingdale Borough', 'farmingdale-borough', 'borough', array['Farmingdale Borough', 'FARMINGDALE BORO']::text[], '1315', '3402522950', '885218', '1314'),
  (13, 'Freehold Borough', 'freehold-borough', 'borough', array['Freehold Borough', 'FREEHOLD BORO']::text[], '1316', '3402525200', '885226', '1315'),
  (13, 'Freehold Township', 'freehold-township', 'township', array['Freehold Township', 'FREEHOLD TWP']::text[], '1317', '3402525230', '882116', '1316'),
  (13, 'Hazlet Township', 'hazlet-township', 'township', array['Hazlet Township', 'HAZLET TWP']::text[], '1318', '3402530690', '882120', '1339'),
  (13, 'Highlands Borough', 'highlands-borough', 'borough', array['Highlands Borough', 'HIGHLANDS BORO']::text[], '1319', '3402531500', '885253', '1317'),
  (13, 'Holmdel Township', 'holmdel-township', 'township', array['Holmdel Township', 'HOLMDEL TWP']::text[], '1320', '3402532640', '882119', '1318'),
  (13, 'Howell Township', 'howell-township', 'township', array['Howell Township', 'HOWELL TWP']::text[], '1321', '3402533300', '882113', '1319'),
  (13, 'Interlaken Borough', 'interlaken-borough', 'borough', array['Interlaken Borough', 'INTERLAKEN BORO']::text[], '1322', '3402534200', '885261', '1320'),
  (13, 'Keansburg Borough', 'keansburg-borough', 'borough', array['Keansburg Borough', 'KEANSBURG BORO']::text[], '1323', '3402536480', '885265', '1321'),
  (13, 'Keyport Borough', 'keyport-borough', 'borough', array['Keyport Borough', 'KEYPORT BORO']::text[], '1324', '3402536810', '885268', '1322'),
  (13, 'Lake Como Borough', 'lake-como-borough', 'borough', array['Lake Como Borough', 'LAKE COMO BORO']::text[], '1346', '3402537560', '885400', '1347'),
  (13, 'Little Silver Borough', 'little-silver-borough', 'borough', array['Little Silver Borough', 'LITTLE SILVER BORO']::text[], '1325', '3402540770', '885282', '1323'),
  (13, 'Loch Arbour Village', 'loch-arbour-village', 'village', array['Loch Arbour Village', 'LOCH ARBOUR VILLAGE']::text[], '1326', '3402541010', '885283', '1324'),
  (13, 'Long Branch City', 'long-branch-city', 'city', array['Long Branch', 'LONG BRANCH CITY']::text[], '1327', '3402541310', '885285', '1325'),
  (13, 'Manalapan Township', 'manalapan-township', 'township', array['Manalapan Township', 'MANALAPAN TWP']::text[], '1328', '3402542990', '882117', '1326'),
  (13, 'Manasquan Borough', 'manasquan-borough', 'borough', array['Manasquan Borough', 'MANASQUAN BORO']::text[], '1329', '3402543050', '885289', '1327'),
  (13, 'Marlboro Township', 'marlboro-township', 'township', array['Marlboro Township', 'MARLBORO TWP']::text[], '1330', '3402544070', '882118', '1328'),
  (13, 'Matawan Borough', 'matawan-borough', 'borough', array['Matawan Borough', 'MATAWAN BORO']::text[], '1331', '3402544520', '885293', '1329'),
  (13, 'Middletown Township', 'middletown-township', 'township', array['Middletown Township', 'MIDDLETOWN TWP']::text[], '1332', '3402545990', '882604', '1331'),
  (13, 'Millstone Township', 'millstone-township', 'township', array['Millstone Township', 'MILLSTONE TWP']::text[], '1333', '3402546560', '882115', '1332'),
  (13, 'Monmouth Beach Borough', 'monmouth-beach-borough', 'borough', array['Monmouth Beach Borough', 'MONMOUTH BEACH BORO']::text[], '1334', '3402547130', '885305', '1333'),
  (13, 'Neptune City Borough', 'neptune-city-borough', 'borough', array['Neptune City Borough', 'NEPTUNE CITY BORO']::text[], '1336', '3402549920', '885315', '1335'),
  (13, 'Neptune Township', 'neptune-township', 'township', array['Neptune Township', 'NEPTUNE TWP']::text[], '1335', '3402549890', '882111', '1334'),
  (13, 'Ocean Township', 'ocean-township', 'township', array['Ocean Township', 'OCEAN TWP']::text[], '1337', '3402554270', '882601', '1337'),
  (13, 'Oceanport Borough', 'oceanport-borough', 'borough', array['Oceanport Borough', 'OCEANPORT BORO']::text[], '1338', '3402554570', '885334', '1338'),
  (13, 'Red Bank Borough', 'red-bank-borough', 'borough', array['Red Bank Borough', 'RED BANK BORO']::text[], '1339', '3402562430', '885366', '1340'),
  (13, 'Roosevelt Borough', 'roosevelt-borough', 'borough', array['Roosevelt Borough', 'ROOSEVELT BORO']::text[], '1340', '3402564410', '885377', '1341'),
  (13, 'Rumson Borough', 'rumson-borough', 'borough', array['Rumson Borough', 'RUMSON BORO']::text[], '1341', '3402565130', '885381', '1342'),
  (13, 'Sea Bright Borough', 'sea-bright-borough', 'borough', array['Sea Bright Borough', 'SEA BRIGHT BORO']::text[], '1342', '3402566240', '885387', '1343'),
  (13, 'Sea Girt Borough', 'sea-girt-borough', 'borough', array['Sea Girt Borough', 'SEA GIRT BORO']::text[], '1343', '3402566330', '885388', '1344'),
  (13, 'Shrewsbury Borough', 'shrewsbury-borough', 'borough', array['Shrewsbury Borough', 'SHREWSBURY BORO']::text[], '1344', '3402567350', '885395', '1345'),
  (13, 'Shrewsbury Township', 'shrewsbury-township', 'township', array['Shrewsbury Township', 'SHREWSBURY TWP']::text[], '1345', '3402567365', '882603', '1346'),
  (13, 'Spring Lake Borough', 'spring-lake-borough', 'borough', array['Spring Lake Borough', 'SPRING LAKE BORO']::text[], '1347', '3402570110', '885406', '1348'),
  (13, 'Spring Lake Heights Borough', 'spring-lake-heights-borough', 'borough', array['Spring Lake Heights Borough', 'SPRING LAKE HEIGHTS BORO']::text[], '1348', '3402570140', '885407', '1349'),
  (13, 'Tinton Falls Borough', 'tinton-falls-borough', 'borough', array['Tinton Falls Borough', 'TINTON FALLS BORO']::text[], '1349', '3402573020', '885419', '1336'),
  (13, 'Union Beach Borough', 'union-beach-borough', 'borough', array['Union Beach Borough', 'UNION BEACH BORO']::text[], '1350', '3402574540', '885423', '1350'),
  (13, 'Upper Freehold Township', 'upper-freehold-township', 'township', array['Upper Freehold Township', 'UPPER FREEHOLD TWP']::text[], '1351', '3402574900', '882114', '1351'),
  (13, 'Wall Township', 'wall-township', 'township', array['Wall Township', 'WALL TWP']::text[], '1352', '3402576460', '882112', '1352'),
  (13, 'West Long Branch Borough', 'west-long-branch-borough', 'borough', array['West Long Branch Borough', 'WEST LONG BRANCH BORO']::text[], '1353', '3402579310', '885437', '1353'),
  (14, 'Boonton Town', 'boonton-town', 'town', array['Boonton', 'BOONTON TOWN']::text[], '1401', '3402706610', '885164', '1401'),
  (14, 'Boonton Township', 'boonton-township', 'township', array['Boonton Township', 'BOONTON TWP']::text[], '1402', '3402706640', '882205', '1402'),
  (14, 'Butler Borough', 'butler-borough', 'borough', array['Butler Borough', 'BUTLER BORO']::text[], '1403', '3402709040', '885175', '1403'),
  (14, 'Chatham Borough', 'chatham-borough', 'borough', array['Chatham Borough', 'CHATHAM BORO']::text[], '1404', '3402712100', '885182', '1404'),
  (14, 'Chatham Township', 'chatham-township', 'township', array['Chatham Township', 'CHATHAM TWP']::text[], '1405', '3402712130', '882194', '1405'),
  (14, 'Chester Borough', 'chester-borough', 'borough', array['Chester Borough', 'CHESTER BORO']::text[], '1406', '3402712580', '885184', '1406'),
  (14, 'Chester Township', 'chester-township', 'township', array['Chester Township', 'CHESTER TWP']::text[], '1407', '3402712610', '882199', '1407'),
  (14, 'Denville Township', 'denville-township', 'township', array['Denville Township', 'DENVILLE TWP']::text[], '1408', '3402717650', '882204', '1408'),
  (14, 'Dover Town', 'dover-town', 'town', array['Dover', 'DOVER TOWN']::text[], '1409', '3402718070', '885196', '1409'),
  (14, 'East Hanover Township', 'east-hanover-township', 'township', array['East Hanover Township', 'EAST HANOVER TWP']::text[], '1410', '3402719210', '882192', '1410'),
  (14, 'Florham Park Borough', 'florham-park-borough', 'borough', array['Florham Park Borough', 'FLORHAM PARK BORO']::text[], '1411', '3402723910', '885221', '1411'),
  (14, 'Hanover Township', 'hanover-township', 'township', array['Hanover Township', 'HANOVER TWP']::text[], '1412', '3402729550', '882187', '1412'),
  (14, 'Harding Township', 'harding-township', 'township', array['Harding Township', 'HARDING TWP']::text[], '1413', '3402729700', '882195', '1413'),
  (14, 'Jefferson Township', 'jefferson-township', 'township', array['Jefferson Township', 'JEFFERSON TWP']::text[], '1414', '3402734980', '882210', '1414'),
  (14, 'Kinnelon Borough', 'kinnelon-borough', 'borough', array['Kinnelon Borough', 'KINNELON BORO']::text[], '1415', '3402737110', '885269', '1415'),
  (14, 'Lincoln Park Borough', 'lincoln-park-borough', 'borough', array['Lincoln Park Borough', 'LINCOLN PARK BORO']::text[], '1416', '3402740290', '885277', '1416'),
  (14, 'Long Hill Township', 'long-hill-township', 'township', array['Long Hill Township', 'LONG HILL TWP']::text[], '1430', '3402741362', '882196', '1430'),
  (14, 'Madison Borough', 'madison-borough', 'borough', array['Madison Borough', 'MADISON BORO']::text[], '1417', '3402742510', '885287', '1417'),
  (14, 'Mendham Borough', 'mendham-borough', 'borough', array['Mendham Borough', 'MENDHAM BORO']::text[], '1418', '3402745330', '885296', '1418'),
  (14, 'Mendham Township', 'mendham-township', 'township', array['Mendham Township', 'MENDHAM TWP']::text[], '1419', '3402745360', '882200', '1419'),
  (14, 'Mine Hill Township', 'mine-hill-township', 'township', array['Mine Hill Township', 'MINE HILL TWP']::text[], '1420', '3402746860', '882202', '1420'),
  (14, 'Montville Township', 'montville-township', 'township', array['Montville Township', 'MONTVILLE TWP']::text[], '1421', '3402747670', '882207', '1421'),
  (14, 'Morris Plains Borough', 'morris-plains-borough', 'borough', array['Morris Plains Borough', 'MORRIS PLAINS BORO']::text[], '1423', '3402748210', '885308', '1423'),
  (14, 'Morris Township', 'morris-township', 'township', array['Morris Township', 'MORRIS TWP']::text[], '1422', '3402748090', '882193', '1422'),
  (14, 'Morristown Town', 'morristown-town', 'town', array['Morristown', 'MORRISTOWN TOWN']::text[], '1424', '3402748300', '885309', '1424'),
  (14, 'Mount Arlington Borough', 'mount-arlington-borough', 'borough', array['Mount Arlington Borough', 'MOUNT ARLINGTON BORO']::text[], '1426', '3402748690', '885312', '1426'),
  (14, 'Mount Olive Township', 'mount-olive-township', 'township', array['Mount Olive Township', 'MOUNT OLIVE TWP']::text[], '1427', '3402749080', '882197', '1427'),
  (14, 'Mountain Lakes Borough', 'mountain-lakes-borough', 'borough', array['Mountain Lakes Borough', 'MOUNTAIN LAKES BORO']::text[], '1425', '3402748480', '885310', '1425'),
  (14, 'Netcong Borough', 'netcong-borough', 'borough', array['Netcong Borough', 'NETCONG BORO']::text[], '1428', '3402750130', '885316', '1428'),
  (14, 'Parsippany-Troy Hills Township', 'parsippany-troy-hills-township', 'township', array['Parsippany-Troy Hills Township', 'PARSIPPANY-TROY HILLS TWP']::text[], '1429', '3402756460', '882206', '1429'),
  (14, 'Pequannock Township', 'pequannock-township', 'township', array['Pequannock Township', 'PEQUANNOCK TWP']::text[], '1431', '3402758110', '882208', '1431'),
  (14, 'Randolph Township', 'randolph-township', 'township', array['Randolph Township', 'RANDOLPH TWP']::text[], '1432', '3402761890', '882201', '1432'),
  (14, 'Riverdale Borough', 'riverdale-borough', 'borough', array['Riverdale Borough', 'RIVERDALE BORO']::text[], '1433', '3402763300', '885371', '1433'),
  (14, 'Rockaway Borough', 'rockaway-borough', 'borough', array['Rockaway Borough', 'ROCKAWAY BORO']::text[], '1434', '3402764050', '885374', '1434'),
  (14, 'Rockaway Township', 'rockaway-township', 'township', array['Rockaway Township', 'ROCKAWAY TWP']::text[], '1435', '3402764080', '882209', '1435'),
  (14, 'Roxbury Township', 'roxbury-township', 'township', array['Roxbury Township', 'ROXBURY TWP']::text[], '1436', '3402764980', '882203', '1436'),
  (14, 'Victory Gardens Borough', 'victory-gardens-borough', 'borough', array['Victory Gardens Borough', 'VICTORY GARDENS BORO']::text[], '1437', '3402775890', '885427', '1437'),
  (14, 'Washington Township', 'washington-township', 'township', array['Washington Township', 'WASHINGTON TWP']::text[], '1438', '3402777240', '882198', '1438'),
  (14, 'Wharton Borough', 'wharton-borough', 'borough', array['Wharton Borough', 'WHARTON BORO']::text[], '1439', '3402780390', '885443', '1439'),
  (15, 'Barnegat Light Borough', 'barnegat-light-borough', 'borough', array['Barnegat Light Borough', 'BARNEGAT LIGHT BORO']::text[], '1502', '3402903130', '885148', '1501'),
  (15, 'Barnegat Township', 'barnegat-township', 'township', array['Barnegat Township', 'BARNEGAT TWP']::text[], '1501', '3402903050', '882070', '1533'),
  (15, 'Bay Head Borough', 'bay-head-borough', 'borough', array['Bay Head Borough', 'BAY HEAD BORO']::text[], '1503', '3402903520', '885150', '1502'),
  (15, 'Beach Haven Borough', 'beach-haven-borough', 'borough', array['Beach Haven Borough', 'BEACH HAVEN BORO']::text[], '1504', '3402903940', '885152', '1503'),
  (15, 'Beachwood Borough', 'beachwood-borough', 'borough', array['Beachwood Borough', 'BEACHWOOD BORO']::text[], '1505', '3402904180', '885153', '1504'),
  (15, 'Berkeley Township', 'berkeley-township', 'township', array['Berkeley Township', 'BERKELEY TWP']::text[], '1506', '3402905305', '882073', '1505'),
  (15, 'Brick Township', 'brick-township', 'township', array['Brick Township', 'BRICK TWP']::text[], '1507', '3402907420', '882075', '1506'),
  (15, 'Eagleswood Township', 'eagleswood-township', 'township', array['Eagleswood Township', 'EAGLESWOOD TWP']::text[], '1509', '3402918670', '882068', '1508'),
  (15, 'Harvey Cedars Borough', 'harvey-cedars-borough', 'borough', array['Harvey Cedars Borough', 'HARVEY CEDARS BORO']::text[], '1510', '3402930390', '885246', '1509'),
  (15, 'Island Heights Borough', 'island-heights-borough', 'borough', array['Island Heights Borough', 'ISLAND HEIGHTS BORO']::text[], '1511', '3402934530', '885262', '1510'),
  (15, 'Jackson Township', 'jackson-township', 'township', array['Jackson Township', 'JACKSON TWP']::text[], '1512', '3402934680', '882079', '1511'),
  (15, 'Lacey Township', 'lacey-township', 'township', array['Lacey Township', 'LACEY TWP']::text[], '1513', '3402937380', '882072', '1512'),
  (15, 'Lakehurst Borough', 'lakehurst-borough', 'borough', array['Lakehurst Borough', 'LAKEHURST BORO']::text[], '1514', '3402937770', '885270', '1513'),
  (15, 'Lakewood Township', 'lakewood-township', 'township', array['Lakewood Township', 'LAKEWOOD TWP']::text[], '1515', '3402938550', '882076', '1514'),
  (15, 'Lavallette Borough', 'lavallette-borough', 'borough', array['Lavallette Borough', 'LAVALLETTE BORO']::text[], '1516', '3402939390', '885273', '1515'),
  (15, 'Little Egg Harbor Township', 'little-egg-harbor-township', 'township', array['Little Egg Harbor Township', 'LITTLE EGG HARBOR TWP']::text[], '1517', '3402940560', '882067', '1516'),
  (15, 'Long Beach Township', 'long-beach-township', 'township', array['Long Beach Township', 'LONG BEACH TWP']::text[], '1518', '3402941250', '882066', '1517'),
  (15, 'Manchester Township', 'manchester-township', 'township', array['Manchester Township', 'MANCHESTER TWP']::text[], '1519', '3402943140', '882077', '1518'),
  (15, 'Mantoloking Borough', 'mantoloking-borough', 'borough', array['Mantoloking Borough', 'MANTOLOKING BORO']::text[], '1520', '3402943380', '885290', '1519'),
  (15, 'Ocean Gate Borough', 'ocean-gate-borough', 'borough', array['Ocean Gate Borough', 'OCEAN GATE BORO']::text[], '1522', '3402954450', '885333', '1521'),
  (15, 'Ocean Township', 'ocean-township', 'township', array['Ocean Township', 'OCEAN TWP']::text[], '1521', '3402954300', '882071', '1520'),
  (15, 'Pine Beach Borough', 'pine-beach-borough', 'borough', array['Pine Beach Borough', 'PINE BEACH BORO']::text[], '1523', '3402958590', '885351', '1522'),
  (15, 'Plumsted Township', 'plumsted-township', 'township', array['Plumsted Township', 'PLUMSTED TWP']::text[], '1524', '3402959790', '882078', '1523'),
  (15, 'Point Pleasant Beach Borough', 'point-pleasant-beach-borough', 'borough', array['Point Pleasant Beach Borough', 'POINT PLEASANT BEACH BORO']::text[], '1526', '3402959910', '885358', '1525'),
  (15, 'Point Pleasant Borough', 'point-pleasant-borough', 'borough', array['Point Pleasant Borough', 'POINT PLEASANT BORO']::text[], '1525', '3402959880', '885357', '1524'),
  (15, 'Seaside Heights Borough', 'seaside-heights-borough', 'borough', array['Seaside Heights Borough', 'SEASIDE HEIGHTS BORO']::text[], '1527', '3402966450', '885390', '1526'),
  (15, 'Seaside Park Borough', 'seaside-park-borough', 'borough', array['Seaside Park Borough', 'SEASIDE PARK BORO']::text[], '1528', '3402966480', '885391', '1527'),
  (15, 'Ship Bottom Borough', 'ship-bottom-borough', 'borough', array['Ship Bottom Borough', 'SHIP BOTTOM BORO']::text[], '1529', '3402967110', '885394', '1528'),
  (15, 'South Toms River Borough', 'south-toms-river-borough', 'borough', array['South Toms River Borough', 'SOUTH TOMS RIVER BORO']::text[], '1530', '3402969510', '885404', '1529'),
  (15, 'Stafford Township', 'stafford-township', 'township', array['Stafford Township', 'STAFFORD TWP']::text[], '1531', '3402970320', '882069', '1530'),
  (15, 'Surf City Borough', 'surf-city-borough', 'borough', array['Surf City Borough', 'SURF CITY BORO']::text[], '1532', '3402971640', '885413', '1531'),
  (15, 'Toms River Township', 'toms-river-township', 'township', array['Toms River Township', 'TOMS RIVER TWP']::text[], '1508', '3402973125', '882074', '1507'),
  (15, 'Tuckerton Borough', 'tuckerton-borough', 'borough', array['Tuckerton Borough', 'TUCKERTON BORO']::text[], '1533', '3402974210', '885422', '1532'),
  (16, 'Bloomingdale Borough', 'bloomingdale-borough', 'borough', array['Bloomingdale Borough', 'BLOOMINGDALE BORO']::text[], '1601', '3403106340', '885161', '1601'),
  (16, 'Clifton City', 'clifton-city', 'city', array['Clifton', 'CLIFTON CITY']::text[], '1602', '3403113690', '885188', '1602'),
  (16, 'Haledon Borough', 'haledon-borough', 'borough', array['Haledon Borough', 'HALEDON BORO']::text[], '1603', '3403129070', '885240', '1603'),
  (16, 'Hawthorne Borough', 'hawthorne-borough', 'borough', array['Hawthorne Borough', 'HAWTHORNE BORO']::text[], '1604', '3403130570', '885249', '1604'),
  (16, 'Little Falls Township', 'little-falls-township', 'township', array['Little Falls Township', 'LITTLE FALLS TWP']::text[], '1605', '3403140620', '882313', '1605'),
  (16, 'North Haledon Borough', 'north-haledon-borough', 'borough', array['North Haledon Borough', 'NORTH HALEDON BORO']::text[], '1606', '3403153040', '885325', '1606'),
  (16, 'Passaic City', 'passaic-city', 'city', array['Passaic', 'PASSAIC CITY']::text[], '1607', '3403156550', '885342', '1607'),
  (16, 'Paterson City', 'paterson-city', 'city', array['Paterson', 'PATERSON CITY']::text[], '1608', '3403157000', '885343', '1608'),
  (16, 'Pompton Lakes Borough', 'pompton-lakes-borough', 'borough', array['Pompton Lakes Borough', 'POMPTON LAKES BORO']::text[], '1609', '3403160090', '885359', '1609'),
  (16, 'Prospect Park Borough', 'prospect-park-borough', 'borough', array['Prospect Park Borough', 'PROSPECT PARK BORO']::text[], '1610', '3403161170', '885362', '1610'),
  (16, 'Ringwood Borough', 'ringwood-borough', 'borough', array['Ringwood Borough', 'RINGWOOD BORO']::text[], '1611', '3403163150', '885370', '1611'),
  (16, 'Totowa Borough', 'totowa-borough', 'borough', array['Totowa Borough', 'TOTOWA BORO']::text[], '1612', '3403173140', '885420', '1612'),
  (16, 'Wanaque Borough', 'wanaque-borough', 'borough', array['Wanaque Borough', 'WANAQUE BORO']::text[], '1613', '3403176730', '885431', '1613'),
  (16, 'Wayne Township', 'wayne-township', 'township', array['Wayne Township', 'WAYNE TWP']::text[], '1614', '3403177840', '882314', '1614'),
  (16, 'West Milford Township', 'west-milford-township', 'township', array['West Milford Township', 'WEST MILFORD TWP']::text[], '1615', '3403179460', '882315', '1615'),
  (16, 'Woodland Park Borough', 'woodland-park-borough', 'borough', array['Woodland Park Borough', 'WOODLAND PARK BORO']::text[], '1616', '3403182423', '885439', '1616'),
  (17, 'Alloway Township', 'alloway-township', 'township', array['Alloway Township', 'ALLOWAY TWP']::text[], '1701', '3403300880', '882131', '1701'),
  (17, 'Carneys Point Township', 'carneys-point-township', 'township', array['Carneys Point Township', 'CARNEYS POINT TWP']::text[], '1702', '3403310610', '882135', '1713'),
  (17, 'Elmer Borough', 'elmer-borough', 'borough', array['Elmer Borough', 'ELMER BORO']::text[], '1703', '3403321240', '885206', '1702'),
  (17, 'Elsinboro Township', 'elsinboro-township', 'township', array['Elsinboro Township', 'ELSINBORO TWP']::text[], '1704', '3403321330', '882064', '1703'),
  (17, 'Lower Alloways Creek Township', 'lower-alloways-creek-township', 'township', array['Lower Alloways Creek Township', 'LOWER ALLOWAYS CREEK TWP']::text[], '1705', '3403341640', '882065', '1704'),
  (17, 'Mannington Township', 'mannington-township', 'township', array['Mannington Township', 'MANNINGTON TWP']::text[], '1706', '3403343200', '882133', '1705'),
  (17, 'Oldmans Township', 'oldmans-township', 'township', array['Oldmans Township', 'OLDMANS TWP']::text[], '1707', '3403354810', '882136', '1706'),
  (17, 'Penns Grove Borough', 'penns-grove-borough', 'borough', array['Penns Grove Borough', 'PENNS GROVE BORO']::text[], '1708', '3403357750', '885348', '1707'),
  (17, 'Pennsville Township', 'pennsville-township', 'township', array['Pennsville Township', 'PENNSVILLE TWP']::text[], '1709', '3403357870', '882134', '1708'),
  (17, 'Pilesgrove Township', 'pilesgrove-township', 'township', array['Pilesgrove Township', 'PILESGROVE TWP']::text[], '1710', '3403358530', '882132', '1709'),
  (17, 'Pittsgrove Township', 'pittsgrove-township', 'township', array['Pittsgrove Township', 'PITTSGROVE TWP']::text[], '1711', '3403359130', '1729723', '1710'),
  (17, 'Quinton Township', 'quinton-township', 'township', array['Quinton Township', 'QUINTON TWP']::text[], '1712', '3403361470', '882130', '1711'),
  (17, 'Salem City', 'salem-city', 'city', array['Salem', 'SALEM CITY']::text[], '1713', '3403365490', '885385', '1712'),
  (17, 'Upper Pittsgrove Township', 'upper-pittsgrove-township', 'township', array['Upper Pittsgrove Township', 'UPPER PITTSGROVE TWP']::text[], '1714', '3403375110', '1723212', '1714'),
  (17, 'Woodstown Borough', 'woodstown-borough', 'borough', array['Woodstown Borough', 'WOODSTOWN BORO']::text[], '1715', '3403382720', '885452', '1715'),
  (18, 'Bedminster Township', 'bedminster-township', 'township', array['Bedminster Township', 'BEDMINSTER TWP']::text[], '1801', '3403504450', '882176', '1801'),
  (18, 'Bernards Township', 'bernards-township', 'township', array['Bernards Township', 'BERNARDS TWP']::text[], '1802', '3403505560', '882174', '1802'),
  (18, 'Bernardsville Borough', 'bernardsville-borough', 'borough', array['Bernardsville Borough', 'BERNARDSVILLE BORO']::text[], '1803', '3403505590', '885159', '1803'),
  (18, 'Bound Brook Borough', 'bound-brook-borough', 'borough', array['Bound Brook Borough', 'BOUND BROOK BORO']::text[], '1804', '3403506790', '885166', '1804'),
  (18, 'Branchburg Township', 'branchburg-township', 'township', array['Branchburg Township', 'BRANCHBURG TWP']::text[], '1805', '3403507180', '882175', '1805'),
  (18, 'Bridgewater Township', 'bridgewater-township', 'township', array['Bridgewater Township', 'BRIDGEWATER TWP']::text[], '1806', '3403507720', '882171', '1806'),
  (18, 'Far Hills Borough', 'far-hills-borough', 'borough', array['Far Hills Borough', 'FAR HILLS BORO']::text[], '1807', '3403522890', '885217', '1807'),
  (18, 'Franklin Township', 'franklin-township', 'township', array['Franklin Township', 'FRANKLIN TWP']::text[], '1808', '3403524900', '882170', '1808'),
  (18, 'Green Brook Township', 'green-brook-township', 'township', array['Green Brook Township', 'GREEN BROOK TWP']::text[], '1809', '3403527510', '882172', '1809'),
  (18, 'Hillsborough Township', 'hillsborough-township', 'township', array['Hillsborough Township', 'HILLSBOROUGH TWP']::text[], '1810', '3403531890', '882169', '1810'),
  (18, 'Manville Borough', 'manville-borough', 'borough', array['Manville Borough', 'MANVILLE BORO']::text[], '1811', '3403543620', '885291', '1811'),
  (18, 'Millstone Borough', 'millstone-borough', 'borough', array['Millstone Borough', 'MILLSTONE BORO']::text[], '1812', '3403546590', '885302', '1812'),
  (18, 'Montgomery Township', 'montgomery-township', 'township', array['Montgomery Township', 'MONTGOMERY TWP']::text[], '1813', '3403547580', '882168', '1813'),
  (18, 'North Plainfield Borough', 'north-plainfield-borough', 'borough', array['North Plainfield Borough', 'NORTH PLAINFIELD BORO']::text[], '1814', '3403553280', '885326', '1814'),
  (18, 'Peapack-Gladstone Borough', 'peapack-gladstone-borough', 'borough', array['Peapack-Gladstone Borough', 'PEAPACK-GLADSTONE BORO']::text[], '1815', '3403557300', '885345', '1815'),
  (18, 'Raritan Borough', 'raritan-borough', 'borough', array['Raritan Borough', 'RARITAN BORO']::text[], '1816', '3403561980', '885365', '1816'),
  (18, 'Rocky Hill Borough', 'rocky-hill-borough', 'borough', array['Rocky Hill Borough', 'ROCKY HILL BORO']::text[], '1817', '3403564320', '885376', '1817'),
  (18, 'Somerville Borough', 'somerville-borough', 'borough', array['Somerville Borough', 'SOMERVILLE BORO']::text[], '1818', '3403568460', '885398', '1818'),
  (18, 'South Bound Brook Borough', 'south-bound-brook-borough', 'borough', array['South Bound Brook Borough', 'SOUTH BOUND BROOK BORO']::text[], '1819', '3403568730', '885401', '1819'),
  (18, 'Warren Township', 'warren-township', 'township', array['Warren Township', 'WARREN TWP']::text[], '1820', '3403576940', '882173', '1820'),
  (18, 'Watchung Borough', 'watchung-borough', 'borough', array['Watchung Borough', 'WATCHUNG BORO']::text[], '1821', '3403577600', '885433', '1821'),
  (19, 'Andover Borough', 'andover-borough', 'borough', array['Andover Borough', 'ANDOVER BORO']::text[], '1901', '3403701330', '885140', '1901'),
  (19, 'Andover Township', 'andover-township', 'township', array['Andover Township', 'ANDOVER TWP']::text[], '1902', '3403701360', '882266', '1902'),
  (19, 'Branchville Borough', 'branchville-borough', 'borough', array['Branchville Borough', 'BRANCHVILLE BORO']::text[], '1903', '3403707300', '885168', '1903'),
  (19, 'Byram Township', 'byram-township', 'township', array['Byram Township', 'BYRAM TWP']::text[], '1904', '3403709160', '882263', '1904'),
  (19, 'Frankford Township', 'frankford-township', 'township', array['Frankford Township', 'FRANKFORD TWP']::text[], '1905', '3403724810', '882267', '1905'),
  (19, 'Franklin Borough', 'franklin-borough', 'borough', array['Franklin Borough', 'FRANKLIN BORO']::text[], '1906', '3403724930', '885224', '1906'),
  (19, 'Fredon Township', 'fredon-township', 'township', array['Fredon Township', 'FREDON TWP']::text[], '1907', '3403725140', '882268', '1907'),
  (19, 'Green Township', 'green-township', 'township', array['Green Township', 'GREEN TWP']::text[], '1908', '3403727420', '882264', '1908'),
  (19, 'Hamburg Borough', 'hamburg-borough', 'borough', array['Hamburg Borough', 'HAMBURG BORO']::text[], '1909', '3403729220', '885241', '1909'),
  (19, 'Hampton Township', 'hampton-township', 'township', array['Hampton Township', 'HAMPTON TWP']::text[], '1910', '3403729490', '882261', '1910'),
  (19, 'Hardyston Township', 'hardyston-township', 'township', array['Hardyston Township', 'HARDYSTON TWP']::text[], '1911', '3403729850', '882269', '1911'),
  (19, 'Hopatcong Borough', 'hopatcong-borough', 'borough', array['Hopatcong Borough', 'HOPATCONG BORO']::text[], '1912', '3403732910', '885259', '1912'),
  (19, 'Lafayette Township', 'lafayette-township', 'township', array['Lafayette Township', 'LAFAYETTE TWP']::text[], '1913', '3403737440', '882260', '1913'),
  (19, 'Montague Township', 'montague-township', 'township', array['Montague Township', 'MONTAGUE TWP']::text[], '1914', '3403747430', '882256', '1914'),
  (19, 'Newton Town', 'newton-town', 'town', array['Newton', 'NEWTON TOWN']::text[], '1915', '3403751930', '885322', '1915'),
  (19, 'Ogdensburg Borough', 'ogdensburg-borough', 'borough', array['Ogdensburg Borough', 'OGDENSBURG BORO']::text[], '1916', '3403754660', '885335', '1916'),
  (19, 'Sandyston Township', 'sandyston-township', 'township', array['Sandyston Township', 'SANDYSTON TWP']::text[], '1917', '3403765700', '882255', '1917'),
  (19, 'Sparta Township', 'sparta-township', 'township', array['Sparta Township', 'SPARTA TWP']::text[], '1918', '3403769690', '882265', '1918'),
  (19, 'Stanhope Borough', 'stanhope-borough', 'borough', array['Stanhope Borough', 'STANHOPE BORO']::text[], '1919', '3403770380', '885408', '1919'),
  (19, 'Stillwater Township', 'stillwater-township', 'township', array['Stillwater Township', 'STILLWATER TWP']::text[], '1920', '3403770890', '882262', '1920'),
  (19, 'Sussex Borough', 'sussex-borough', 'borough', array['Sussex Borough', 'SUSSEX BORO']::text[], '1921', '3403771670', '885414', '1921'),
  (19, 'Vernon Township', 'vernon-township', 'township', array['Vernon Township', 'VERNON TWP']::text[], '1922', '3403775740', '882258', '1922'),
  (19, 'Walpack Township', 'walpack-township', 'township', array['Walpack Township', 'WALPACK TWP']::text[], '1923', '3403776640', '882259', '1923'),
  (19, 'Wantage Township', 'wantage-township', 'township', array['Wantage Township', 'WANTAGE TWP']::text[], '1924', '3403776790', '882257', '1924'),
  (20, 'Berkeley Heights Township', 'berkeley-heights-township', 'township', array['Berkeley Heights Township', 'BERKELEY HEIGHTS TWP']::text[], '2001', '3403905320', '882218', '2001'),
  (20, 'Clark Township', 'clark-township', 'township', array['Clark Township', 'CLARK TWP']::text[], '2002', '3403913150', '882216', '2002'),
  (20, 'Cranford Township', 'cranford-township', 'township', array['Cranford Township', 'CRANFORD TWP']::text[], '2003', '3403915640', '882214', '2003'),
  (20, 'Elizabeth City', 'elizabeth-city', 'city', array['Elizabeth', 'ELIZABETH CITY']::text[], '2004', '3403921000', '885205', '2004'),
  (20, 'Fanwood Borough', 'fanwood-borough', 'borough', array['Fanwood Borough', 'FANWOOD BORO']::text[], '2005', '3403922860', '885216', '2005'),
  (20, 'Garwood Borough', 'garwood-borough', 'borough', array['Garwood Borough', 'GARWOOD BORO']::text[], '2006', '3403925800', '885229', '2006'),
  (20, 'Hillside Township', 'hillside-township', 'township', array['Hillside Township', 'HILLSIDE TWP']::text[], '2007', '3403931980', '882211', '2007'),
  (20, 'Kenilworth Borough', 'kenilworth-borough', 'borough', array['Kenilworth Borough', 'KENILWORTH BORO']::text[], '2008', '3403936690', '885267', '2008'),
  (20, 'Linden City', 'linden-city', 'city', array['Linden', 'LINDEN CITY']::text[], '2009', '3403940350', '885278', '2009'),
  (20, 'Mountainside Borough', 'mountainside-borough', 'borough', array['Mountainside Borough', 'MOUNTAINSIDE BORO']::text[], '2010', '3403948510', '885311', '2010'),
  (20, 'New Providence Borough', 'new-providence-borough', 'borough', array['New Providence Borough', 'NEW PROVIDENCE BORO']::text[], '2011', '3403951810', '885321', '2011'),
  (20, 'Plainfield City', 'plainfield-city', 'city', array['Plainfield', 'PLAINFIELD CITY']::text[], '2012', '3403959190', '885355', '2012'),
  (20, 'Rahway City', 'rahway-city', 'city', array['Rahway', 'RAHWAY CITY']::text[], '2013', '3403961530', '885363', '2013'),
  (20, 'Roselle Borough', 'roselle-borough', 'borough', array['Roselle Borough', 'ROSELLE BORO']::text[], '2014', '3403964620', '885379', '2014'),
  (20, 'Roselle Park Borough', 'roselle-park-borough', 'borough', array['Roselle Park Borough', 'ROSELLE PARK BORO']::text[], '2015', '3403964650', '885380', '2015'),
  (20, 'Scotch Plains Township', 'scotch-plains-township', 'township', array['Scotch Plains Township', 'SCOTCH PLAINS TWP']::text[], '2016', '3403966060', '882217', '2016'),
  (20, 'Springfield Township', 'springfield-township', 'township', array['Springfield Township', 'SPRINGFIELD TWP']::text[], '2017', '3403970020', '882213', '2017'),
  (20, 'Summit City', 'summit-city', 'city', array['Summit', 'SUMMIT CITY']::text[], '2018', '3403971430', '885412', '2018'),
  (20, 'Union Township', 'union-township', 'township', array['Union Township', 'UNION TWP']::text[], '2019', '3403974480', '882212', '2019'),
  (20, 'Westfield Town', 'westfield-town', 'town', array['Westfield', 'WESTFIELD TOWN']::text[], '2020', '3403979040', '885436', '2020'),
  (20, 'Winfield Township', 'winfield-township', 'township', array['Winfield Township', 'WINFIELD TWP']::text[], '2021', '3403981650', '882215', '2021'),
  (21, 'Allamuchy Township', 'allamuchy-township', 'township', array['Allamuchy Township', 'ALLAMUCHY TWP']::text[], '2101', '3404100670', '882243', '2101'),
  (21, 'Alpha Borough', 'alpha-borough', 'borough', array['Alpha Borough', 'ALPHA BORO']::text[], '2102', '3404101030', '885138', '2102'),
  (21, 'Belvidere Town', 'belvidere-town', 'town', array['Belvidere', 'BELVIDERE TOWN']::text[], '2103', '3404104990', '885156', '2103'),
  (21, 'Blairstown Township', 'blairstown-township', 'township', array['Blairstown Township', 'BLAIRSTOWN TWP']::text[], '2104', '3404106160', '882317', '2104'),
  (21, 'Franklin Township', 'franklin-township', 'township', array['Franklin Township', 'FRANKLIN TWP']::text[], '2105', '3404124960', '882251', '2105'),
  (21, 'Frelinghuysen Township', 'frelinghuysen-township', 'township', array['Frelinghuysen Township', 'FRELINGHUYSEN TWP']::text[], '2106', '3404125320', '882240', '2106'),
  (21, 'Greenwich Township', 'greenwich-township', 'township', array['Greenwich Township', 'GREENWICH TWP']::text[], '2107', '3404128260', '882253', '2107'),
  (21, 'Hackettstown Town', 'hackettstown-town', 'town', array['Hackettstown', 'HACKETTSTOWN TOWN']::text[], '2108', '3404128710', '885237', '2108'),
  (21, 'Hardwick Township', 'hardwick-township', 'township', array['Hardwick Township', 'HARDWICK TWP']::text[], '2109', '3404129820', '882239', '2109'),
  (21, 'Harmony Township', 'harmony-township', 'township', array['Harmony Township', 'HARMONY TWP']::text[], '2110', '3404130090', '882248', '2110'),
  (21, 'Hope Township', 'hope-township', 'township', array['Hope Township', 'HOPE TWP']::text[], '2111', '3404133060', '882242', '2111'),
  (21, 'Independence Township', 'independence-township', 'township', array['Independence Township', 'INDEPENDENCE TWP']::text[], '2112', '3404133930', '882244', '2112'),
  (21, 'Knowlton Township', 'knowlton-township', 'township', array['Knowlton Township', 'KNOWLTON TWP']::text[], '2113', '3404137320', '882241', '2113'),
  (21, 'Liberty Township', 'liberty-township', 'township', array['Liberty Township', 'LIBERTY TWP']::text[], '2114', '3404140110', '882245', '2114'),
  (21, 'Lopatcong Township', 'lopatcong-township', 'township', array['Lopatcong Township', 'LOPATCONG TWP']::text[], '2115', '3404141490', '882252', '2115'),
  (21, 'Mansfield Township', 'mansfield-township', 'township', array['Mansfield Township', 'MANSFIELD TWP']::text[], '2116', '3404143320', '882249', '2116'),
  (21, 'Oxford Township', 'oxford-township', 'township', array['Oxford Township', 'OXFORD TWP']::text[], '2117', '3404155530', '882247', '2117'),
  (21, 'Phillipsburg Town', 'phillipsburg-town', 'town', array['Phillipsburg', 'PHILLIPSBURG TOWN']::text[], '2119', '3404158350', '885350', '2119'),
  (21, 'Pohatcong Township', 'pohatcong-township', 'township', array['Pohatcong Township', 'POHATCONG TWP']::text[], '2120', '3404159820', '882254', '2120'),
  (21, 'Washington Borough', 'washington-borough', 'borough', array['Washington Borough', 'WASHINGTON BORO']::text[], '2121', '3404177270', '885432', '2121'),
  (21, 'Washington Township', 'washington-township', 'township', array['Washington Township', 'WASHINGTON TWP']::text[], '2122', '3404177300', '882250', '2122'),
  (21, 'White Township', 'white-township', 'township', array['White Township', 'WHITE TWP']::text[], '2123', '3404180570', '882246', '2123');
-- GENERATED_MUNICIPALITY_SEED_END

insert into public.sources (
  name, source_type, homepage_url, feed_url, ingestion_method, scope,
  county_id, topics, priority, poll_interval_minutes, rights_notes,
  editorial_notes, verified_at
) values
  ('NJ Spotlight News', 'journalism', 'https://www.njspotlightnews.org/', 'https://www.njspotlightnews.org/feed/', 'rss', 'state', null, array['state government','policy','education','health'], 95, 30, 'Store feed metadata and source links only; no article bodies.', 'Statewide public-affairs journalism.', '2026-08-21T00:00:00Z'),
  ('New Jersey Monitor', 'journalism', 'https://newjerseymonitor.com/', 'https://newjerseymonitor.com/feed/', 'rss', 'state', null, array['state government','policy','courts'], 95, 30, 'Store feed metadata and source links only; no article bodies.', 'Statehouse and public-policy coverage.', '2026-08-21T00:00:00Z'),
  ('New Jersey Globe', 'journalism', 'https://newjerseyglobe.com/', 'https://newjerseyglobe.com/feed/', 'rss', 'state', null, array['politics','elections','state government'], 90, 30, 'Store feed metadata and source links only; no article bodies.', 'Politics-focused; treat analysis/opinion distinctly when feed metadata permits.', '2026-08-21T00:00:00Z'),
  ('Insider NJ', 'journalism', 'https://www.insidernj.com/', 'https://www.insidernj.com/feed/', 'rss', 'state', null, array['politics','elections','state government'], 85, 30, 'Store feed metadata and source links only; no article bodies.', 'Politics and public-affairs source.', '2026-08-21T00:00:00Z'),
  ('ROI-NJ', 'business', 'https://www.roi-nj.com/', 'https://www.roi-nj.com/feed/', 'rss', 'state', null, array['business','economy','health','education'], 80, 30, 'Store feed metadata and source links only; no article bodies.', 'New Jersey business and institutional coverage.', '2026-08-21T00:00:00Z'),
  ('NJBIZ', 'business', 'https://njbiz.com/', 'https://njbiz.com/feed/', 'rss', 'state', null, array['business','economy','real estate'], 80, 30, 'Store feed metadata and source links only; no article bodies.', 'Business publication; paywalled links remain links.', '2026-08-21T00:00:00Z'),
  ('NJ.com', 'journalism', 'https://www.nj.com/', 'https://www.nj.com/arc/outboundfeeds/rss/?outputType=xml', 'rss', 'state', null, array['breaking news','local news','politics','sports'], 95, 30, 'Store feed metadata and source links only; no article bodies.', 'High-volume statewide source; clustering must not treat volume as importance.', '2026-08-21T00:00:00Z'),
  ('New Jersey Monthly', 'culture', 'https://njmonthly.com/', 'https://njmonthly.com/feed/', 'rss', 'state', null, array['culture','food','people','places'], 65, 60, 'Store feed metadata and source links only; no article bodies.', 'Lifestyle and long-lead coverage.', '2026-08-21T00:00:00Z'),
  ('New Jersey Stage', 'culture', 'https://www.newjerseystage.com/', 'https://www.newjerseystage.com/articles/rss.xml', 'rss', 'state', null, array['arts','culture','events'], 70, 60, 'Store feed metadata and source links only; no article bodies.', 'Statewide arts feed.', '2026-08-21T00:00:00Z'),
  ('New Jersey Business Magazine', 'business', 'https://njbmagazine.com/', 'https://njbmagazine.com/feed/', 'rss', 'state', null, array['business','economy','workforce'], 70, 60, 'Store feed metadata and source links only; no article bodies.', 'New Jersey Business & Industry Association publication.', '2026-08-21T00:00:00Z'),
  ('New Jersey Future', 'other', 'https://www.njfuture.org/', 'https://www.njfuture.org/feed/', 'rss', 'state', null, array['land use','housing','transportation','environment'], 75, 60, 'Store feed metadata and source links only; no article bodies.', 'Advocacy/research source; preserve organizational provenance.', '2026-08-21T00:00:00Z'),
  ('Sea Isle News', 'journalism', 'https://seaislenews.com/', 'https://seaislenews.com/feed/', 'rss', 'county', 5, array['local news','government','community'], 65, 30, 'Store feed metadata and source links only; no article bodies.', 'Cape May County/local coverage.', '2026-08-21T00:00:00Z'),
  ('BreakingAC', 'journalism', 'https://breakingac.com/', 'https://breakingac.com/feed/', 'rss', 'county', 1, array['breaking news','public safety','courts'], 80, 30, 'Store feed metadata and source links only; no article bodies.', 'Atlantic County breaking-news source; verify sensitive claims across sources.', '2026-08-21T00:00:00Z'),
  ('Route 40', 'journalism', 'https://rtforty.com/', 'https://rtforty.com/feed/', 'rss', 'county', 1, array['local news','accountability','community'], 80, 30, 'Store feed metadata and source links only; no article bodies.', 'Atlantic City regional reporting.', '2026-08-21T00:00:00Z'),
  ('New Jersey Office of the Attorney General', 'government', 'https://www.njoag.gov/', 'https://www.njoag.gov/feed/', 'rss', 'state', null, array['law enforcement','courts','consumer protection'], 90, 30, 'Official public source. Retain feed metadata and links; source claims still require editorial attribution.', 'Primary-source press releases, not independent journalism.', '2026-08-21T00:00:00Z'),
  ('511NJ Active Events', 'transit', 'https://511nj.org/', 'https://511nj.org/RSS511Service/RSS511Service.svc/rest/rss/RSSAllNJActiveEvents', 'rss', 'state', null, array['transportation','traffic','emergency'], 85, 15, 'Official operational feed. Retain bounded feed descriptions and links only.', 'High-volume incident feed; short event window and aggressive exact deduplication.', '2026-08-21T00:00:00Z'),
  ('Rutgers NJAES News', 'other', 'https://njaes.rutgers.edu/', 'https://feeds.feedblitz.com/Rutgers-NJAES-News', 'rss', 'state', null, array['agriculture','environment','research','community'], 60, 120, 'Store feed metadata and source links only; no article bodies.', 'University extension and research source.', '2026-08-21T00:00:00Z'),
  ('New Jersey Resources News Center', 'business', 'https://www.njresources.com/', 'https://www.njresources.com/rss/news-center.xml', 'rss', 'state', null, array['energy','business','infrastructure'], 55, 120, 'Corporate source. Retain feed metadata and links only.', 'Primary corporate releases; preserve provenance and do not treat as independent reporting.', '2026-08-21T00:00:00Z');

-- Activation audit (2026-08-26): preserve these registry records but keep
-- production polling off until their current feed/content issue is resolved.
update public.sources
set active = false,
    last_error_at = now(),
    last_error = case name
      when '511NJ Active Events' then 'Disabled during activation: current RSS items have no stable link or GUID and cannot satisfy source-item provenance requirements.'
      when 'Route 40' then 'Disabled during activation: current feed content is casino spam rather than the expected local-news publication.'
      when 'BreakingAC' then 'Disabled during activation: current feed is substantially partner/promotional content and needs a filtered endpoint or editorial review.'
    end,
    editorial_notes = editorial_notes || case name
      when '511NJ Active Events' then ' Disabled pending a provenance-safe adapter or corrected endpoint.'
      when 'Route 40' then ' Disabled pending restoration of legitimate editorial feed content.'
      when 'BreakingAC' then ' Disabled pending a verified editorial-only feed or category filter.'
    end
where name in ('511NJ Active Events', 'Route 40', 'BreakingAC');

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'counties','municipalities','sources','source_items','stories','story_sources',
    'story_counties','story_municipalities','story_enrichments','story_scores',
    'editorial_queue','editorial_decisions','ingestion_runs','source_run_results'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on table public.%I from public, anon, authenticated', table_name);
    execute format('grant all on table public.%I to service_role', table_name);
  end loop;
end;
$$;

revoke all on function public.set_updated_at() from public, anon, authenticated;
grant execute on function public.set_updated_at() to service_role;
revoke all on function public.set_editorial_state(uuid,text,text,text,text,text,text,text) from public, anon, authenticated;
revoke all on function public.merge_stories(uuid,uuid,text,text,text,text) from public, anon, authenticated;
revoke all on function public.detach_story_source(uuid,uuid,text,text,text,text) from public, anon, authenticated;
grant execute on function public.set_editorial_state(uuid,text,text,text,text,text,text,text) to service_role;
grant execute on function public.merge_stories(uuid,uuid,text,text,text,text) to service_role;
grant execute on function public.detach_story_source(uuid,uuid,text,text,text,text) to service_role;
grant usage, select on all sequences in schema public to service_role;

comment on schema public is 'Internal Reath Digest news-ingestion and editorial-triage schema. No public publication surface.';
comment on table public.source_items is 'Publisher/source evidence. Stores feed metadata and bounded descriptions, never fetched article bodies.';
comment on table public.stories is 'Primary editorial object representing an event/topic cluster.';
comment on table public.editorial_queue is 'Human editorial state and routing metadata. No route auto-publishes.';
