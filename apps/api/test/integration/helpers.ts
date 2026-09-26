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
    OAUTH_KV: memoryKv(),
    RL_PUBLIC: limiter("allow"),
    RL_TRACK_EVENTS: limiter("allow"),
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

/** Stand-ins for a Workers Rate Limiting binding: always allow, always deny, or broken. */
export function limiter(mode: "allow" | "deny" | "throw") {
  return {
    limit: async (_: { key: string }) => {
      if (mode === "throw") throw new Error("rate limiter exploded");
      return { success: mode === "allow" };
    },
  };
}

/** In-memory stand-in for a KV namespace (the OAuth provider and PDF retry counts). */
export function memoryKv() {
  const m = new Map<string, { value: string; expires?: number }>();
  const live = (k: string) => {
    const e = m.get(k);
    if (e?.expires && e.expires < Date.now()) m.delete(k);
    return m.get(k);
  };
  return {
    get: async (k: string, opts?: string | { type?: string }) => {
      const e = live(k);
      if (!e) return null;
      const type = typeof opts === "string" ? opts : opts?.type;
      return type === "json" ? JSON.parse(e.value) : e.value;
    },
    put: async (k: string, v: string, opts?: { expirationTtl?: number }) => void m.set(k, { value: v, expires: opts?.expirationTtl ? Date.now() + opts.expirationTtl * 1000 : undefined }),
    delete: async (k: string) => void m.delete(k),
    list: async (opts: { prefix?: string; limit?: number; cursor?: string } = {}) => {
      const keys = [...m.keys()].filter((k) => live(k) && k.startsWith(opts.prefix ?? "")).sort();
      const start = opts.cursor ? Number(opts.cursor) : 0;
      const page = keys.slice(start, start + (opts.limit ?? 1000));
      const done = start + page.length >= keys.length;
      return { keys: page.map((name) => ({ name })), list_complete: done, cursor: done ? undefined : String(start + page.length) };
    },
  };
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

export const REAL_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";

/** Calls the tracking ingest (/t/*) like the viewer's tracker would. */
export async function trackApi<T = unknown>(path: string, json: unknown, headers: Record<string, string> = {}, e: Env = env()): Promise<{ status: number; body: T; headers: Headers }> {
  const res = await createApp().request(
    `/t${path}`,
    { method: "POST", headers: { "Content-Type": "application/json", "User-Agent": REAL_UA, "CF-Connecting-IP": "198.51.100.7", ...headers }, body: typeof json === "string" ? json : JSON.stringify(json) },
    e,
    executionCtx,
  );
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as T, headers: res.headers };
}
