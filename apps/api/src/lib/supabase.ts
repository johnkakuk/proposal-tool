import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../env.js";

/**
 * Service-role client. Bypasses RLS, so only use it after the Worker has done its
 * own validation (public, tracking, signing endpoints, and the service layer).
 */
export function serviceClient(env: Env): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
