import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabaseConfigured = Boolean(url && anonKey);

/**
 * Browser client: anon key + the owner's JWT, restricted by RLS. Used for reads and for
 * plain CRUD on clients/templates/settings. Proposal writes go through the Worker (/api).
 * The service-role key never exists in the browser.
 */
export const supabase = createClient(url ?? "http://localhost:54321", anonKey ?? "missing-anon-key", {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
