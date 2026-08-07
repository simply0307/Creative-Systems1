alter table public.tags
  add column if not exists is_active boolean not null default true,
  add column if not exists updated_at timestamptz not null default now();

alter table public.categories
  add column if not exists is_active boolean not null default true;

create unique index if not exists categories_name_ci_unique
  on public.categories (lower(btrim(name)));

create unique index if not exists tags_type_name_ci_unique
  on public.tags (lower(btrim(tag_type)), lower(btrim(name)));

create index if not exists tags_active_type_idx
  on public.tags (is_active, tag_type, name);

create index if not exists categories_active_name_idx
  on public.categories (is_active, name);

-- Controlled visibility values are validated by the server against active tags.
-- Keeping the original fixed check would prevent administrators from safely
-- renaming or extending this controlled family.
alter table public.artifacts drop constraint if exists artifacts_visibility_check;
