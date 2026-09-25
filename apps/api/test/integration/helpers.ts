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
    RATE_KV: memoryKv(),
    SIGNING_SECRET: "integration-signing-secret",
    EMAIL_FROM: "Bridger Digital <proposals@bridger.test>",
    EMAIL_TRANSPORT: "memory",
  } as unknown as Env;
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

/** Minimal in-memory stand-in for a KV namespace (get/put only). */
export function memoryKv() {
  const m = new Map<string, string>();
  return { get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => void m.set(k, v) };
}

/** Calls a public (unauthenticated) endpoint. */
export async function publicApi<T = unknown>(method: string, path: string, json?: unknown, e: Env = env()): Promise<{ status: number; body: T; headers: Headers }> {
  const res = await createApp().request(
    `/api/public${path}`,
    { method, headers: json === undefined ? {} : { "Content-Type": "application/json" }, body: json === undefined ? undefined : JSON.stringify(json) },
    e,
    executionCtx,
  );
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as T, headers: res.headers };
}

/** Collects waitUntil() work so tests can await or ignore it (no PDF rendering in unit/integration tests). */
export const background: Promise<unknown>[] = [];
export const executionCtx = { waitUntil: (p: Promise<unknown>) => void background.push(p.catch(() => {})), passThroughOnException() {}, props: {} } as unknown as ExecutionContext;
