import { createClient } from "@supabase/supabase-js";
import { inject } from "vitest";
import { createApp } from "../../src/app.js";
import type { Env } from "../../src/env.js";

export const sb = () => inject("supabase");

export function env(): Env {
  const s = sb();
  return {
    SUPABASE_URL: s.url,
    SUPABASE_SERVICE_ROLE_KEY: s.serviceRoleKey,
    SUPABASE_JWT_SECRET: s.jwtSecret,
    RESEND_API_KEY: "re_test",
    TRACKING_SALT: "salt",
    APP_URL: "http://localhost:5173",
    OWNER_EMAIL: "owner@bridger.local",
  } as Env;
}

export async function ownerToken(): Promise<string> {
  const s = sb();
  const client = createClient(s.url, s.anonKey, { auth: { persistSession: false } });
  const { data, error } = await client.auth.signInWithPassword({ email: "owner@bridger.local", password: "bridger-dev-password" });
  if (error || !data.session) throw new Error(`Owner login failed: ${error?.message}`);
  return data.session.access_token;
}

export const adminDb = () => createClient(sb().url, sb().serviceRoleKey, { auth: { persistSession: false } });

/** Calls the Worker app in-process with the owner's token. */
export function api(token: string | null) {
  const app = createApp();
  return async <T = unknown>(method: string, path: string, json?: unknown): Promise<{ status: number; body: T }> => {
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (json !== undefined) headers["Content-Type"] = "application/json";
    const res = await app.request(`/api/v1${path}`, { method, headers, body: json === undefined ? undefined : JSON.stringify(json) }, env());
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
  };
}
