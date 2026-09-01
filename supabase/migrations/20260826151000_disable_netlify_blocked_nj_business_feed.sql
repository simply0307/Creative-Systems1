begin;

do $$
declare
  affected_rows integer;
  operational_note constant text :=
    'Inactive after the official NJB News Now RSS route returned HTTP 403 from the production Netlify worker on 2026-08-26. Re-enable only after publisher-approved production access and a successful parser validation.';
begin
  update public.sources
  set
    active = false,
    editorial_notes = case
      when position(operational_note in editorial_notes) > 0 then editorial_notes
      else concat_ws(E'\n', nullif(btrim(editorial_notes), ''), operational_note)
    end,
    updated_at = now()
  where name = 'New Jersey Business Magazine'
    and feed_url = 'https://njbmagazine.com/feed/?post_type=njb_news_now';

  get diagnostics affected_rows = row_count;
  if affected_rows <> 1 then
    raise exception 'Expected exactly one New Jersey Business Magazine source, updated %', affected_rows;
  end if;
end
$$;

commit;
