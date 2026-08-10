-- Add a provider-neutral subject bridge without rewriting historical profiles.
-- Creative OS authority remains public.profiles.role; email is not an identity key.
create table if not exists public.profile_identities (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null check (provider in ('netlify_identity', 'supabase_auth')),
  provider_subject text not null check (length(btrim(provider_subject)) > 0),
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  unique (provider, provider_subject)
);

create index if not exists profile_identities_profile_id_idx
  on public.profile_identities(profile_id);

alter table public.profile_identities enable row level security;
revoke all on table public.profile_identities from public, anon, authenticated;
grant select, insert, update, delete on table public.profile_identities to service_role;

insert into public.profile_identities (profile_id, provider, provider_subject, metadata)
select id, 'netlify_identity', identity_user_id, jsonb_build_object('source', 'profiles_legacy_bridge')
from public.profiles
where identity_provider = 'netlify_identity'
  and identity_user_id is not null
  and length(btrim(identity_user_id)) > 0
on conflict (provider, provider_subject) do nothing;

comment on table public.profile_identities is
  'Trusted provider-subject links to stable Creative OS profiles. Email is descriptive only and profiles.role is authoritative.';
