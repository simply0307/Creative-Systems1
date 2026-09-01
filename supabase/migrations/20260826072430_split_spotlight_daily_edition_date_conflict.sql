begin;

-- Activation calibration identified two date-titled daily editions that the
-- first deterministic scorer grouped because their remaining title tokens are
-- identical. Preserve both evidence records and the original decision trail,
-- but give the August 25 edition its own Story. The source item is then placed
-- in the durable recovery backlog so the normal worker rebuilds geography,
-- deterministic enrichment, scoring, and editorial-queue state.
do $$
declare
  conflicted record;
  separated_story public.stories;
  correction_reason constant text := 'Activation calibration split same-source daily editions with conflicting explicit headline dates.';
begin
  select
    links.story_id,
    items.id as source_item_id,
    items.headline,
    coalesce(items.published_at, items.discovered_at) as first_seen_at,
    sources.scope
  into conflicted
  from public.story_sources as links
  join public.stories as stories on stories.id = links.story_id
  join public.source_items as items on items.id = links.source_item_id
  join public.sources as sources on sources.id = items.source_id
  where links.detached_at is null
    and sources.name = 'NJ Spotlight News'
    and stories.canonical_title = 'NJ Spotlight News: August 24, 2026'
    and items.headline = 'NJ Spotlight News: August 25, 2026'
  order by links.attached_at
  limit 1;

  if conflicted.source_item_id is null then
    return;
  end if;

  perform public.detach_story_source(
    conflicted.story_id,
    conflicted.source_item_id,
    'activation-calibration',
    null,
    'admin',
    correction_reason
  );

  insert into public.stories (
    canonical_title, first_seen_at, last_activity_at, scope, confidence
  ) values (
    conflicted.headline,
    conflicted.first_seen_at,
    conflicted.first_seen_at,
    conflicted.scope,
    0.6
  ) returning * into separated_story;

  insert into public.story_sources (
    story_id, source_item_id, link_method, confidence, signals, attached_by
  ) values (
    separated_story.id,
    conflicted.source_item_id,
    'editor_attach',
    1,
    jsonb_build_object('reason', 'conflicting_headline_dates', 'calibration', true),
    'activation-calibration'
  );

  insert into public.editorial_queue (story_id)
  values (separated_story.id)
  on conflict (story_id) do nothing;

  insert into public.editorial_decisions (
    story_id, actor_id, actor_email, actor_role, action_type, from_value, to_value, reason
  ) values (
    separated_story.id,
    'activation-calibration',
    null,
    'admin',
    'attach',
    '{}'::jsonb,
    jsonb_build_object('source_item_id', conflicted.source_item_id, 'attached', true),
    correction_reason
  );

  update public.source_items
  set processing_status = 'error',
      processing_error = 'Activation calibration requires deterministic refresh after Story separation',
      processing_token = null,
      processing_started_at = null
  where id = conflicted.source_item_id;
end;
$$;

commit;
