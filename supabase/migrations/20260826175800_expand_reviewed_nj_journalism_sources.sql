begin;

-- Recognize an explicit wire-service credit at either edge of a compound
-- byline. This remains deliberately narrower than arbitrary substring
-- matching, so a newsroom name that merely contains the words does not lose
-- its provider provenance.
create or replace function public.reath_evidence_origin_key(
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
    when normalized_author ~ '^((new jersey|n j|nj) state ?house news( service)?($| (and|with) )|.* (new jersey|n j|nj) state ?house news( service)?$)'
      then 'origin:new-jersey-statehouse-news-service'
    when normalized_author ~ '^((the )?associated press($| (and|with) )|.* (the )?associated press$|ap$)'
      then 'origin:associated-press'
    when normalized_author ~ '^((thomson )?reuters($| (and|with) )|.* (thomson )?reuters$)'
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
  'Fail-closed evidence-origin key. Exact or explicitly compound-credited recognized wire/news-service bylines collapse reprints across providers; all other items retain their reviewed provider group.';

revoke all on function public.reath_evidence_origin_key(text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.reath_evidence_origin_key(text, text)
  to service_role;

with seed(
  name,
  homepage_url,
  feed_url,
  scope,
  county_slug,
  topics,
  priority,
  poll_interval_minutes,
  editorial_notes,
  adapter_config
) as (
  values
    (
      'Chalkbeat Newark',
      'https://www.chalkbeat.org/newark/',
      'https://www.chalkbeat.org/arc/outboundfeeds/rss/category/newark/',
      'county',
      'essex',
      array['education', 'schools', 'state policy'],
      92,
      60,
      'Nonprofit Newark education newsroom. The category-specific Arc feed avoids unrelated Chalkbeat markets.',
      '{}'::jsonb
    ),
    (
      'Ridge View Echo',
      'https://ridgeviewecho.com/',
      'https://ridgeviewecho.com/feed/',
      'county',
      'warren',
      array['local government', 'education', 'community'],
      72,
      120,
      'Independent nonprofit North Warren newsroom; opinion-labeled items are excluded.',
      '{"exclude_categories":["opinion"]}'::jsonb
    ),
    (
      'The Jersey Vindicator',
      'https://jerseyvindicator.org/',
      'https://jerseyvindicator.org/feed/',
      'state',
      null,
      array['investigations', 'government', 'accountability'],
      87,
      60,
      'Independent nonprofit accountability newsroom; opinion and commentary are excluded when labeled.',
      '{"exclude_categories":["opinion","commentary"]}'::jsonb
    ),
    (
      'New Jersey Hills Media Group',
      'https://www.newjerseyhills.com/',
      'https://www.newjerseyhills.com/search/?f=rss&t=article&l=50&s=start_time&sd=desc',
      'state',
      null,
      array['local government', 'education', 'community'],
      88,
      120,
      'CNJLM nonprofit local-news network covering Essex, Hunterdon, Morris, and Somerset communities. Print mirrors, sports, and entertainment routes are excluded.',
      '{"exclude_url_patterns":["/print_only/","/sports/","/entertainment/"],"exclude_title_patterns":["calendar","things to do"]}'::jsonb
    ),
    (
      'Brick Shorebeat',
      'https://shorebeat.com/brick/',
      'https://shorebeat.com/brick/feed/',
      'county',
      'ocean',
      array['local government', 'public safety', 'coastal issues'],
      78,
      60,
      'Original Brick Township reporting from Shorebeat; sibling editions share one editorial-control group.',
      '{}'::jsonb
    ),
    (
      'Toms River Shorebeat',
      'https://shorebeat.com/tomsriver/',
      'https://shorebeat.com/tomsriver/feed/',
      'county',
      'ocean',
      array['local government', 'public safety', 'development'],
      78,
      60,
      'Original Toms River reporting from Shorebeat; sibling editions share one editorial-control group.',
      '{}'::jsonb
    ),
    (
      'Lavallette-Seaside Shorebeat',
      'https://shorebeat.com/lavallette-seaside/',
      'https://shorebeat.com/lavallette-seaside/feed/',
      'county',
      'ocean',
      array['local government', 'public safety', 'coastal issues'],
      78,
      60,
      'Original barrier-island reporting from Shorebeat; sibling editions share one editorial-control group.',
      '{}'::jsonb
    ),
    (
      'Town Topics',
      'https://www.towntopics.com/',
      'https://www.towntopics.com/feed/',
      'county',
      'mercer',
      array['local government', 'education', 'community'],
      76,
      120,
      'Princeton weekly community newspaper; opinion and reader-letter categories are excluded.',
      '{"exclude_categories":["opinion","letters"]}'::jsonb
    ),
    (
      'Ocean City Sentinel',
      'https://ocnjsentinel.com/',
      'https://ocnjsentinel.com/feed/',
      'county',
      'cape-may',
      array['local government', 'public safety', 'coastal issues'],
      80,
      60,
      'Locally owned Cape May County newspaper; opinion is excluded when labeled.',
      '{"exclude_categories":["opinion"]}'::jsonb
    ),
    (
      'Pine Barrens Tribune',
      'https://pinebarrenstribune.com/',
      'https://www.pinebarrenstribune.com/feed/',
      'county',
      'burlington',
      array['local government', 'public safety', 'environment'],
      77,
      60,
      'Independent newspaper covering the Pine Barrens and southern Burlington County.',
      '{}'::jsonb
    ),
    (
      'Essex News Daily',
      'https://essexnewsdaily.com/',
      'https://essexnewsdaily.com/feed/',
      'county',
      'essex',
      array['local government', 'education', 'community'],
      72,
      120,
      'Worrall Community Newspapers coverage for Essex County; sports, opinion, and obituaries are excluded.',
      '{"exclude_categories":["sports","opinion","obituaries"]}'::jsonb
    ),
    (
      'Union News Daily',
      'https://unionnewsdaily.com/',
      'https://unionnewsdaily.com/feed/',
      'county',
      'union',
      array['local government', 'education', 'community'],
      72,
      120,
      'Worrall Community Newspapers coverage for Union County; sports, opinion, and obituaries are excluded.',
      '{"exclude_categories":["sports","opinion","obituaries"]}'::jsonb
    ),
    (
      'The SandPaper',
      'https://www.thesandpaper.net/',
      'https://www.thesandpaper.net/feed/',
      'county',
      'ocean',
      array['local government', 'community', 'coastal issues'],
      74,
      120,
      'Long Beach Island and southern Ocean County newspaper; opinion is excluded when labeled.',
      '{"exclude_categories":["opinion"]}'::jsonb
    ),
    (
      'The Observer',
      'https://www.theobserver.com/',
      'https://www.theobserver.com/feed/',
      'state',
      null,
      array['local government', 'public safety', 'community'],
      73,
      120,
      'Long-running West Hudson and neighboring-community newspaper; obituaries and opinion are excluded.',
      '{"exclude_categories":["obituaries","opinion"]}'::jsonb
    ),
    (
      'The Press Group',
      'https://thepressgroup.net/',
      'https://thepressgroup.net/feed/',
      'county',
      'bergen',
      array['local government', 'education', 'community'],
      80,
      120,
      'Pascack Press and Northern Valley Press feed; community voices, letters, opinion, and advertorial are excluded.',
      '{"exclude_categories":["community voices","letters","opinion","advertorial"],"exclude_title_patterns":["in my experience"]}'::jsonb
    ),
    (
      'Star News Group',
      'https://starnewsgroup.com/',
      'https://starnewsgroup.com/category/news/feed/',
      'state',
      null,
      array['local government', 'public safety', 'community'],
      80,
      120,
      'News-only feed for The Coast Star and The Ocean Star, covering southern Monmouth and northern Ocean counties.',
      '{}'::jsonb
    ),
    (
      'Two River Times',
      'https://tworivertimes.com/',
      'https://tworivertimes.com/feed/',
      'county',
      'monmouth',
      array['local government', 'environment', 'community'],
      82,
      60,
      'Nonprofit Monmouth County newsroom; sports and lifestyle categories are excluded.',
      '{"exclude_categories":["sports","lifestyles"]}'::jsonb
    ),
    (
      'The Coaster',
      'https://thecoaster.net/',
      'https://thecoaster.net/feed/',
      'county',
      'monmouth',
      array['local government', 'public safety', 'community'],
      75,
      60,
      'Independent Asbury Park and coastal Monmouth newspaper; sports and opinion are excluded.',
      '{"exclude_categories":["sports","opinion"]}'::jsonb
    ),
    (
      '42Freeway',
      'https://42freeway.com/',
      'https://42freeway.com/feed/',
      'state',
      null,
      array['development', 'business', 'local government'],
      68,
      120,
      'Specialty South Jersey development reporting; sponsored and advertorial items are excluded when labeled.',
      '{"exclude_categories":["sponsored","advertorial"],"exclude_title_patterns":["sponsored","advertorial"]}'::jsonb
    ),
    (
      'New Jersey 101.5 News',
      'https://nj1015.com/category/new-jersey-news/',
      'https://nj1015.com/category/new-jersey-news/feed/',
      'state',
      null,
      array['breaking news', 'public safety', 'state news'],
      97,
      30,
      'Townsquare New Jersey newsroom using its New Jersey News category feed only; weather, opinion, and sponsored categories are excluded.',
      '{"exclude_categories":["weather","opinion","sponsored"],"exclude_title_patterns":["jersey shore report"]}'::jsonb
    ),
    (
      'PIX11 New Jersey',
      'https://pix11.com/news/local-news/new-jersey/',
      'https://pix11.com/news/local-news/new-jersey/feed/',
      'state',
      null,
      array['breaking news', 'public safety', 'local news'],
      96,
      30,
      'WPIX New Jersey category feed; sibling and ownership provenance is collapsed through the Mission/Nexstar group.',
      '{"exclude_categories":["sports","things to do","sponsored"]}'::jsonb
    ),
    (
      'CBS News Philadelphia - New Jersey',
      'https://www.cbsnews.com/philadelphia/',
      'https://www.cbsnews.com/philadelphia/latest/rss/main',
      'state',
      null,
      array['breaking news', 'public safety', 'South Jersey'],
      95,
      30,
      'Regional CBS newsroom filtered to its explicit New Jersey News feed category; CBS sibling feeds count as one provider.',
      '{"include_categories":["new jersey news"],"exclude_url_patterns":["/video/"]}'::jsonb
    ),
    (
      'CBS News New York - New Jersey',
      'https://www.cbsnews.com/newyork/',
      'https://www.cbsnews.com/newyork/latest/rss/main',
      'state',
      null,
      array['breaking news', 'public safety', 'North Jersey'],
      95,
      30,
      'Regional CBS newsroom filtered to its explicit New Jersey News feed category; CBS sibling feeds count as one provider.',
      '{"include_categories":["new jersey news"],"exclude_url_patterns":["/video/"]}'::jsonb
    ),
    (
      'NBC10 Philadelphia - New Jersey',
      'https://www.nbcphiladelphia.com/tag/new-jersey/',
      'https://www.nbcphiladelphia.com/tag/new-jersey/?rss=y',
      'state',
      null,
      array['breaking news', 'public safety', 'South Jersey'],
      95,
      30,
      'NBC10 New Jersey tag feed; NBC-owned sibling feeds count as one provider and explicit wire bylines retain wire provenance.',
      '{}'::jsonb
    ),
    (
      'NBC 4 New York - New Jersey',
      'https://www.nbcnewyork.com/tag/new-jersey/',
      'https://www.nbcnewyork.com/tag/new-jersey/?rss=y',
      'state',
      null,
      array['breaking news', 'public safety', 'North Jersey'],
      95,
      30,
      'NBC New York New Jersey tag feed; NBC-owned sibling feeds count as one provider and explicit wire bylines retain wire provenance.',
      '{}'::jsonb
    ),
    (
      '6abc - New Jersey',
      'https://6abc.com/new-jersey/',
      'https://6abc.com/feed/',
      'state',
      null,
      array['breaking news', 'public safety', 'South Jersey'],
      94,
      30,
      'WPVI regional feed filtered to entries explicitly categorized New Jersey; ABC-owned sibling feeds count as one provider.',
      '{"include_categories":["new jersey"],"exclude_categories":["sports"]}'::jsonb
    ),
    (
      'ABC7 New York - New Jersey',
      'https://abc7ny.com/new-jersey/',
      'https://abc7ny.com/feed/',
      'state',
      null,
      array['breaking news', 'public safety', 'North Jersey'],
      94,
      30,
      'WABC regional feed filtered to entries explicitly categorized New Jersey; ABC-owned sibling feeds count as one provider.',
      '{"include_categories":["new jersey"],"exclude_categories":["sports"]}'::jsonb
    )
)
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
)
select
  seed.name,
  'journalism',
  seed.homepage_url,
  seed.feed_url,
  'rss',
  seed.scope,
  county.id,
  seed.topics,
  seed.priority,
  seed.poll_interval_minutes,
  true,
  'Store feed metadata and source links only; no article bodies. Preserve publisher attribution and follow the publisher URL for the original report.',
  seed.editorial_notes,
  '2026-08-26T17:58:00Z'::timestamptz,
  seed.adapter_config
from seed
left join public.counties as county
  on county.slug = seed.county_slug;

do $$
declare
  added_count integer;
begin
  select count(*)::integer
  into added_count
  from public.sources
  where name in (
    'Chalkbeat Newark',
    'Ridge View Echo',
    'The Jersey Vindicator',
    'New Jersey Hills Media Group',
    'Brick Shorebeat',
    'Toms River Shorebeat',
    'Lavallette-Seaside Shorebeat',
    'Town Topics',
    'Ocean City Sentinel',
    'Pine Barrens Tribune',
    'Essex News Daily',
    'Union News Daily',
    'The SandPaper',
    'The Observer',
    'The Press Group',
    'Star News Group',
    'Two River Times',
    'The Coaster',
    '42Freeway',
    'New Jersey 101.5 News',
    'PIX11 New Jersey',
    'CBS News Philadelphia - New Jersey',
    'CBS News New York - New Jersey',
    'NBC10 Philadelphia - New Jersey',
    'NBC 4 New York - New Jersey',
    '6abc - New Jersey',
    'ABC7 New York - New Jersey'
  );
  if added_count <> 27 then
    raise exception 'Expected 27 reviewed journalism Source rows after expansion, found %', added_count;
  end if;
end;
$$;

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
  'reviewed',
  'independent_journalism',
  assessment.verification_tier,
  assessment.corroboration_group_key,
  'reath-source-verification-v2',
  assessment.rationale,
  'directive:source-expansion',
  '2026-08-26T17:58:00Z'::timestamptz
from (
  values
    ('Chalkbeat Newark', 3, 'civic-news-company', 'Reviewed nonprofit education newsroom with a named Newark bureau, published ethics standards, and original reporting.'),
    ('Ridge View Echo', 2, 'ridge-view-echo', 'Reviewed independent nonprofit North Warren newsroom with named local staff and original civic reporting.'),
    ('The Jersey Vindicator', 2, 'jersey-vindicator', 'Reviewed independent nonprofit New Jersey accountability newsroom with published ethics and corrections commitments.'),
    ('New Jersey Hills Media Group', 3, 'cnjlm', 'Reviewed nonprofit local-news group operated by the Corporation for New Jersey Local Media; all member titles count once.'),
    ('Brick Shorebeat', 2, 'shorebeat', 'Reviewed original local reporting by the Shorebeat newsroom; sibling editions count once.'),
    ('Toms River Shorebeat', 2, 'shorebeat', 'Reviewed original local reporting by the Shorebeat newsroom; sibling editions count once.'),
    ('Lavallette-Seaside Shorebeat', 2, 'shorebeat', 'Reviewed original local reporting by the Shorebeat newsroom; sibling editions count once.'),
    ('Town Topics', 2, 'town-topics', 'Reviewed long-running Princeton community newspaper with named editors and reporters.'),
    ('Ocean City Sentinel', 3, 'seawave-corp', 'Reviewed locally owned newspaper with a named editor, reporting staff, and documented news/opinion separation.'),
    ('Pine Barrens Tribune', 2, 'pine-barrens-tribune', 'Reviewed independent community newspaper producing original municipal and public-safety reporting.'),
    ('Essex News Daily', 2, 'worrall-community-newspapers', 'Reviewed Worrall Community Newspapers reporting; sibling Essex and Union feeds count once.'),
    ('Union News Daily', 2, 'worrall-community-newspapers', 'Reviewed Worrall Community Newspapers reporting; sibling Essex and Union feeds count once.'),
    ('The SandPaper', 2, 'sandpaper-inc', 'Reviewed Long Beach Island and southern Ocean County community newspaper.'),
    ('The Observer', 2, 'observer-kearny', 'Reviewed long-running local newspaper with named editorial staff and original public-affairs reporting.'),
    ('The Press Group', 3, 'press-group-inc', 'Reviewed Bergen County newspaper group with named editorial contacts, corrections guidance, and original municipal reporting.'),
    ('Star News Group', 3, 'star-news-group', 'Reviewed publisher of The Coast Star and The Ocean Star; the news-only feed excludes its separate entertainment publication.'),
    ('Two River Times', 3, 'two-river-times-foundation', 'Reviewed nonprofit Monmouth County newspaper producing original civic and accountability reporting.'),
    ('The Coaster', 2, 'new-coaster-llc', 'Reviewed independent Asbury Park-area newspaper with named reporting staff.'),
    ('42Freeway', 2, '42freeway', 'Reviewed specialty South Jersey newsroom producing original development and local-business reporting.'),
    ('New Jersey 101.5 News', 3, 'townsquare-media', 'Reviewed New Jersey radio/digital newsroom; only its New Jersey News category feed is ingested.'),
    ('PIX11 New Jersey', 3, 'mission-nexstar-wpix', 'Reviewed metropolitan television newsroom using its dedicated New Jersey feed; ownership and operating control count once.'),
    ('CBS News Philadelphia - New Jersey', 3, 'paramount-cbs-owned-stations', 'Reviewed regional television newsroom; only explicitly categorized New Jersey reporting qualifies and CBS sibling feeds count once.'),
    ('CBS News New York - New Jersey', 3, 'paramount-cbs-owned-stations', 'Reviewed regional television newsroom; only explicitly categorized New Jersey reporting qualifies and CBS sibling feeds count once.'),
    ('NBC10 Philadelphia - New Jersey', 3, 'nbcuniversal-local', 'Reviewed regional television newsroom using a dedicated New Jersey tag feed; NBC-owned sibling feeds count once.'),
    ('NBC 4 New York - New Jersey', 3, 'nbcuniversal-local', 'Reviewed regional television newsroom using a dedicated New Jersey tag feed; NBC-owned sibling feeds count once.'),
    ('6abc - New Jersey', 3, 'abc-owned-television-stations', 'Reviewed regional television newsroom; category filtering limits evidence to New Jersey and ABC-owned sibling feeds count once.'),
    ('ABC7 New York - New Jersey', 3, 'abc-owned-television-stations', 'Reviewed regional television newsroom; category filtering limits evidence to New Jersey and ABC-owned sibling feeds count once.')
) as assessment(source_name, verification_tier, corroboration_group_key, rationale)
join public.sources as source
  on source.name = assessment.source_name;

do $$
declare
  affected_rows integer;
begin
  update public.sources
  set
    feed_url = 'https://jcitytimes.com/category/news/feed/',
    priority = 80,
    active = true,
    last_checked_at = null,
    last_error_at = null,
    last_error = null,
    failure_streak = 0,
    editorial_notes = 'Jersey City original-news category feed validated with ten current bylined items; non-news sections remain outside ingestion.',
    verified_at = '2026-08-26T17:58:00Z'::timestamptz,
    updated_at = now()
  where name = 'Jersey City Times'
    and feed_url = 'https://jcitytimes.com/feed/'
    and active = false;
  get diagnostics affected_rows = row_count;
  if affected_rows <> 1 then
    raise exception 'Expected exactly one conditional Jersey City Times Source to reactivate, updated %', affected_rows;
  end if;

  update public.source_assessments as assessment
  set superseded_at = '2026-08-26T17:58:00Z'::timestamptz
  from public.sources as source
  where source.id = assessment.source_id
    and source.name = 'Jersey City Times'
    and assessment.superseded_at is null
    and assessment.assessment_status = 'provisional';
  get diagnostics affected_rows = row_count;
  if affected_rows <> 1 then
    raise exception 'Expected one current provisional Jersey City Times assessment to supersede, updated %', affected_rows;
  end if;

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
    'reviewed',
    'independent_journalism',
    2,
    'jersey-city-times',
    'reath-source-verification-v2',
    'Reviewed Jersey City newsroom after validating a populated original-news category feed with named reporters and current civic coverage.',
    'directive:source-expansion',
    '2026-08-26T17:58:00Z'::timestamptz
  from public.sources as source
  where source.name = 'Jersey City Times';
end;
$$;

do $$
declare
  affected_rows integer;
begin
  update public.source_assessments as assessment
  set superseded_at = '2026-08-26T17:58:00Z'::timestamptz
  from public.sources as source
  where source.id = assessment.source_id
    and source.name in ('Sea Isle News', 'BreakingAC')
    and assessment.superseded_at is null;
  get diagnostics affected_rows = row_count;
  if affected_rows <> 2 then
    raise exception 'Expected two current Fideri-owned Source assessments to supersede, updated %', affected_rows;
  end if;

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
    case when source.name = 'Sea Isle News' then 'reviewed' else 'provisional' end,
    case when source.name = 'Sea Isle News' then 'independent_journalism' else 'excluded' end,
    case when source.name = 'Sea Isle News' then 2 else 0 end,
    'fideri-news-network',
    'reath-source-verification-v2',
    case
      when source.name = 'Sea Isle News'
        then 'Reviewed local newsroom now documented as part of Fideri News Network; Fideri sibling sites must count once.'
      else 'Still excluded while inactive and partner/promotional provenance is unresolved; ownership is now correctly recorded as Fideri News Network.'
    end,
    'directive:source-expansion',
    '2026-08-26T17:58:00Z'::timestamptz
  from public.sources as source
  where source.name in ('Sea Isle News', 'BreakingAC');
end;
$$;

commit;
