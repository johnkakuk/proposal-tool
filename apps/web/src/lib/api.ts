import { supabase } from "./supabase";

/** Calls the Worker on the same origin, attaching the owner's Supabase JWT. */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const headers = new Headers(init.headers);
  if (data.session) headers.set("Authorization", `Bearer ${data.session.access_token}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const res = await fetch(path, { ...init, headers });
  const body = (await res.json().catch(() => null)) as T | { error?: { message?: string } } | null;
  if (!res.ok) {
    const message = (body as { error?: { message?: string } } | null)?.error?.message ?? `Request failed (${res.status})`;
    throw new Error(message);
  }
  return body as T;
}
