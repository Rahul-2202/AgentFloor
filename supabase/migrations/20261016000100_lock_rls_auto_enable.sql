-- Supabase's own event trigger function (it turns RLS on for new tables) is
-- exposed over the API by default. Nobody needs to call it.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
