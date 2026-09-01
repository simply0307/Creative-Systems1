begin;

-- Add only publisher-operated feeds that were reachable and populated from a
-- Netlify-compatible request on 2026-08-27. The two Fox stations share one
-- editorial-control group, so mirrored ownership can never manufacture a
-- second corroborating provider.
with seed(
  name,
  homepage_url,
  feed_url,
  topics,
  priority,
  poll_interval_minutes,
  editorial_notes,
  adapter_config
) as (
  values
    (
      'FOX 29 Philadelphia - New Jersey',
      'https://www.fox29.com/tag/nj',
      'https://www.fox29.com/rss.xml?tag=nj',
      array['breaking news','public safety','South Jersey'],
      95,
      720,
      'Reviewed Philadelphia television newsroom using its publisher-operated New Jersey tag feed. Weather, sports, lifestyle, rankings, and shopping-style material are excluded; Fox-owned sibling stations count once.',
      '{"exclude_categories":["weather","sports","lifestyle"],"exclude_title_patterns":["best public high schools","you must earn this much","it costs this much","locations are on the list"]}'::jsonb
    ),
    (
      'FOX 5 New York - New Jersey',
      'https://www.fox5ny.com/tag/nj',
      'https://www.fox5ny.com/rss.xml?tag=nj',
      array['breaking news','public safety','North Jersey'],
      95,
      720,
      'Reviewed New York television newsroom using its publisher-operated New Jersey tag feed. Weather, sports, lifestyle, rankings, and shopping-style material are excluded; Fox-owned sibling stations count once.',
      '{"exclude_categories":["weather","sports","lifestyle"],"exclude_title_patterns":["best public high schools","you must earn this much","it costs this much","locations are on the list"]}'::jsonb
    ),
    (
      '70and73',
      'https://www.70and73.com/',
      'https://www.70and73.com/search/?f=rss&t=article&l=50&s=start_time&sd=desc',
      array['local government','development','education'],
      80,
      1440,
      'Reviewed independent Camden-Burlington local newsroom. A publisher byline allowlist isolates original 70and73 reporting from New Jersey Monitor and NJ Spotlight syndication in the same feed.',
      '{"include_author_patterns":["70and73.com"]}'::jsonb
    )
)
insert into public.sources (
  name, source_type, homepage_url, feed_url, ingestion_method, scope,
  county_id, topics, priority, poll_interval_minutes, active, rights_notes,
  editorial_notes, verified_at, adapter_config
)
select
  seed.name,
  'journalism',
  seed.homepage_url,
  seed.feed_url,
  'rss',
  case when seed.name = '70and73' then 'county' else 'state' end,
  case when seed.name = '70and73' then county.id else null end,
  seed.topics,
  seed.priority,
  seed.poll_interval_minutes,
  true,
  'Store feed metadata and source links only; no article bodies. Preserve publisher attribution and follow the publisher URL for the original report.',
  seed.editorial_notes,
  '2026-08-27T17:16:34Z'::timestamptz,
  seed.adapter_config
from seed
left join public.counties as county on county.slug = 'camden';

insert into public.source_assessments (
  source_id, assessment_status, evidence_role, verification_tier,
  corroboration_group_key, methodology_version, rationale, assessed_by, assessed_at
)
select
  source.id,
  'reviewed',
  'independent_journalism',
  assessment.verification_tier,
  assessment.corroboration_group_key,
  'reath-source-verification-v3',
  assessment.rationale,
  'directive:source-expansion-and-event-recall',
  '2026-08-27T17:16:34Z'::timestamptz
from (
  values
    ('FOX 29 Philadelphia - New Jersey', 3, 'fox-television-stations', 'Reviewed regional broadcast newsroom with a populated publisher-operated New Jersey feed; editorial-control provenance collapses Fox sibling stations.'),
    ('FOX 5 New York - New Jersey', 3, 'fox-television-stations', 'Reviewed regional broadcast newsroom with a populated publisher-operated New Jersey feed; editorial-control provenance collapses Fox sibling stations.'),
    ('70and73', 2, '70and73-ewald-technology', 'Reviewed independent local newsroom with named editorial leadership and original Camden-Burlington reporting; a byline allowlist excludes syndicated copies.')
) as assessment(source_name, verification_tier, corroboration_group_key, rationale)
join public.sources as source on source.name = assessment.source_name;

do $$
declare
  added_sources integer;
  qualifying_assessments integer;
  independent_groups integer;
begin
  select count(*)::integer into added_sources
  from public.sources
  where name in ('FOX 29 Philadelphia - New Jersey','FOX 5 New York - New Jersey','70and73');
  if added_sources <> 3 then
    raise exception 'Expected three additional reviewed Sources, found %', added_sources;
  end if;

  select count(*)::integer,
         count(distinct assessment.corroboration_group_key)::integer
  into qualifying_assessments, independent_groups
  from public.source_assessments as assessment
  join public.sources as source on source.id = assessment.source_id
  where source.name in ('FOX 29 Philadelphia - New Jersey','FOX 5 New York - New Jersey','70and73')
    and assessment.superseded_at is null
    and assessment.assessment_status = 'reviewed'
    and assessment.evidence_role = 'independent_journalism'
    and assessment.verification_tier >= 2;
  if qualifying_assessments <> 3 or independent_groups <> 2 then
    raise exception 'Expected three qualifying assessments across two independent groups, found % assessments and % groups', qualifying_assessments, independent_groups;
  end if;
end;
$$;

commit;
