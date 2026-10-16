import { createClient } from "@supabase/supabase-js";

/**
 * The browser's Supabase client. It signs in with GitHub (PKCE) and keeps the
 * session; it reads office data under row-level security. It never writes:
 * actions go to the Control API.
 */
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  { auth: { flowType: "pkce", detectSessionInUrl: true, persistSession: true } },
);
