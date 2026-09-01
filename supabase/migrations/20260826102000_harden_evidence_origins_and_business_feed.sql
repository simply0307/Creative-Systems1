begin;

create function public.reath_evidence_origin_key(
  p_author text,
  p_provider_group text
)
returns text
language sql
immutable
parallel safe
security invoker
set search_path = pg_catalog, public
as $$
  select case
    when normalized_author ~ '^(new jersey|n j|nj) state ?house news( service)?$'
      then 'origin:new-jersey-statehouse-news-service'
    when normalized_author ~ '^((the )?associated press|ap)$'
      then 'origin:associated-press'
    when normalized_author ~ '^(thomson )?reuters$'
      then 'origin:reuters'
    else 'provider:' || lower(btrim(p_provider_group))
  end
  from (
    select btrim(regexp_replace(
      regexp_replace(lower(btrim(coalesce(p_author, ''))), '^by[[:space:]]+', ''),
      '[^a-z0-9]+',
      ' ',
      'g'
    )) as normalized_author
  ) as normalized;
$$;

comment on function public.reath_evidence_origin_key(text, text) is
  'Fail-closed evidence-origin key. Exact recognized wire or news-service bylines collapse reprints across providers; all other items retain their reviewed provider group.';

revoke all on function public.reath_evidence_origin_key(text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.reath_evidence_origin_key(text, text)
  to service_role;

create or replace view public.story_corroboration_summary
with (security_invoker = true)
as
with recursive evidence_rows as (
  select
    story.id as story_id,
    story_source.source_item_id,
    source_item.source_id,
    source_item.author,
    assessment.id as assessment_id,
    assessment.assessment_status,
    assessment.evidence_role,
    assessment.verification_tier,
    assessment.corroboration_group_key
  from public.stories as story
  left join public.story_sources as story_source
    on story_source.story_id = story.id
   and story_source.detached_at is null
  left join public.source_items as source_item
    on source_item.id = story_source.source_item_id
  left join public.source_assessments as assessment
    on assessment.source_id = source_item.source_id
   and assessment.superseded_at is null
  where story.status <> 'merged'
),
base_counts as (
  select
    evidence.story_id,
    count(evidence.source_item_id)::integer as active_source_item_count,
    count(distinct evidence.source_id)::integer as distinct_source_count,
    count(distinct evidence.source_id) filter (
      where evidence.assessment_status = 'reviewed'
        and evidence.verification_tier >= 2
        and evidence.evidence_role in (
          'independent_journalism',
          'official_primary',
          'institutional_primary'
        )
    )::integer as qualifying_source_count,
    count(distinct evidence.corroboration_group_key) filter (
      where evidence.assessment_status = 'reviewed'
        and evidence.verification_tier >= 2
        and evidence.evidence_role = 'context_only'
    )::integer as context_group_count,
    count(distinct evidence.source_id) filter (
      where evidence.assessment_status = 'provisional'
    )::integer as provisional_source_count,
    count(distinct evidence.source_id) filter (
      where evidence.source_id is not null
        and evidence.assessment_id is null
    )::integer as unassessed_source_count,
    max(evidence.verification_tier) filter (
      where evidence.assessment_status = 'reviewed'
    ) as maximum_reviewed_verification_tier
  from evidence_rows as evidence
  group by evidence.story_id
),
qualifying_edges as (
  select distinct
    evidence.story_id,
    'provider:' || lower(btrim(evidence.corroboration_group_key)) as provider_node,
    public.reath_evidence_origin_key(
      evidence.author,
      evidence.corroboration_group_key
    ) as origin_node,
    evidence.evidence_role
  from evidence_rows as evidence
  where evidence.assessment_status = 'reviewed'
    and evidence.verification_tier >= 2
    and evidence.evidence_role in (
      'independent_journalism',
      'official_primary',
      'institutional_primary'
    )
),
edge_list as (
  select story_id, provider_node as left_node, origin_node as right_node
  from qualifying_edges
  union
  select story_id, origin_node as left_node, provider_node as right_node
  from qualifying_edges
),
nodes as (
  select story_id, left_node as node from edge_list
  union
  select story_id, right_node as node from edge_list
),
reach(story_id, node, reachable_node) as (
  select story_id, node, node
  from nodes
  union
  select reach.story_id, reach.node, edge_list.right_node
  from reach
  join edge_list
    on edge_list.story_id = reach.story_id
   and edge_list.left_node = reach.reachable_node
),
components as (
  select story_id, node, min(reachable_node) as component_key
  from reach
  group by story_id, node
),
qualified_component_roles as (
  select distinct
    evidence.story_id,
    component.component_key,
    evidence.evidence_role
  from qualifying_edges as evidence
  join components as component
    on component.story_id = evidence.story_id
   and component.node = evidence.provider_node
),
qualification_counts as (
  select
    role.story_id,
    count(distinct role.component_key)::integer as reputable_group_count,
    count(distinct role.component_key) filter (
      where role.evidence_role = 'independent_journalism'
    )::integer as journalism_group_count,
    count(distinct role.component_key) filter (
      where role.evidence_role = 'official_primary'
    )::integer as official_primary_group_count,
    count(distinct role.component_key) filter (
      where role.evidence_role = 'institutional_primary'
    )::integer as institutional_primary_group_count
  from qualified_component_roles as role
  group by role.story_id
),
combined_counts as (
  select
    base.story_id,
    base.active_source_item_count,
    base.distinct_source_count,
    base.qualifying_source_count,
    coalesce(qualified.reputable_group_count, 0)::integer as reputable_group_count,
    coalesce(qualified.journalism_group_count, 0)::integer as journalism_group_count,
    coalesce(qualified.official_primary_group_count, 0)::integer as official_primary_group_count,
    coalesce(qualified.institutional_primary_group_count, 0)::integer as institutional_primary_group_count,
    base.context_group_count,
    base.provisional_source_count,
    base.unassessed_source_count,
    base.maximum_reviewed_verification_tier
  from base_counts as base
  left join qualification_counts as qualified
    on qualified.story_id = base.story_id
)
select
  combined_counts.*,
  (
    combined_counts.journalism_group_count >= 2
    or (
      combined_counts.reputable_group_count >= 3
      and combined_counts.journalism_group_count >= 1
    )
  ) as is_corroborated,
  case
    when combined_counts.journalism_group_count >= 2
      then 'two_independent_journalism_groups'
    when combined_counts.reputable_group_count >= 3
      and combined_counts.journalism_group_count >= 1
      then 'three_reputable_groups_with_journalism'
    else 'not_corroborated'
  end as corroboration_route
from combined_counts;

comment on view public.story_corroboration_summary is
  'Security-invoker corroboration signal over active story-source links. Reviewed tier-2+ provider groups are connected to exact recognized wire/news-service bylines so syndicated reprints count once. A Story qualifies through two independent journalism evidence groups, or three reputable evidence groups including journalism.';

revoke all on table public.story_corroboration_summary
  from public, anon, authenticated, service_role;
grant select on table public.story_corroboration_summary to service_role;

update public.sources
set
  feed_url = 'https://njbmagazine.com/feed/?post_type=njb_news_now',
  adapter_config = coalesce(adapter_config, '{}'::jsonb) || jsonb_build_object(
    'exclude_categories', jsonb_build_array(
      'Sponsored Content',
      'Sponsored',
      'Advertorial',
      'Press Release'
    ),
    'exclude_title_patterns', jsonb_build_array(
      'sponsored content',
      'partner content',
      'advertorial',
      'press release'
    )
  ),
  editorial_notes = concat_ws(
    ' ',
    nullif(btrim(editorial_notes), ''),
    'Uses the publication''s official NJB News Now RSS route; labeled sponsored, advertorial, and press-release items are excluded before registration.'
  ),
  updated_at = now()
where name = 'New Jersey Business Magazine';

commit;
