begin;

-- Extend the registry only with feeds that were reachable on 2026-08-27 and
-- whose original journalism can be isolated without storing article bodies.
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
    ('Jersey Digs', 'https://jerseydigs.com/', 'https://jerseydigs.com/feed/', 'state', null,
      array['development','housing','local government'], 82, 720,
      'Specialty New Jersey development newsroom. Sponsored, listing, dining, opinion, and event material is excluded.',
      '{"exclude_categories":["sponsored","listing","food & drink","opinion","events"],"exclude_title_patterns":["sponsored:"]}'::jsonb),
    ('The Village Green', 'https://villagegreennj.com/', 'https://villagegreennj.com/feed/', 'county', 'essex',
      array['local government','education','public safety'], 79, 720,
      'Independent Maplewood-South Orange local newsroom. Institutional, submitted, sponsored, opinion, and calendar material is excluded.',
      '{"exclude_categories":["opinion","sponsored","calendar"],"exclude_author_patterns":["the village green","university relations","public information office","press release"]}'::jsonb),
    ('MyVeronaNJ', 'https://myveronanj.com/', 'https://myveronanj.com/feed/', 'county', 'essex',
      array['local government','education','community'], 76, 720,
      'Independent Verona newsroom; only currently reviewed original-reporting bylines qualify, excluding press releases, listings, and syndicated copies.',
      '{"include_author_patterns":["virginia citrano","danielle cantor"],"exclude_categories":["press release","real estate","obituaries","opinion"]}'::jsonb),
    ('WRNJ Radio', 'https://wrnjradio.com/', 'https://wrnjradio.com/feed/', 'county', 'warren',
      array['local government','public safety','education'], 76, 720,
      'Northwest New Jersey radio newsroom; the reviewed current local-news byline and news department category qualify.',
      '{"include_author_patterns":["jay edwards"],"include_categories":["news department"],"exclude_categories":["opinion","sponsored"]}'::jsonb),
    ('HudPost', 'https://hudpost.com/', 'https://hudpost.com/feed/', 'county', 'hudson',
      array['local government','public safety','housing'], 78, 720,
      'Hudson County local newsroom; only its reviewed original reporter byline qualifies so syndicated New Jersey Monitor copies do not create false independence.',
      '{"include_author_patterns":["james de los santos"],"include_categories":["news"]}'::jsonb),
    ('Black In Jersey', 'https://www.blackinjersey.com/', 'https://www.blackinjersey.com/feed/', 'state', null,
      array['accountability','community','culture'], 80, 1440,
      'Independent Black-led New Jersey newsroom and NJ Civic Information Consortium grantee; opinion and sponsored material are excluded.',
      '{"exclude_categories":["opinion","sponsored","press release"]}'::jsonb),
    ('Follow South Jersey', 'https://followsouthjersey.com/', 'https://followsouthjersey.com/feed/', 'state', null,
      array['local government','environment','community'], 77, 720,
      'South Jersey civic-news and reporting-pipeline project; entertainment, promotional, opinion, and wellness material is excluded.',
      '{"exclude_categories":["entertainment","what''s good","health & wellness","opinion","sponsored"]}'::jsonb),
    ('Slice of Culture', 'https://www.sliceofculture.com/', 'https://www.sliceofculture.com/feed/', 'county', 'hudson',
      array['local government','politics','community'], 77, 720,
      'Hudson County independent newsroom; only its News + Politics desk qualifies as corroborating evidence.',
      '{"include_categories":["news + politics"]}'::jsonb),
    ('The Montclarion', 'https://themontclarion.org/', 'https://themontclarion.org/feed/', 'county', 'essex',
      array['education','local government','campus'], 68, 1440,
      'Independent Montclair State student newsroom; only the News desk qualifies, with opinion and entertainment excluded.',
      '{"include_categories":["news"]}'::jsonb),
    ('The Rider News', 'https://theridernews.com/', 'https://theridernews.com/feed/', 'county', 'mercer',
      array['education','local government','campus'], 68, 1440,
      'Independent Rider University student newsroom; only the News desk qualifies.',
      '{"include_categories":["news"]}'::jsonb),
    ('The Whit', 'https://thewhitonline.com/', 'https://thewhitonline.com/feed/', 'county', 'gloucester',
      array['education','local government','campus'], 68, 1440,
      'Independent Rowan University student newsroom; only the News desk qualifies.',
      '{"include_categories":["news"]}'::jsonb),
    ('WBGO News - Newark Today', 'https://www.wbgo.org/news', 'https://www.wbgo.org/news.rss', 'county', 'essex',
      array['local government','public affairs','community'], 84, 720,
      'Nonprofit public-media newsroom; only Newark Today section URLs qualify from the broader WBGO News feed.',
      '{"include_url_patterns":["/section/newark-today/"],"exclude_categories":["music","arts","podcasts"]}'::jsonb)
)
insert into public.sources (
  name, source_type, homepage_url, feed_url, ingestion_method, scope,
  county_id, topics, priority, poll_interval_minutes, active, rights_notes,
  editorial_notes, verified_at, adapter_config
)
select
  seed.name, 'journalism', seed.homepage_url, seed.feed_url, 'rss', seed.scope,
  county.id, seed.topics, seed.priority, seed.poll_interval_minutes, true,
  'Store feed metadata and source links only; no article bodies. Preserve publisher attribution and follow the publisher URL for the original report.',
  seed.editorial_notes, '2026-08-27T16:16:04Z'::timestamptz, seed.adapter_config
from seed
left join public.counties as county on county.slug = seed.county_slug;

insert into public.source_assessments (
  source_id, assessment_status, evidence_role, verification_tier,
  corroboration_group_key, methodology_version, rationale, assessed_by, assessed_at
)
select
  source.id, 'reviewed', 'independent_journalism', assessment.verification_tier,
  assessment.corroboration_group_key, 'reath-source-verification-v3',
  assessment.rationale, 'directive:source-expansion-cost-calibration',
  '2026-08-27T16:16:04Z'::timestamptz
from (
  values
    ('Jersey Digs', 2, 'jersey-digs', 'Reviewed specialty newsroom with named reporters and original New Jersey development reporting; commercial feed sections are excluded.'),
    ('The Village Green', 2, 'village-green', 'Reviewed independent local newsroom with named reporters and original Maplewood-South Orange civic reporting; institutional submissions are excluded.'),
    ('MyVeronaNJ', 2, 'myveronanj', 'Reviewed independent Verona newsroom; a byline allowlist isolates its current original reporting from submissions and syndication.'),
    ('WRNJ Radio', 2, 'wrnj', 'Reviewed northwest New Jersey radio newsroom with original local reporting; the current reviewed news-department byline is required.'),
    ('HudPost', 2, 'hudpost', 'Reviewed Hudson County newsroom and civic-information grantee; a byline allowlist prevents syndicated copies from counting independently.'),
    ('Black In Jersey', 2, 'black-in-jersey', 'Reviewed independent Black-led newsroom with original New Jersey reporting and documented civic-information grant support.'),
    ('Follow South Jersey', 2, 'follow-south-jersey', 'Reviewed South Jersey civic-news project with original reporting; non-news and promotional feed sections are excluded.'),
    ('Slice of Culture', 2, 'slice-of-culture', 'Reviewed independent Hudson County newsroom; only its News + Politics reporting desk qualifies.'),
    ('The Montclarion', 2, 'montclarion', 'Reviewed independent student newsroom at Montclair State; only reported News-desk material qualifies.'),
    ('The Rider News', 2, 'rider-news', 'Reviewed independent student newsroom at Rider University; only reported News-desk material qualifies.'),
    ('The Whit', 2, 'whit-rowan', 'Reviewed independent student newsroom at Rowan University; only reported News-desk material qualifies.'),
    ('WBGO News - Newark Today', 3, 'newark-public-radio', 'Reviewed nonprofit public-media newsroom; the adapter admits only Newark Today public-affairs reporting from its broad feed.')
) as assessment(source_name, verification_tier, corroboration_group_key, rationale)
join public.sources as source on source.name = assessment.source_name;

do $$
declare
  added_sources integer;
  added_assessments integer;
  disabled_sources integer;
begin
  select count(*)::integer into added_sources
  from public.sources
  where name in (
    'Jersey Digs','The Village Green','MyVeronaNJ','WRNJ Radio','HudPost','Black In Jersey',
    'Follow South Jersey','Slice of Culture','The Montclarion','The Rider News','The Whit','WBGO News - Newark Today'
  );
  if added_sources <> 12 then
    raise exception 'Expected 12 additional reviewed Sources, found %', added_sources;
  end if;

  select count(*)::integer into added_assessments
  from public.source_assessments as assessment
  join public.sources as source on source.id = assessment.source_id
  where source.name in (
    'Jersey Digs','The Village Green','MyVeronaNJ','WRNJ Radio','HudPost','Black In Jersey',
    'Follow South Jersey','Slice of Culture','The Montclarion','The Rider News','The Whit','WBGO News - Newark Today'
  )
    and assessment.superseded_at is null
    and assessment.assessment_status = 'reviewed'
    and assessment.evidence_role = 'independent_journalism'
    and assessment.verification_tier >= 2;
  if added_assessments <> 12 then
    raise exception 'Expected 12 current qualifying assessments, found %', added_assessments;
  end if;

  update public.sources
  set active = false,
      last_error_at = now(),
      last_error = 'Disabled after nine consecutive production HTTP 403 responses; no items were ingested. Re-enable only after a Netlify-reachable feed is verified.',
      editorial_notes = 'Journalistic assessment remains reviewed, but the publisher feed is operationally disabled after repeated production HTTP 403 responses to avoid wasteful polling.',
      verified_at = '2026-08-27T16:16:04Z'::timestamptz,
      updated_at = now()
  where name = 'Star News Group'
    and active = true;
  get diagnostics disabled_sources = row_count;
  if disabled_sources <> 1 then
    raise exception 'Expected to disable one repeatedly blocked Star News Group feed, updated %', disabled_sources;
  end if;
end;
$$;

commit;
