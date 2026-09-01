begin;

create table public.source_assessments (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.sources(id) on delete restrict,
  assessment_status text not null
    check (assessment_status in ('provisional', 'reviewed')),
  evidence_role text not null
    check (evidence_role in (
      'independent_journalism',
      'official_primary',
      'institutional_primary',
      'context_only',
      'excluded'
    )),
  verification_tier smallint not null
    check (verification_tier between 0 and 3),
  corroboration_group_key text not null
    check (nullif(btrim(corroboration_group_key), '') is not null),
  methodology_version text not null
    check (nullif(btrim(methodology_version), '') is not null),
  rationale text not null
    check (nullif(btrim(rationale), '') is not null),
  assessed_by text not null
    check (nullif(btrim(assessed_by), '') is not null),
  assessed_at timestamptz not null default now(),
  superseded_at timestamptz,
  created_at timestamptz not null default now(),
  check (superseded_at is null or superseded_at >= assessed_at)
);

comment on table public.source_assessments is
  'Append-audited source reputation and evidence-role assessments. Only a current reviewed assessment at tier 2 or higher contributes to corroboration.';
comment on column public.source_assessments.corroboration_group_key is
  'Stable ownership or editorial-control group used to prevent sibling outlets from counting as independent corroboration.';
comment on column public.source_assessments.verification_tier is
  'Generic verification tier from 0 through 3; applies to journalism, official, institutional, contextual, and excluded roles.';

create unique index source_assessments_one_current_idx
  on public.source_assessments(source_id)
  where superseded_at is null;

create index source_assessments_source_history_idx
  on public.source_assessments(source_id, assessed_at desc);

create function public.guard_source_assessment_history()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Source assessments are append-audited and cannot be deleted';
  end if;

  if new.id is distinct from old.id
     or new.source_id is distinct from old.source_id
     or new.assessment_status is distinct from old.assessment_status
     or new.evidence_role is distinct from old.evidence_role
     or new.verification_tier is distinct from old.verification_tier
     or new.corroboration_group_key is distinct from old.corroboration_group_key
     or new.methodology_version is distinct from old.methodology_version
     or new.rationale is distinct from old.rationale
     or new.assessed_by is distinct from old.assessed_by
     or new.assessed_at is distinct from old.assessed_at
     or new.created_at is distinct from old.created_at
  then
    raise exception 'Source assessment facts are immutable; supersede the row and append a new assessment';
  end if;

  if old.superseded_at is not null or new.superseded_at is null then
    raise exception 'A source assessment may only transition once from current to superseded';
  end if;

  return new;
end;
$$;

create trigger source_assessments_guard_history
before update or delete on public.source_assessments
for each row execute function public.guard_source_assessment_history();

alter table public.source_assessments enable row level security;

revoke all on table public.source_assessments
  from public, anon, authenticated, service_role;
grant select, insert on table public.source_assessments to service_role;
grant update (superseded_at) on table public.source_assessments to service_role;

revoke all on function public.guard_source_assessment_history()
  from public, anon, authenticated, service_role;

insert into public.sources (
  name,
  source_type,
  homepage_url,
  feed_url,
  ingestion_method,
  scope,
  county_id,
  topics,
  priority,
  poll_interval_minutes,
  active,
  rights_notes,
  editorial_notes,
  verified_at,
  adapter_config
) values
  (
    'WHYY New Jersey',
    'journalism',
    'https://whyy.org/tag/new-jersey/',
    'https://whyy.org/tag/new-jersey/feed/',
    'rss',
    'state',
    null,
    array['local news', 'policy', 'community'],
    90,
    30,
    true,
    'Store feed metadata and source links only; no article bodies.',
    'New Jersey coverage from regional nonprofit public media; apply the New Jersey geography gate.',
    '2026-08-26T09:00:08Z',
    '{}'::jsonb
  ),
  (
    'The Press of Atlantic City',
    'journalism',
    'https://pressofatlanticcity.com/',
    'https://pressofatlanticcity.com/search/?f=rss&t=article&c=news/local&l=50&s=start_time&sd=desc',
    'rss',
    'county',
    1,
    array['local news', 'government', 'public safety'],
    85,
    60,
    true,
    'Store feed metadata and source links only; no article bodies.',
    'Atlantic County and South Jersey reporting; paywalled items remain metadata and links.',
    '2026-08-26T09:00:08Z',
    '{}'::jsonb
  ),
  (
    'NJ Pen',
    'journalism',
    'https://www.njpen.com/',
    'https://www.njpen.com/feed/',
    'rss',
    'county',
    4,
    array['local news', 'government', 'community'],
    75,
    60,
    true,
    'Store feed metadata and source links only; no article bodies.',
    'Camden County community reporting; paywalled items remain metadata and links.',
    '2026-08-26T09:00:08Z',
    '{}'::jsonb
  ),
  (
    'Hudson County View',
    'journalism',
    'https://hudsoncountyview.com/',
    'https://hudsoncountyview.com/feed/',
    'rss',
    'county',
    9,
    array['local news', 'government', 'politics'],
    75,
    60,
    false,
    'Store feed metadata and source links only; no article bodies.',
    'Conditional registry entry. Keep polling disabled until the current homepage spam-link compromise is remediated and revalidated.',
    '2026-08-26T09:00:08Z',
    '{}'::jsonb
  ),
  (
    'Montclair Local',
    'journalism',
    'https://montclairlocal.news/',
    'https://montclairlocal.news/feed/',
    'rss',
    'county',
    7,
    array['local news', 'government', 'education'],
    75,
    60,
    true,
    'Store feed metadata and source links only; no article bodies.',
    'Montclair and Essex County local reporting; explicit announcement and obituary labels are excluded.',
    '2026-08-26T09:00:08Z',
    '{"exclude_categories":["announcements","obituaries"]}'::jsonb
  ),
  (
    'Planet Princeton',
    'journalism',
    'https://planetprinceton.com/',
    'https://planetprinceton.com/feed/',
    'rss',
    'county',
    11,
    array['local news', 'government', 'community'],
    75,
    60,
    true,
    'Store feed metadata and source links only; no article bodies.',
    'Princeton and Mercer County local reporting; sponsored and promoted items are excluded when labeled.',
    '2026-08-26T09:00:08Z',
    '{"exclude_categories":["sponsored","promoted"],"exclude_title_patterns":["sponsored","promoted"]}'::jsonb
  ),
  (
    'MercerMe',
    'journalism',
    'https://mercerme.com/',
    'https://mercerme.com/feed/',
    'rss',
    'county',
    11,
    array['local news', 'government', 'community'],
    70,
    60,
    true,
    'Store feed metadata and source links only; no article bodies.',
    'Hopewell Valley and Mercer County reporting; sponsored, advertorial, and opinion items are excluded when labeled.',
    '2026-08-26T09:00:08Z',
    '{"exclude_categories":["sponsored","advertorial","opinion"],"exclude_title_patterns":["sponsored","advertorial"]}'::jsonb
  ),
  (
    'Morristown Green',
    'journalism',
    'https://morristowngreen.com/',
    'https://morristowngreen.com/feed/',
    'rss',
    'county',
    14,
    array['local news', 'government', 'community'],
    70,
    60,
    true,
    'Store feed metadata and source links only; no article bodies.',
    'Greater Morristown reporting; sponsored items are excluded when labeled.',
    '2026-08-26T09:00:08Z',
    '{"exclude_categories":["sponsored"],"exclude_title_patterns":["sponsored"]}'::jsonb
  ),
  (
    'New Brunswick Today',
    'journalism',
    'https://newbrunswicktoday.com/',
    'https://newbrunswicktoday.com/feed/',
    'rss',
    'county',
    12,
    array['local news', 'government', 'accountability'],
    75,
    60,
    true,
    'Store feed metadata and source links only; no article bodies.',
    'New Brunswick and Middlesex County reporting; opinion items are excluded when labeled.',
    '2026-08-26T09:00:08Z',
    '{"exclude_categories":["opinion"]}'::jsonb
  ),
  (
    'Front Runner New Jersey',
    'journalism',
    'https://frontrunnernewjersey.com/',
    'https://frontrunnernewjersey.com/feed/',
    'rss',
    'state',
    null,
    array['community', 'politics', 'business'],
    70,
    60,
    true,
    'Store feed metadata and source links only; no article bodies.',
    'Coverage of communities of color across South Jersey; op-ed and sponsored items are excluded when labeled.',
    '2026-08-26T09:00:08Z',
    '{"exclude_categories":["op-ed","sponsored"],"exclude_title_patterns":["sponsored"]}'::jsonb
  ),
  (
    'Paterson Times',
    'journalism',
    'https://patersontimes.com/',
    'https://patersontimes.com/feed/',
    'rss',
    'county',
    16,
    array['local news', 'government', 'public safety'],
    75,
    60,
    true,
    'Store feed metadata and source links only; no article bodies.',
    'Paterson and Passaic County reporting; ranking should not let crime or weather volume dominate.',
    '2026-08-26T09:00:08Z',
    '{}'::jsonb
  ),
  (
    'NJArts.net',
    'culture',
    'https://www.njarts.net/',
    'https://www.njarts.net/feed/',
    'rss',
    'state',
    null,
    array['arts', 'culture', 'events'],
    60,
    60,
    true,
    'Store feed metadata and source links only; no article bodies.',
    'Statewide specialty arts journalism; use lower editorial priority and deduplicate against other arts feeds.',
    '2026-08-26T09:00:08Z',
    '{}'::jsonb
  ),
  (
    'NJEDA',
    'government',
    'https://www.njeda.gov/',
    'https://www.njeda.gov/feed/',
    'rss',
    'state',
    null,
    array['business', 'economic development', 'grants'],
    85,
    30,
    true,
    'Official public source. Retain feed metadata and source links only; no article bodies.',
    'Primary-source agency announcements; attribute claims to NJEDA and do not treat them as independent reporting.',
    '2026-08-26T09:00:08Z',
    '{}'::jsonb
  ),
  (
    'Jersey City Times',
    'journalism',
    'https://jcitytimes.com/',
    'https://jcitytimes.com/feed/',
    'rss',
    'county',
    9,
    array['local news', 'government', 'community'],
    65,
    60,
    false,
    'Store feed metadata and source links only; no article bodies.',
    'Conditional registry entry. Keep polling disabled until feed-depth monitoring confirms reliable coverage beyond the current one-item feed.',
    '2026-08-26T09:00:08Z',
    '{}'::jsonb
  ),
  (
    'NJ Urban News',
    'journalism',
    'https://njurbannews.com/',
    'https://njurbannews.com/feed/',
    'rss',
    'state',
    null,
    array['local news', 'community', 'public affairs'],
    80,
    60,
    true,
    'Store feed metadata and source links only; no article bodies.',
    'Statewide urban-community coverage; assessment remains provisional until republished, guest, official, and sponsored origins are detected reliably.',
    '2026-08-26T09:00:08Z',
    '{"exclude_categories":["sponsored","opinion","press release"]}'::jsonb
  ),
  (
    'Jersey Shore Online',
    'journalism',
    'https://www.jerseyshoreonline.com/',
    'https://www.jerseyshoreonline.com/feed/',
    'rss',
    'county',
    15,
    array['local news', 'government', 'public safety'],
    70,
    60,
    true,
    'Store feed metadata and source links only; no article bodies.',
    'Ocean and Monmouth regional reporting; preserve local-edition and release provenance.',
    '2026-08-26T09:00:08Z',
    '{}'::jsonb
  ),
  (
    'The Jersey Bee',
    'journalism',
    'https://jerseybee.org/',
    'https://jerseybee.org/feed/',
    'rss',
    'county',
    7,
    array['local news', 'community', 'public service'],
    70,
    60,
    true,
    'Store feed metadata and source links only; no article bodies.',
    'East Essex public-service journalism; assessment remains provisional and recurring Buzz curation posts are excluded.',
    '2026-08-26T09:00:08Z',
    '{"exclude_title_patterns":["Daily Buzz","Weekly Buzz"]}'::jsonb
  ),
  (
    'Red Bank Green',
    'journalism',
    'https://www.redbankgreen.com/',
    'https://www.redbankgreen.com/feed/',
    'rss',
    'county',
    13,
    array['local news', 'government', 'community'],
    70,
    60,
    true,
    'Store feed metadata and source links only; no article bodies.',
    'Red Bank and Monmouth County local reporting; preserve announcement and contributor provenance.',
    '2026-08-26T09:00:08Z',
    '{}'::jsonb
  );

insert into public.source_assessments (
  source_id,
  assessment_status,
  evidence_role,
  verification_tier,
  corroboration_group_key,
  methodology_version,
  rationale,
  assessed_by,
  assessed_at
)
select
  source.id,
  seed.assessment_status,
  seed.evidence_role,
  seed.verification_tier,
  seed.corroboration_group_key,
  'reath-source-verification-v1',
  seed.rationale,
  'migration:20260826090008',
  '2026-08-26T09:00:08Z'::timestamptz
from (
  values
    ('NJ Spotlight News', 'reviewed', 'independent_journalism', 3, 'nj-spotlight', 'Reviewed statewide public-affairs newsroom with original reporting.'),
    ('New Jersey Monitor', 'reviewed', 'independent_journalism', 3, 'states-newsroom', 'Reviewed nonprofit statehouse newsroom with original reporting.'),
    ('New Jersey Globe', 'reviewed', 'independent_journalism', 2, 'new-jersey-globe', 'Reviewed New Jersey politics newsroom; distinguish analysis and opinion when labeled.'),
    ('Insider NJ', 'reviewed', 'independent_journalism', 2, 'insider-nj', 'Reviewed politics and public-affairs newsroom.'),
    ('ROI-NJ', 'reviewed', 'independent_journalism', 2, 'roi-nj', 'Reviewed business newsroom with original New Jersey reporting.'),
    ('NJBIZ', 'reviewed', 'independent_journalism', 2, 'njbiz', 'Reviewed business newsroom; paywalled evidence remains metadata and links.'),
    ('NJ.com', 'reviewed', 'independent_journalism', 3, 'advance-local', 'Reviewed high-volume statewide newsroom under a shared ownership group.'),
    ('New Jersey Monthly', 'reviewed', 'independent_journalism', 2, 'new-jersey-monthly', 'Reviewed culture and long-lead magazine journalism.'),
    ('New Jersey Stage', 'reviewed', 'context_only', 1, 'new-jersey-stage', 'Reviewed arts and events context source; recurring listings do not independently corroborate hard-news claims.'),
    ('New Jersey Business Magazine', 'reviewed', 'institutional_primary', 2, 'njbia', 'Reviewed New Jersey Business and Industry Association publication; treat claims as institutional evidence.'),
    ('New Jersey Future', 'reviewed', 'context_only', 1, 'new-jersey-future', 'Reviewed advocacy and research source used for attributed context, not independent corroboration.'),
    ('Sea Isle News', 'reviewed', 'independent_journalism', 2, 'sea-isle-news', 'Reviewed local Cape May County newsroom.'),
    ('BreakingAC', 'provisional', 'excluded', 0, 'breakingac', 'Excluded from corroboration while the feed remains dominated by partner or promotional content.'),
    ('Route 40', 'provisional', 'excluded', 0, 'route-40', 'Excluded from corroboration while the feed serves casino spam instead of the expected publication.'),
    ('New Jersey Office of the Attorney General', 'reviewed', 'official_primary', 3, 'nj-attorney-general', 'Reviewed official state primary source; claims require attribution and are not journalism.'),
    ('511NJ Active Events', 'provisional', 'official_primary', 3, 'nj-dot-511', 'Official operational source, but provisional while stable item provenance is unavailable.'),
    ('Rutgers NJAES News', 'reviewed', 'institutional_primary', 3, 'rutgers', 'Reviewed university extension primary source; claims require institutional attribution.'),
    ('New Jersey Resources News Center', 'reviewed', 'institutional_primary', 2, 'new-jersey-resources', 'Reviewed corporate primary source; claims require corporate attribution.'),
    ('WHYY New Jersey', 'reviewed', 'independent_journalism', 3, 'whyy', 'Reviewed nonprofit public-media newsroom with original regional reporting.'),
    ('The Press of Atlantic City', 'reviewed', 'independent_journalism', 3, 'lee-enterprises', 'Reviewed South Jersey newsroom; ownership group prevents sibling outlets from double counting.'),
    ('NJ Pen', 'reviewed', 'independent_journalism', 2, 'nj-pen', 'Reviewed independent Camden County newsroom.'),
    ('Hudson County View', 'provisional', 'independent_journalism', 2, 'hudson-county-view', 'Provisional pending remediation and revalidation of the current homepage spam-link compromise.'),
    ('Montclair Local', 'reviewed', 'independent_journalism', 2, 'montclair-local', 'Reviewed nonprofit Montclair local newsroom.'),
    ('Planet Princeton', 'reviewed', 'independent_journalism', 2, 'planet-princeton', 'Reviewed independent Mercer County newsroom with sponsored-content filtering.'),
    ('MercerMe', 'reviewed', 'independent_journalism', 2, 'mercerme', 'Reviewed independent Hopewell Valley newsroom with provenance-sensitive filtering.'),
    ('Morristown Green', 'reviewed', 'independent_journalism', 2, 'morristown-green', 'Reviewed independent greater-Morristown newsroom.'),
    ('New Brunswick Today', 'reviewed', 'independent_journalism', 2, 'new-brunswick-today', 'Reviewed independent Middlesex County accountability newsroom.'),
    ('Front Runner New Jersey', 'reviewed', 'independent_journalism', 2, 'front-runner-new-jersey', 'Reviewed independent publication covering communities of color across South Jersey.'),
    ('Paterson Times', 'reviewed', 'independent_journalism', 2, 'paterson-times', 'Reviewed independent Paterson local newsroom.'),
    ('NJArts.net', 'reviewed', 'independent_journalism', 2, 'njarts', 'Reviewed nonprofit specialty arts journalism.'),
    ('NJEDA', 'reviewed', 'official_primary', 3, 'njeda', 'Reviewed official economic-development primary source; claims require agency attribution.'),
    ('Jersey City Times', 'provisional', 'independent_journalism', 2, 'jersey-city-times', 'Provisional pending feed-depth monitoring beyond the current one-item feed.'),
    ('NJ Urban News', 'provisional', 'independent_journalism', 3, 'nj-urban-news', 'Provisional until republished, guest, official, and sponsored item origins are classified reliably.'),
    ('Jersey Shore Online', 'reviewed', 'independent_journalism', 2, 'micromedia-publications', 'Reviewed regional local-news publication under the Micromedia ownership group.'),
    ('The Jersey Bee', 'provisional', 'independent_journalism', 2, 'community-info-coop', 'Provisional while recurring curation posts and original reporting are separated reliably.'),
    ('Red Bank Green', 'reviewed', 'independent_journalism', 2, 'red-bank-green', 'Reviewed independent Red Bank local newsroom.')
) as seed(
  source_name,
  assessment_status,
  evidence_role,
  verification_tier,
  corroboration_group_key,
  rationale
)
join public.sources as source
  on source.name = seed.source_name;

do $$
declare
  unassessed_sources text;
begin
  select string_agg(source.name, ', ' order by source.name)
  into unassessed_sources
  from public.sources as source
  left join public.source_assessments as assessment
    on assessment.source_id = source.id
   and assessment.superseded_at is null
  where assessment.id is null;

  if unassessed_sources is not null then
    raise exception 'Current source assessment seed is incomplete: %', unassessed_sources;
  end if;
end;
$$;

create view public.story_corroboration_summary
with (security_invoker = true)
as
with evidence_counts as (
  select
    story.id as story_id,
    count(story_source.source_item_id)::integer as active_source_item_count,
    count(distinct source_item.source_id)::integer as distinct_source_count,
    count(distinct source_item.source_id) filter (
      where assessment.assessment_status = 'reviewed'
        and assessment.verification_tier >= 2
        and assessment.evidence_role in (
          'independent_journalism',
          'official_primary',
          'institutional_primary'
        )
    )::integer as qualifying_source_count,
    count(distinct assessment.corroboration_group_key) filter (
      where assessment.assessment_status = 'reviewed'
        and assessment.verification_tier >= 2
        and assessment.evidence_role in (
          'independent_journalism',
          'official_primary',
          'institutional_primary'
        )
    )::integer as reputable_group_count,
    count(distinct assessment.corroboration_group_key) filter (
      where assessment.assessment_status = 'reviewed'
        and assessment.verification_tier >= 2
        and assessment.evidence_role = 'independent_journalism'
    )::integer as journalism_group_count,
    count(distinct assessment.corroboration_group_key) filter (
      where assessment.assessment_status = 'reviewed'
        and assessment.verification_tier >= 2
        and assessment.evidence_role = 'official_primary'
    )::integer as official_primary_group_count,
    count(distinct assessment.corroboration_group_key) filter (
      where assessment.assessment_status = 'reviewed'
        and assessment.verification_tier >= 2
        and assessment.evidence_role = 'institutional_primary'
    )::integer as institutional_primary_group_count,
    count(distinct assessment.corroboration_group_key) filter (
      where assessment.assessment_status = 'reviewed'
        and assessment.verification_tier >= 2
        and assessment.evidence_role = 'context_only'
    )::integer as context_group_count,
    count(distinct source_item.source_id) filter (
      where assessment.assessment_status = 'provisional'
    )::integer as provisional_source_count,
    count(distinct source_item.source_id) filter (
      where source_item.source_id is not null
        and assessment.id is null
    )::integer as unassessed_source_count,
    max(assessment.verification_tier) filter (
      where assessment.assessment_status = 'reviewed'
    ) as maximum_reviewed_verification_tier
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
  group by story.id
)
select
  evidence_counts.*,
  (
    evidence_counts.journalism_group_count >= 2
    or (
      evidence_counts.reputable_group_count >= 3
      and evidence_counts.journalism_group_count >= 1
    )
  ) as is_corroborated,
  case
    when evidence_counts.journalism_group_count >= 2
      then 'two_independent_journalism_groups'
    when evidence_counts.reputable_group_count >= 3
      and evidence_counts.journalism_group_count >= 1
      then 'three_reputable_groups_with_journalism'
    else 'not_corroborated'
  end as corroboration_route
from evidence_counts;

comment on view public.story_corroboration_summary is
  'Security-invoker corroboration signal over active story-source links. A story qualifies through two reviewed tier-2+ journalism groups, or three reviewed tier-2+ journalism, official, or institutional groups including journalism; context-only evidence remains auditable but never qualifies.';

revoke all on table public.story_corroboration_summary
  from public, anon, authenticated, service_role;
grant select on table public.story_corroboration_summary to service_role;

create index stories_active_activity_idx
  on public.stories(last_activity_at desc, id)
  where status <> 'merged';

comment on index public.stories_active_activity_idx is
  'Supports Reath Wire activity ordering for non-merged stories.';

commit;
