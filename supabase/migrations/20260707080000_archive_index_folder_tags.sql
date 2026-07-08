-- Archive Index redux: folder names become controlled tags, and
-- non-folder standardized tags are separated from freeform notes.
insert into public.tags (name, slug, tag_type, description)
values
  ('Archive','folder-archive','folder','Folder-derived standardized tag.'),
  ('standard','standard-standard','standard','Starter standardized non-folder tag.'),
  ('reference','standard-reference','standard','Starter standardized non-folder tag.'),
  ('needs-sort','standard-needs-sort','standard','Starter standardized non-folder tag.'),
  ('keeper','standard-keeper','standard','Starter standardized non-folder tag.')
on conflict (slug) do update
set name = excluded.name,
    tag_type = excluded.tag_type,
    description = excluded.description;
