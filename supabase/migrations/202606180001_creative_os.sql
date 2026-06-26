create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  display_name text,
  role text not null default 'viewer' check (role in ('viewer','contributor','editor','admin','owner')),
  identity_provider text not null default 'netlify_identity',
  identity_user_id text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists profiles_email_provider_idx on public.profiles (lower(email), identity_provider);

create table if not exists public.artifacts (
  id text primary key,
  title text not null,
  slug text not null unique,
  description text not null default '',
  artifact_type text not null default 'other',
  source_type text not null default 'uploaded',
  storage_bucket text,
  storage_path text,
  original_file_name text,
  mime_type text,
  file_size bigint,
  file_status text not null default 'metadata_only' check (file_status in ('available','missing','metadata_only','external_only','internal_only','needs_import','archived')),
  external_url text,
  rights_status text not null default 'unknown',
  canon_status text not null default 'experimental',
  review_status text not null default 'needs-review',
  lifecycle_status text not null default 'imported',
  visibility text not null default 'internal' check (visibility in ('internal','private','employee','public')),
  ai_generated boolean,
  ai_model text,
  prompt_used text,
  provenance jsonb not null default '{}'::jsonb,
  legacy_data jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((file_status <> 'available') or (storage_bucket is not null and storage_path is not null))
);
create index if not exists artifacts_status_idx on public.artifacts (file_status, review_status, lifecycle_status);
create index if not exists artifacts_type_idx on public.artifacts (artifact_type);

create table if not exists public.tags (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  tag_type text not null default 'descriptive',
  description text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.artifact_tags (
  artifact_id text not null references public.artifacts(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key (artifact_id, tag_id)
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  parent_id uuid references public.categories(id) on delete set null,
  description text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.artifact_categories (
  artifact_id text not null references public.artifacts(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete cascade,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key (artifact_id, category_id)
);

create table if not exists public.archive_records (
  id text primary key,
  title text not null,
  slug text not null unique,
  type text not null,
  summary text not null default '',
  body text not null default '',
  canon_status text not null default 'experimental',
  review_status text not null default 'needs-review',
  risk_level text not null default 'low' check (risk_level in ('low','medium','high')),
  source_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.artifact_archive_records (
  artifact_id text not null references public.artifacts(id) on delete cascade,
  archive_record_id text not null references public.archive_records(id) on delete cascade,
  relationship_type text not null default 'references',
  notes text not null default '',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key (artifact_id, archive_record_id, relationship_type)
);

create table if not exists public.decisions (
  id text primary key,
  title text not null,
  slug text not null unique,
  issue_summary text not null,
  why_it_matters text not null default '',
  recommended_fix text not null default '',
  status text not null default 'open',
  risk_level text not null default 'medium' check (risk_level in ('low','medium','high')),
  source_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.decision_resolutions (
  id uuid primary key default gen_random_uuid(),
  decision_id text not null references public.decisions(id) on delete cascade,
  selected_resolution text not null,
  custom_resolution text not null default '',
  rationale text not null,
  application_type text not null check (application_type in ('record_only','structured_update','rewrite_request','source_rewrite')),
  canonical_effect text not null default 'unchanged',
  source_effect text not null default 'source prose unchanged',
  submitted_by uuid not null references public.profiles(id),
  reviewed_by uuid references public.profiles(id),
  status text not null default 'pending_review' check (status in ('pending_review','approved','rejected','changes_requested','applied','failed','cancelled')),
  affected_records text[] not null default '{}',
  affected_files text[] not null default '{}',
  follow_up_tasks text[] not null default '{}',
  source_files_changed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.review_requests (
  id uuid primary key default gen_random_uuid(),
  operation_type text not null,
  target_type text not null default 'artifact',
  target_id text,
  submitted_by uuid not null references public.profiles(id),
  reviewed_by uuid references public.profiles(id),
  status text not null default 'pending_review' check (status in ('pending_review','approved','rejected','changes_requested','applied','failed','cancelled')),
  risk_level text not null default 'low' check (risk_level in ('low','medium','high')),
  intent_summary text not null,
  reason text not null default '',
  before_snapshot jsonb not null default '{}'::jsonb,
  after_snapshot jsonb not null default '{}'::jsonb,
  affected_artifacts text[] not null default '{}',
  affected_records text[] not null default '{}',
  affected_files text[] not null default '{}',
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists review_requests_queue_idx on public.review_requests (status, risk_level, created_at desc);

create table if not exists public.review_notes (
  id uuid primary key default gen_random_uuid(),
  review_request_id uuid not null references public.review_requests(id) on delete cascade,
  author_id uuid not null references public.profiles(id),
  note text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id),
  actor_email text,
  actor_role text not null default 'viewer',
  action_type text not null,
  target_type text not null,
  target_id text,
  intent_summary text not null,
  reason text not null default '',
  before_snapshot jsonb not null default '{}'::jsonb,
  after_snapshot jsonb not null default '{}'::jsonb,
  result text not null,
  created_at timestamptz not null default now()
);
create index if not exists audit_events_target_idx on public.audit_events (target_type, target_id, created_at desc);
create index if not exists audit_events_actor_idx on public.audit_events (actor_id, created_at desc);

create table if not exists public.import_batches (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  source text not null,
  status text not null default 'pending_review',
  created_by uuid references public.profiles(id),
  manifest jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.exports (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  export_type text not null,
  status text not null default 'pending',
  storage_bucket text,
  storage_path text,
  manifest jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles for each row execute function public.set_updated_at();
drop trigger if exists artifacts_set_updated_at on public.artifacts;
create trigger artifacts_set_updated_at before update on public.artifacts for each row execute function public.set_updated_at();
drop trigger if exists categories_set_updated_at on public.categories;
create trigger categories_set_updated_at before update on public.categories for each row execute function public.set_updated_at();
drop trigger if exists archive_records_set_updated_at on public.archive_records;
create trigger archive_records_set_updated_at before update on public.archive_records for each row execute function public.set_updated_at();
drop trigger if exists decisions_set_updated_at on public.decisions;
create trigger decisions_set_updated_at before update on public.decisions for each row execute function public.set_updated_at();
drop trigger if exists decision_resolutions_set_updated_at on public.decision_resolutions;
create trigger decision_resolutions_set_updated_at before update on public.decision_resolutions for each row execute function public.set_updated_at();
drop trigger if exists review_requests_set_updated_at on public.review_requests;
create trigger review_requests_set_updated_at before update on public.review_requests for each row execute function public.set_updated_at();
drop trigger if exists import_batches_set_updated_at on public.import_batches;
create trigger import_batches_set_updated_at before update on public.import_batches for each row execute function public.set_updated_at();
drop trigger if exists exports_set_updated_at on public.exports;
create trigger exports_set_updated_at before update on public.exports for each row execute function public.set_updated_at();

insert into storage.buckets (id, name, public)
values
  ('artifacts', 'artifacts', false),
  ('imports-raw', 'imports-raw', false),
  ('imports-processed', 'imports-processed', false),
  ('exports', 'exports', false),
  ('thumbnails', 'thumbnails', false)
on conflict (id) do update set public = false;

alter table public.profiles enable row level security;
alter table public.artifacts enable row level security;
alter table public.tags enable row level security;
alter table public.artifact_tags enable row level security;
alter table public.categories enable row level security;
alter table public.artifact_categories enable row level security;
alter table public.archive_records enable row level security;
alter table public.artifact_archive_records enable row level security;
alter table public.decisions enable row level security;
alter table public.decision_resolutions enable row level security;
alter table public.review_requests enable row level security;
alter table public.review_notes enable row level security;
alter table public.audit_events enable row level security;
alter table public.import_batches enable row level security;
alter table public.exports enable row level security;

-- No anon/authenticated table policies are created intentionally. Netlify Functions
-- verify the Netlify Identity JWT and use the server-only service role for access.
-- Signed upload/download URLs provide short-lived access to private Storage objects.
