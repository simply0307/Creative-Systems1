-- Remove the accidental RPC column if it still exists.
alter table public.comments drop column if exists "RPC";

-- Remove older one-way increment functions so the app uses the authenticated toggle only.
drop function if exists public.increment_comment_resonance(uuid);
drop function if exists public.increment_comment_resonance(bigint);

-- One row means one authenticated account currently resonates with one comment.
create table if not exists public.comment_resonance_votes (
  comment_id bigint not null references public.comments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);

create index if not exists comment_resonance_votes_user_id_idx
  on public.comment_resonance_votes(user_id);

alter table public.comment_resonance_votes enable row level security;

-- Everyone may read vote rows so the UI can determine whether the current user liked a comment.
-- Writes are restricted to the signed-in user's own row.
drop policy if exists "resonance votes are readable" on public.comment_resonance_votes;
create policy "resonance votes are readable"
on public.comment_resonance_votes
for select
to anon, authenticated
using (true);

drop policy if exists "users insert their own resonance vote" on public.comment_resonance_votes;
create policy "users insert their own resonance vote"
on public.comment_resonance_votes
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "users delete their own resonance vote" on public.comment_resonance_votes;
create policy "users delete their own resonance vote"
on public.comment_resonance_votes
for delete
to authenticated
using (auth.uid() = user_id);

-- Authenticated toggle: first call likes, second call unlikes.
create or replace function public.toggle_comment_resonance(
  p_comment_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_inserted integer;
  v_resonance bigint;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  -- Lock the comment row so simultaneous toggles update the counter safely.
  perform 1
  from public.comments
  where id = p_comment_id
  for update;

  if not found then
    raise exception 'Comment not found';
  end if;

  insert into public.comment_resonance_votes (comment_id, user_id)
  values (p_comment_id, v_user_id)
  on conflict do nothing;

  get diagnostics v_inserted = row_count;

  if v_inserted = 1 then
    update public.comments
    set resonance = resonance + 1
    where id = p_comment_id
    returning resonance into v_resonance;

    return jsonb_build_object(
      'liked', true,
      'resonance', v_resonance
    );
  end if;

  delete from public.comment_resonance_votes
  where comment_id = p_comment_id
    and user_id = v_user_id;

  update public.comments
  set resonance = greatest(resonance - 1, 0)
  where id = p_comment_id
  returning resonance into v_resonance;

  return jsonb_build_object(
    'liked', false,
    'resonance', v_resonance
  );
end;
$$;

revoke all on function public.toggle_comment_resonance(bigint) from public;
grant execute on function public.toggle_comment_resonance(bigint) to authenticated;
