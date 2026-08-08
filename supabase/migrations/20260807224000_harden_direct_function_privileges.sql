-- The comments surface intentionally uses Supabase Auth directly. Its toggle must
-- remain SECURITY DEFINER because authenticated users have no direct write grants
-- on comments or comment_resonance_votes. The function binds every mutation to
-- auth.uid(); anonymous callers must not be able to invoke it.
alter function public.toggle_comment_resonance(bigint)
  security definer
  set search_path = '';

revoke all on function public.toggle_comment_resonance(bigint) from public;
revoke execute on function public.toggle_comment_resonance(bigint) from anon;
grant execute on function public.toggle_comment_resonance(bigint) to authenticated;

-- Trigger functions do not need direct browser execution. Pin the lookup path and
-- remove exposed-role execution without changing any trigger or row behavior.
alter function public.set_updated_at()
  security invoker
  set search_path = '';

revoke all on function public.set_updated_at() from public;
revoke execute on function public.set_updated_at() from anon, authenticated;
