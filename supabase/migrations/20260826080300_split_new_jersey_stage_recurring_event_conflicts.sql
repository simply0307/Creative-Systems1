begin;

-- Production calibration found three same-source New Jersey Stage attachments
-- where a recurring template outweighed the actual edition/event identity:
-- two adjacent weekly date ranges and two different performers at one venue.
-- Preserve the original links as detached audit evidence, create one Story per
-- real event/edition, and queue both sides for the normal deterministic refresh.
do $$
declare
  target record;
  conflicted record;
  separated_story public.stories;
  retained_source_item_id uuid;
  correction_reason text;
begin
  for target in
    select *
    from (values
      (
        'New Jersey Stage',
        'Events This Week in New Jersey from August 25-31, 2026',
        'Events This Week in New Jersey from August 18-24, 2026',
        'conflicting_headline_dates',
        'Activation calibration split same-source weekly editions with disjoint explicit date ranges.'
      ),
      (
        'New Jersey Stage',
        'This Week in Music: Previews for Concerts from August 25-31, 2026',
        'This Week in Music: Previews for Concerts from August 18-24, 2026',
        'conflicting_headline_dates',
        'Activation calibration split same-source weekly music editions with disjoint explicit date ranges.'
      ),
      (
        'New Jersey Stage',
        'Todd Rundgren LIVE! at Ocean City Music Pier',
        'The Outlaws LIVE! at Ocean City Music Pier',
        'conflicting_live_venue_subjects',
        'Activation calibration split different performers sharing a same-source venue headline template.'
      )
    ) as repairs(source_name, story_title, item_headline, reason_code, reason)
  loop
    conflicted := null;
    retained_source_item_id := null;
    correction_reason := target.reason;

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
      and sources.name = target.source_name
      and stories.canonical_title = target.story_title
      and items.headline = target.item_headline
    order by links.attached_at
    limit 1;

    if conflicted.source_item_id is null then
      continue;
    end if;

    perform public.detach_story_source(
      conflicted.story_id,
      conflicted.source_item_id,
      'activation-calibration',
      null,
      'admin',
      correction_reason
    );

    select links.source_item_id
    into retained_source_item_id
    from public.story_sources as links
    where links.story_id = conflicted.story_id
      and links.detached_at is null
    order by links.attached_at
    limit 1;

    update public.stories as stories
    set first_seen_at = activity.first_seen_at,
        last_activity_at = activity.last_activity_at
    from (
      select
        min(coalesce(items.published_at, items.discovered_at)) as first_seen_at,
        max(coalesce(items.published_at, items.discovered_at)) as last_activity_at
      from public.story_sources as links
      join public.source_items as items on items.id = links.source_item_id
      where links.story_id = conflicted.story_id
        and links.detached_at is null
    ) as activity
    where stories.id = conflicted.story_id
      and activity.first_seen_at is not null;

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
      jsonb_build_object('reason', target.reason_code, 'calibration', true),
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
    where id in (conflicted.source_item_id, retained_source_item_id);
  end loop;
end;
$$;

commit;
