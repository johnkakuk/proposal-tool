import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite, type Transaction } from "@electric-sql/pglite";

/**
 * Runs the real migrations against in-process Postgres (PGlite), on top of a
 * minimal shim of what Supabase provides: the anon/authenticated/service_role
 * roles, auth.users + auth.uid(), and storage.buckets/objects.
 * This lets CI verify triggers and RLS without Docker. `supabase db reset`
 * against the real stack remains the final check.
 */

const MIGRATIONS_DIR = fileURLToPath(new URL("../migrations/", import.meta.url));

const SUPABASE_SHIM = /* sql */ `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
  -- Supabase grants everything on new public tables to these roles; RLS and revokes narrow it.
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

  create schema auth;
  grant usage on schema auth to anon, authenticated, service_role;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid
  $$;

  create schema storage;
  grant usage on schema storage to anon, authenticated, service_role;
  create table storage.buckets (
    id text primary key, name text not null, public boolean default false,
    file_size_limit bigint, allowed_mime_types text[]
  );
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language sql immutable as $$
    select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
  $$;
`;

export function migrationFiles(): { name: string; sql: string }[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((name) => ({ name, sql: readFileSync(MIGRATIONS_DIR + name, "utf8") }));
}

export async function freshDb(): Promise<PGlite> {
  const db = await PGlite.create();
  await db.exec(SUPABASE_SHIM);
  for (const m of migrationFiles()) {
    try {
      await db.exec(m.sql);
    } catch (e) {
      throw new Error(`Migration ${m.name} failed: ${(e as Error).message}`);
    }
  }
  return db;
}

type Role = "anon" | "authenticated" | "service_role";

/** Runs `fn` as a Supabase client role, with `userId` as the JWT subject. Rolled back afterwards. */
export async function asRole<T>(db: PGlite, role: Role, userId: string | null, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  let result!: T;
  let error: unknown;
  await db
    .transaction(async (tx) => {
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(userId ? { sub: userId, role } : { role })]);
      await tx.exec(`set local role ${role}`);
      try {
        result = await fn(tx);
      } catch (e) {
        error = e;
      }
      await tx.rollback();
    })
    .catch(() => {});
  if (error) throw error;
  return result;
}

export async function createUser(db: PGlite, email: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(`insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id`, [email]);
  return rows[0]!.id;
}

let slugCounter = 0;
export const testSlug = () => `test_slug_${String(++slugCounter).padStart(11, "0")}`;
