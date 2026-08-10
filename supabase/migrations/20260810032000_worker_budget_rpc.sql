-- Worker-budget remediation: consolidate read-only readiness and artifact paging,
-- and make artifact organization transactional and set-based. These functions
-- remain callable only by the server-side service role.

create or replace function public.creative_os_runtime_readiness()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
with required_schema as (
  select table_name, column_name
  from jsonb_each(
    '{
      "creative_os_runtime_contract":["id","schema_contract_version","mutation_authority","production_project_ref","required_storage_buckets","metadata","created_at","updated_at"],
      "profiles":["id","email","display_name","role","identity_provider","identity_user_id","created_at","updated_at"],
      "artifacts":["id","title","slug","description","artifact_type","source_type","storage_bucket","storage_path","original_file_name","mime_type","file_size","file_status","external_url","rights_status","canon_status","review_status","lifecycle_status","visibility","ai_generated","ai_model","prompt_used","provenance","legacy_data","created_by","updated_by","created_at","updated_at","project","intended_use","notes"],
      "tags":["id","name","slug","tag_type","description","created_at","updated_at","is_active"],
      "artifact_tags":["artifact_id","tag_id","created_by","created_at"],
      "categories":["id","name","slug","parent_id","description","created_at","updated_at","is_active"],
      "artifact_categories":["artifact_id","category_id","created_by","created_at"],
      "archive_records":["id","title","slug","type","summary","body","canon_status","review_status","risk_level","source_data","created_at","updated_at"],
      "artifact_archive_records":["artifact_id","archive_record_id","relationship_type","notes","created_by","created_at"],
      "decisions":["id","title","slug","issue_summary","why_it_matters","recommended_fix","status","risk_level","source_data","created_at","updated_at"],
      "decision_resolutions":["id","decision_id","selected_resolution","custom_resolution","rationale","application_type","canonical_effect","source_effect","submitted_by","reviewed_by","status","affected_records","affected_files","follow_up_tasks","source_files_changed","created_at","updated_at"],
      "review_requests":["id","operation_type","target_type","target_id","submitted_by","reviewed_by","status","risk_level","intent_summary","reason","before_snapshot","after_snapshot","affected_artifacts","affected_records","affected_files","error_message","created_at","updated_at"],
      "review_notes":["id","review_request_id","author_id","note","created_at"],
      "audit_events":["id","actor_id","actor_email","actor_role","action_type","target_type","target_id","intent_summary","reason","before_snapshot","after_snapshot","result","created_at"],
      "import_batches":["id","title","source","status","created_by","manifest","created_at","updated_at"],
      "exports":["id","title","export_type","status","storage_bucket","storage_path","manifest","created_by","created_at","updated_at"]
    }'::jsonb
  ) as tables(table_name, columns)
  cross join lateral jsonb_array_elements_text(tables.columns) as column_names(column_name)
), missing_schema as (
  select required_schema.table_name, required_schema.column_name
  from required_schema
  left join pg_catalog.pg_namespace namespaces on namespaces.nspname = 'public'
  left join pg_catalog.pg_class relations
    on relations.relnamespace = namespaces.oid
   and relations.relname = required_schema.table_name
   and relations.relkind in ('r', 'p')
  left join pg_catalog.pg_attribute attributes
    on attributes.attrelid = relations.oid
   and attributes.attname = required_schema.column_name
   and attributes.attnum > 0
   and not attributes.attisdropped
  where attributes.attname is null
), contract as (
  select jsonb_build_object(
    'id', value.id,
    'schema_contract_version', value.schema_contract_version,
    'mutation_authority', value.mutation_authority,
    'production_project_ref', value.production_project_ref,
    'required_storage_buckets', value.required_storage_buckets,
    'created_at', value.created_at,
    'updated_at', value.updated_at
  ) as value
  from public.creative_os_runtime_contract value
  where value.id = 'creative-os'
)
select jsonb_build_object(
  'contract', (select contract.value from contract),
  'schemaCompatible', not exists (select 1 from missing_schema),
  'missingSchema', coalesce((
    select jsonb_agg(jsonb_build_object('table', table_name, 'column', column_name) order by table_name, column_name)
    from missing_schema
  ), '[]'::jsonb)
);
$$;

revoke all on function public.creative_os_runtime_readiness() from public;
revoke execute on function public.creative_os_runtime_readiness() from anon, authenticated;
grant execute on function public.creative_os_runtime_readiness() to service_role;

comment on function public.creative_os_runtime_readiness() is
  'Read-only, service-role-only Creative OS contract and required-column compatibility check.';

create or replace function public.creative_os_list_artifacts_page(
  p_filters jsonb default '{}'::jsonb,
  p_include_private boolean default false,
  p_limit integer default 24,
  p_offset integer default 0
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
with filtered as materialized (
  select artifacts.*
  from public.artifacts artifacts
  where (p_include_private or artifacts.visibility <> 'private')
    and (not (p_filters ? 'project') or lower(artifacts.project) = lower(p_filters->>'project'))
    and (not (p_filters ? 'intended_use') or lower(artifacts.intended_use) = lower(p_filters->>'intended_use'))
    and (not (p_filters ? 'rights_status') or lower(artifacts.rights_status) = lower(p_filters->>'rights_status'))
    and (not (p_filters ? 'review_status') or lower(artifacts.review_status) = lower(p_filters->>'review_status'))
    and (not (p_filters ? 'canon_status') or lower(artifacts.canon_status) = lower(p_filters->>'canon_status'))
    and (not (p_filters ? 'visibility') or lower(artifacts.visibility) = lower(p_filters->>'visibility'))
    and (not (p_filters ? 'lifecycle_status') or lower(artifacts.lifecycle_status) = lower(p_filters->>'lifecycle_status'))
    and (not (p_filters ? 'file_status') or lower(artifacts.file_status) = lower(p_filters->>'file_status'))
    and (not (p_filters ? 'file') or case
      when lower(p_filters->>'file') = 'preview' then artifacts.file_status = 'available' and artifacts.storage_bucket is not null and artifacts.storage_path is not null
      else lower(artifacts.file_status) = lower(p_filters->>'file')
    end)
    and (not (p_filters ? 'artifact_type') or lower(p_filters->>'artifact_type') = case
      when lower(coalesce(artifacts.mime_type, '')) like 'image/%' or lower(coalesce(artifacts.original_file_name, '')) ~ '\.(png|jpe?g|gif|webp|avif|svg)$' then 'image'
      when lower(coalesce(artifacts.mime_type, '')) = 'application/pdf' or lower(coalesce(artifacts.original_file_name, '')) like '%.pdf' then 'pdf'
      when lower(coalesce(artifacts.mime_type, '')) = 'text/markdown' or lower(coalesce(artifacts.original_file_name, '')) ~ '\.(md|markdown|mdx)$' then 'markdown'
      when lower(coalesce(artifacts.mime_type, '')) like 'text/%' or lower(coalesce(artifacts.original_file_name, '')) ~ '\.(txt|csv|json|ya?ml)$' then 'text'
      when lower(coalesce(artifacts.original_file_name, '')) ~ '\.(doc|docx|odt|rtf)$' then 'doc'
      else lower(artifacts.artifact_type)
    end)
    and (not (p_filters ? 'category') or exists (
      select 1 from public.artifact_categories links
      join public.categories categories on categories.id = links.category_id
      where links.artifact_id = artifacts.id
        and lower(p_filters->>'category') in (lower(categories.id::text), lower(categories.slug), lower(categories.name))
    ))
    and (not (p_filters ? 'entity') or exists (
      select 1 from public.artifact_archive_records links
      join public.archive_records records on records.id = links.archive_record_id
      where links.artifact_id = artifacts.id
        and lower(p_filters->>'entity') in (lower(records.id), lower(records.slug), lower(records.title))
    ))
    and (not (p_filters ? 'tag') or exists (
      select 1 from public.artifact_tags links
      join public.tags tags on tags.id = links.tag_id
      where links.artifact_id = artifacts.id
        and lower(p_filters->>'tag') in (lower(tags.id::text), lower(tags.slug), lower(tags.name))
    ))
    and (not (p_filters ? 'controlled_tag') or exists (
      select 1 from public.artifact_tags links
      join public.tags tags on tags.id = links.tag_id
      where links.artifact_id = artifacts.id and tags.tag_type <> 'freeform'
        and lower(p_filters->>'controlled_tag') in (lower(tags.id::text), lower(tags.slug), lower(tags.name))
    ))
    and (not (p_filters ? 'freeform_tag') or exists (
      select 1 from public.artifact_tags links
      join public.tags tags on tags.id = links.tag_id
      where links.artifact_id = artifacts.id and tags.tag_type = 'freeform'
        and lower(p_filters->>'freeform_tag') in (lower(tags.id::text), lower(tags.slug), lower(tags.name))
    ))
    and (not (p_filters ? 'metadata') or case lower(p_filters->>'metadata')
      when 'needs' then artifacts.artifact_type is null or artifacts.artifact_type = '' or artifacts.rights_status in ('unknown','needs-review') or artifacts.review_status in ('unknown','needs-review') or artifacts.visibility is null or artifacts.visibility = '' or artifacts.lifecycle_status is null or artifacts.lifecycle_status = ''
      when 'complete' then not (artifacts.artifact_type is null or artifacts.artifact_type = '' or artifacts.rights_status in ('unknown','needs-review') or artifacts.review_status in ('unknown','needs-review') or artifacts.visibility is null or artifacts.visibility = '' or artifacts.lifecycle_status is null or artifacts.lifecycle_status = '')
      else true
    end)
    and (lower(coalesce(p_filters->>'ready_for_export', 'false')) <> 'true' or (
      artifacts.lifecycle_status = 'export-ready' and artifacts.review_status = 'approved'
      and artifacts.rights_status = 'public-safe' and artifacts.visibility in ('public','exportable')
    ))
    and (not (p_filters ? 'search') or concat_ws(' ', artifacts.title, artifacts.description, artifacts.original_file_name, artifacts.notes) ilike '%' || (p_filters->>'search') || '%'
      or exists (select 1 from public.artifact_tags links join public.tags tags on tags.id = links.tag_id where links.artifact_id = artifacts.id and tags.name ilike '%' || (p_filters->>'search') || '%')
      or exists (select 1 from public.artifact_categories links join public.categories categories on categories.id = links.category_id where links.artifact_id = artifacts.id and categories.name ilike '%' || (p_filters->>'search') || '%')
      or exists (select 1 from public.artifact_archive_records links join public.archive_records records on records.id = links.archive_record_id where links.artifact_id = artifacts.id and records.title ilike '%' || (p_filters->>'search') || '%')
    )
), page as materialized (
  select * from filtered
  order by updated_at desc, id asc
  limit least(greatest(p_limit, 1), 50)
  offset greatest(p_offset, 0)
), enriched as (
  select page.id, page.updated_at,
    to_jsonb(page) || jsonb_build_object(
      'artifact_tags', coalesce((select jsonb_agg(jsonb_build_object('tag_id', tags.id, 'tags', jsonb_build_object('id', tags.id, 'name', tags.name, 'slug', tags.slug, 'tag_type', tags.tag_type, 'description', tags.description)) order by tags.tag_type, tags.name) from public.artifact_tags links join public.tags tags on tags.id = links.tag_id where links.artifact_id = page.id), '[]'::jsonb),
      'artifact_categories', coalesce((select jsonb_agg(jsonb_build_object('category_id', categories.id, 'categories', jsonb_build_object('id', categories.id, 'name', categories.name, 'slug', categories.slug, 'parent_id', categories.parent_id, 'description', categories.description)) order by categories.name) from public.artifact_categories links join public.categories categories on categories.id = links.category_id where links.artifact_id = page.id), '[]'::jsonb),
      'artifact_archive_records', coalesce((select jsonb_agg(jsonb_build_object('archive_record_id', records.id, 'relationship_type', links.relationship_type, 'notes', links.notes, 'archive_records', jsonb_build_object('id', records.id, 'title', records.title, 'slug', records.slug, 'type', records.type)) order by records.title) from public.artifact_archive_records links join public.archive_records records on records.id = links.archive_record_id where links.artifact_id = page.id), '[]'::jsonb)
    ) as value
  from page
)
select jsonb_build_object(
  'rows', coalesce((select jsonb_agg(value order by updated_at desc, id asc) from enriched), '[]'::jsonb),
  'total', (select count(*) from filtered),
  'summary', jsonb_build_object(
    'available', (select count(*) from filtered where file_status = 'available'),
    'needs_import', (select count(*) from filtered where file_status = 'needs_import')
  ),
  'indexedRefs', coalesce((select jsonb_agg(jsonb_build_object(
    'id', artifacts.id,
    'path', coalesce(artifacts.provenance->>'originalWorkspaceRelativePath', artifacts.provenance->>'workspaceRelativePath', artifacts.legacy_data->>'filePath', '')
  ) order by artifacts.id) from public.artifacts artifacts where p_include_private or artifacts.visibility <> 'private'), '[]'::jsonb)
);
$$;

revoke all on function public.creative_os_list_artifacts_page(jsonb, boolean, integer, integer) from public;
revoke execute on function public.creative_os_list_artifacts_page(jsonb, boolean, integer, integer) from anon, authenticated;
grant execute on function public.creative_os_list_artifacts_page(jsonb, boolean, integer, integer) to service_role;

comment on function public.creative_os_list_artifacts_page(jsonb, boolean, integer, integer) is
  'Read-only, service-role-only, deterministically ordered and bounded artifact page with database-side filtering.';

create or replace function public.creative_os_artifact_snapshot(p_artifact_id text)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
select to_jsonb(artifacts) || jsonb_build_object(
  'tags', coalesce((select jsonb_agg(to_jsonb(tags) order by tags.tag_type, tags.name) from public.artifact_tags links join public.tags tags on tags.id = links.tag_id where links.artifact_id = artifacts.id), '[]'::jsonb),
  'categories', coalesce((select jsonb_agg(to_jsonb(categories) order by categories.name) from public.artifact_categories links join public.categories categories on categories.id = links.category_id where links.artifact_id = artifacts.id), '[]'::jsonb),
  'archiveRecords', coalesce((select jsonb_agg(jsonb_build_object('id', records.id, 'title', records.title, 'slug', records.slug, 'type', records.type, 'relationshipType', links.relationship_type, 'notes', links.notes) order by records.title) from public.artifact_archive_records links join public.archive_records records on records.id = links.archive_record_id where links.artifact_id = artifacts.id), '[]'::jsonb)
)
from public.artifacts artifacts
where artifacts.id = p_artifact_id;
$$;

revoke all on function public.creative_os_artifact_snapshot(text) from public;
revoke execute on function public.creative_os_artifact_snapshot(text) from anon, authenticated;
grant execute on function public.creative_os_artifact_snapshot(text) to service_role;

create or replace function public.creative_os_bulk_organize_artifacts(
  p_artifact_ids text[],
  p_payload jsonb,
  p_profile_id uuid,
  p_reason text default '',
  p_risk_level text default 'low',
  p_apply boolean default false
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_ids text[];
  v_before jsonb;
  v_after jsonb;
  v_actor_email text;
  v_actor_role text;
  v_results jsonb;
begin
  select array_agg(value order by first_position)
  into v_ids
  from (
    select value, min(position) as first_position
    from unnest(p_artifact_ids) with ordinality as requested(value, position)
    where nullif(btrim(value), '') is not null
    group by value
  ) unique_ids;

  if coalesce(cardinality(v_ids), 0) = 0 then raise exception 'Choose at least one artifact.'; end if;
  if cardinality(v_ids) > 25 then raise exception 'Choose no more than 25 artifacts per organization request.'; end if;
  if p_risk_level not in ('low', 'medium', 'high') then raise exception 'Unsupported risk level.'; end if;
  if (select count(*) from public.artifacts where id = any(v_ids)) <> cardinality(v_ids) then raise exception 'One or more artifacts do not exist.'; end if;

  select profiles.email, profiles.role into v_actor_email, v_actor_role
  from public.profiles profiles where profiles.id = p_profile_id;
  if v_actor_role is null then raise exception 'A canonical Creative OS profile is required.'; end if;

  select jsonb_object_agg(ids.id, public.creative_os_artifact_snapshot(ids.id))
  into v_before from unnest(v_ids) as ids(id);

  if not p_apply then
    with reviews as (
      insert into public.review_requests (operation_type, target_type, target_id, submitted_by, status, risk_level, intent_summary, reason, before_snapshot, after_snapshot, affected_artifacts)
      select 'artifact_organization_update', 'artifact', ids.id, p_profile_id, 'pending_review', p_risk_level,
        'Organize ' || coalesce(v_before->ids.id->>'title', ids.id) || ' through the set-based Creative OS organization workflow.',
        coalesce(p_reason, ''), v_before->ids.id, jsonb_build_object('organization', p_payload), array[ids.id]
      from unnest(v_ids) as ids(id)
      returning id, target_id
    ), audits as (
      insert into public.audit_events (actor_id, actor_email, actor_role, action_type, target_type, target_id, intent_summary, reason, before_snapshot, after_snapshot, result)
      select p_profile_id, v_actor_email, v_actor_role, 'artifact_organization_proposed', 'artifact', ids.id,
        'Organize ' || coalesce(v_before->ids.id->>'title', ids.id) || ' through the set-based Creative OS organization workflow.',
        coalesce(p_reason, ''), v_before->ids.id, jsonb_build_object('organization', p_payload), 'pending_review'
      from unnest(v_ids) as ids(id)
      returning id, target_id
    )
    select jsonb_agg(jsonb_build_object('artifactId', reviews.target_id, 'mode', 'pending-review', 'reviewRequestId', reviews.id, 'auditEventId', audits.id, 'artifact', v_before->reviews.target_id) order by array_position(v_ids, reviews.target_id))
    into v_results from reviews join audits using (target_id);
    return jsonb_build_object('mode', 'pending-review', 'affectedCount', cardinality(v_ids), 'atomic', true, 'results', coalesce(v_results, '[]'::jsonb));
  end if;

  update public.artifacts artifacts set
    title = case when p_payload->'changes' ? 'title' then p_payload->'changes'->>'title' else artifacts.title end,
    description = case when p_payload->'changes' ? 'description' then p_payload->'changes'->>'description' else artifacts.description end,
    artifact_type = case when p_payload->'changes' ? 'artifact_type' then p_payload->'changes'->>'artifact_type' else artifacts.artifact_type end,
    project = case when p_payload->'changes' ? 'project' then p_payload->'changes'->>'project' else artifacts.project end,
    intended_use = case when p_payload->'changes' ? 'intended_use' then p_payload->'changes'->>'intended_use' else artifacts.intended_use end,
    rights_status = case when p_payload->'changes' ? 'rights_status' then p_payload->'changes'->>'rights_status' else artifacts.rights_status end,
    canon_status = case when p_payload->'changes' ? 'canon_status' then p_payload->'changes'->>'canon_status' else artifacts.canon_status end,
    review_status = case when p_payload->'changes' ? 'review_status' then p_payload->'changes'->>'review_status' else artifacts.review_status end,
    lifecycle_status = case when p_payload->'changes' ? 'lifecycle_status' then p_payload->'changes'->>'lifecycle_status' else artifacts.lifecycle_status end,
    visibility = case when p_payload->'changes' ? 'visibility' then p_payload->'changes'->>'visibility' else artifacts.visibility end,
    file_status = case when p_payload->'changes' ? 'file_status' then p_payload->'changes'->>'file_status' else artifacts.file_status end,
    notes = case when p_payload->'changes' ? 'notes' then p_payload->'changes'->>'notes' else artifacts.notes end,
    updated_by = p_profile_id
  where artifacts.id = any(v_ids);

  with changed_fields(field_name, tag_type) as (values
    ('artifact_type','medium'), ('project','project'), ('intended_use','function'), ('rights_status','rights'),
    ('review_status','review'), ('canon_status','canon'), ('visibility','visibility'), ('lifecycle_status','workflow')
  ), values_to_set as (
    select tag_type, p_payload->'changes'->>field_name as name
    from changed_fields where p_payload->'changes' ? field_name
  )
  insert into public.tags (name, slug, tag_type, description)
  select distinct name, regexp_replace(lower(tag_type || '-' || name), '[^a-z0-9]+', '-', 'g'), tag_type, 'Controlled value created by Creative OS organization.'
  from values_to_set where nullif(btrim(name), '') is not null
  on conflict (slug) do update set name = excluded.name, tag_type = excluded.tag_type, description = excluded.description;

  with changed_fields(field_name, tag_type) as (values
    ('artifact_type','medium'), ('project','project'), ('intended_use','function'), ('rights_status','rights'),
    ('review_status','review'), ('canon_status','canon'), ('visibility','visibility'), ('lifecycle_status','workflow')
  )
  delete from public.artifact_tags links using public.tags tags, changed_fields
  where links.artifact_id = any(v_ids) and tags.id = links.tag_id and tags.tag_type = changed_fields.tag_type and p_payload->'changes' ? changed_fields.field_name;

  with changed_fields(field_name, tag_type) as (values
    ('artifact_type','medium'), ('project','project'), ('intended_use','function'), ('rights_status','rights'),
    ('review_status','review'), ('canon_status','canon'), ('visibility','visibility'), ('lifecycle_status','workflow')
  )
  insert into public.artifact_tags (artifact_id, tag_id, created_by)
  select ids.id, tags.id, p_profile_id
  from unnest(v_ids) ids(id)
  cross join changed_fields
  join public.tags tags on tags.tag_type = changed_fields.tag_type and lower(tags.name) = lower(p_payload->'changes'->>changed_fields.field_name)
  where p_payload->'changes' ? changed_fields.field_name
  on conflict do nothing;

  with additions as (
    select value from jsonb_array_elements(coalesce(p_payload->'addControlledTags', '[]'::jsonb)) value
    union all select value from jsonb_array_elements(coalesce(p_payload->'addFreeformTags', '[]'::jsonb)) value
  )
  insert into public.tags (name, slug, tag_type, description)
  select distinct value->>'name', regexp_replace(lower((value->>'tagType') || '-' || (value->>'name')), '[^a-z0-9]+', '-', 'g'), value->>'tagType', 'Created by Creative OS organization.'
  from additions where nullif(value->>'id', '') is null and nullif(btrim(value->>'name'), '') is not null
  on conflict (slug) do update set name = excluded.name, tag_type = excluded.tag_type;

  with additions as (
    select value from jsonb_array_elements(coalesce(p_payload->'addControlledTags', '[]'::jsonb)) value
    union all select value from jsonb_array_elements(coalesce(p_payload->'addFreeformTags', '[]'::jsonb)) value
  ), resolved as (
    select coalesce(nullif(value->>'id', '')::uuid, tags.id) as tag_id
    from additions left join public.tags tags on tags.slug = regexp_replace(lower((value->>'tagType') || '-' || (value->>'name')), '[^a-z0-9]+', '-', 'g')
  )
  insert into public.artifact_tags (artifact_id, tag_id, created_by)
  select ids.id, resolved.tag_id, p_profile_id from unnest(v_ids) ids(id) cross join resolved where resolved.tag_id is not null
  on conflict do nothing;

  with removals as (
    select value from jsonb_array_elements(coalesce(p_payload->'removeControlledTags', '[]'::jsonb)) value
    union all select value from jsonb_array_elements(coalesce(p_payload->'removeFreeformTags', '[]'::jsonb)) value
  ), resolved as (
    select coalesce(nullif(value->>'id', '')::uuid, tags.id) as tag_id
    from removals left join public.tags tags on tags.slug = regexp_replace(lower((value->>'tagType') || '-' || (value->>'name')), '[^a-z0-9]+', '-', 'g')
  )
  delete from public.artifact_tags links using resolved
  where links.artifact_id = any(v_ids) and links.tag_id = resolved.tag_id;

  if p_payload ? 'setCategoryId' then
    delete from public.artifact_categories where artifact_id = any(v_ids);
    if nullif(p_payload->>'setCategoryId', '') is not null then
      insert into public.artifact_categories (artifact_id, category_id, created_by)
      select ids.id, (p_payload->>'setCategoryId')::uuid, p_profile_id from unnest(v_ids) ids(id)
      on conflict do nothing;
    end if;
  elsif p_payload ? 'setCategory' then
    delete from public.artifact_categories where artifact_id = any(v_ids);
    if nullif(btrim(p_payload->>'setCategory'), '') is not null then
      insert into public.categories (name, slug, description)
      values (p_payload->>'setCategory', regexp_replace(lower(p_payload->>'setCategory'), '[^a-z0-9]+', '-', 'g'), 'Created by Creative OS organization.')
      on conflict (slug) do update set name = excluded.name;
      insert into public.artifact_categories (artifact_id, category_id, created_by)
      select ids.id, categories.id, p_profile_id from unnest(v_ids) ids(id)
      join public.categories categories on categories.slug = regexp_replace(lower(p_payload->>'setCategory'), '[^a-z0-9]+', '-', 'g')
      on conflict do nothing;
    end if;
  else
    insert into public.categories (name, slug, description)
    select distinct value, regexp_replace(lower(value), '[^a-z0-9]+', '-', 'g'), 'Created by Creative OS organization.'
    from jsonb_array_elements_text(coalesce(p_payload->'addCategories', '[]'::jsonb)) values_to_add(value)
    where nullif(btrim(value), '') is not null
    on conflict (slug) do update set name = excluded.name;
    insert into public.artifact_categories (artifact_id, category_id, created_by)
    select ids.id, categories.id, p_profile_id
    from unnest(v_ids) ids(id)
    cross join jsonb_array_elements_text(coalesce(p_payload->'addCategories', '[]'::jsonb)) values_to_add(value)
    join public.categories categories on categories.slug = regexp_replace(lower(values_to_add.value), '[^a-z0-9]+', '-', 'g')
    on conflict do nothing;
    delete from public.artifact_categories links using public.categories categories
    where links.artifact_id = any(v_ids) and links.category_id = categories.id
      and categories.slug in (select regexp_replace(lower(value), '[^a-z0-9]+', '-', 'g') from jsonb_array_elements_text(coalesce(p_payload->'removeCategories', '[]'::jsonb)) values_to_remove(value));
  end if;

  if p_payload ? 'folderPath' then
    if nullif(btrim(p_payload->>'folderPath'), '') is null then raise exception 'Folder path is required.'; end if;

    insert into public.categories (name, slug, description)
    values (p_payload->>'folderPath', regexp_replace(lower(p_payload->>'folderPath'), '[^a-z0-9]+', '-', 'g'), 'Archive Index folder.')
    on conflict (slug) do update set name = excluded.name;

    insert into public.tags (name, slug, tag_type, description)
    select distinct segment, regexp_replace(lower('folder-' || segment), '[^a-z0-9]+', '-', 'g'), 'folder', 'Folder-derived standardized tag.'
    from regexp_split_to_table(p_payload->>'folderPath', '/') segment
    where nullif(btrim(segment), '') is not null
    on conflict (slug) do update set name = excluded.name, tag_type = 'folder';

    delete from public.artifact_categories links using public.categories categories
    where links.artifact_id = any(v_ids) and links.category_id = categories.id
      and (categories.name = 'Archive' or categories.name like 'Archive/%');
    delete from public.artifact_tags links using public.tags tags
    where links.artifact_id = any(v_ids) and links.tag_id = tags.id and tags.tag_type = 'folder';

    insert into public.artifact_categories (artifact_id, category_id, created_by)
    select ids.id, categories.id, p_profile_id
    from unnest(v_ids) ids(id)
    join public.categories categories on categories.slug = regexp_replace(lower(p_payload->>'folderPath'), '[^a-z0-9]+', '-', 'g')
    on conflict do nothing;

    insert into public.artifact_tags (artifact_id, tag_id, created_by)
    select ids.id, tags.id, p_profile_id
    from unnest(v_ids) ids(id)
    cross join regexp_split_to_table(p_payload->>'folderPath', '/') segment
    join public.tags tags on tags.slug = regexp_replace(lower('folder-' || segment), '[^a-z0-9]+', '-', 'g')
    on conflict do nothing;

    update public.artifacts artifacts set
      provenance = artifacts.provenance || jsonb_build_object(
        'originalFolder', coalesce(artifacts.provenance->>'originalFolder', artifacts.provenance->>'folder'),
        'originalWorkspaceRelativePath', coalesce(artifacts.provenance->>'originalWorkspaceRelativePath', artifacts.provenance->>'workspaceRelativePath', artifacts.legacy_data->>'filePath'),
        'folder', p_payload->>'folderPath',
        'indexedPath', (p_payload->>'folderPath') || '/' || coalesce(artifacts.original_file_name, artifacts.title),
        'movedInArchiveIndexAt', now()
      ),
      legacy_data = artifacts.legacy_data || jsonb_build_object(
        'folder', p_payload->>'folderPath',
        'filePath', (p_payload->>'folderPath') || '/' || coalesce(artifacts.original_file_name, artifacts.title),
        'virtualFolderMove', true
      ),
      updated_by = p_profile_id
    where artifacts.id = any(v_ids);
  end if;

  if p_payload ? 'relatedEntityId' then
    delete from public.artifact_archive_records where artifact_id = any(v_ids) and relationship_type = 'organized-as';
    if nullif(p_payload->>'relatedEntityId', '') is not null then
      insert into public.artifact_archive_records (artifact_id, archive_record_id, relationship_type, notes, created_by)
      select ids.id, p_payload->>'relatedEntityId', 'organized-as', 'Assigned through artifact organization', p_profile_id from unnest(v_ids) ids(id)
      on conflict do nothing;
    end if;
  end if;

  update public.artifacts set updated_by = p_profile_id where id = any(v_ids);
  select jsonb_object_agg(ids.id, public.creative_os_artifact_snapshot(ids.id)) into v_after from unnest(v_ids) ids(id);

  with audits as (
    insert into public.audit_events (actor_id, actor_email, actor_role, action_type, target_type, target_id, intent_summary, reason, before_snapshot, after_snapshot, result)
    select p_profile_id, v_actor_email, v_actor_role, 'artifact_organization_update', 'artifact', ids.id,
      'Organize ' || coalesce(v_before->ids.id->>'title', ids.id) || ' through the set-based Creative OS organization workflow.',
      coalesce(p_reason, ''), v_before->ids.id, v_after->ids.id, 'applied'
    from unnest(v_ids) ids(id)
    returning id, target_id
  )
  select jsonb_agg(jsonb_build_object('artifactId', audits.target_id, 'mode', 'database-applied', 'auditEventId', audits.id, 'artifact', v_after->audits.target_id) order by array_position(v_ids, audits.target_id))
  into v_results from audits;

  return jsonb_build_object('mode', 'database-applied', 'affectedCount', cardinality(v_ids), 'atomic', true, 'results', coalesce(v_results, '[]'::jsonb));
end;
$$;

revoke all on function public.creative_os_bulk_organize_artifacts(text[], jsonb, uuid, text, text, boolean) from public;
revoke execute on function public.creative_os_bulk_organize_artifacts(text[], jsonb, uuid, text, text, boolean) from anon, authenticated;
grant execute on function public.creative_os_bulk_organize_artifacts(text[], jsonb, uuid, text, text, boolean) to service_role;

comment on function public.creative_os_bulk_organize_artifacts(text[], jsonb, uuid, text, text, boolean) is
  'Service-role-only atomic organization/proposal operation for at most 25 artifacts; API authorization remains mandatory.';
