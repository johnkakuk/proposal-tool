import type { AuditActor } from "@bridger/shared";

/** Worker bindings and secrets (SPEC §2). Secrets are set with `wrangler secret put`. */
export interface Env {
  // Secrets
  SUPABASE_URL: string;
  /** Never leaves the Worker. */
  SUPABASE_SERVICE_ROLE_KEY: string;
  SUPABASE_JWT_SECRET: string;
  RESEND_API_KEY: string;
  TRACKING_SALT: string;
  /** Signs short-lived render tokens (PDF print view) and preview links. */
  SIGNING_SECRET: string;
  // Vars
  APP_URL: string;
  OWNER_EMAIL: string;
  /** "Name <address>" used as the From header. */
  EMAIL_FROM: string;
  /** resend (production) | mailpit (local dev: Supabase's bundled Mailpit) | memory (tests). */
  EMAIL_TRANSPORT?: "resend" | "mailpit" | "memory";
  MAILPIT_URL?: string;
  // Bindings
  BROWSER: Fetcher;
  // KV
  OAUTH_KV: KVNamespace;
  RATE_KV: KVNamespace;
}

export const REQUIRED_SECRETS = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_JWT_SECRET",
  "RESEND_API_KEY",
  "TRACKING_SALT",
  "SIGNING_SECRET",
] as const satisfies readonly (keyof Env)[];

/** Set by auth middleware on authenticated routes. */
export interface AuthVariables {
  ownerId: string;
  actor: AuditActor;
}

export type AppEnv = { Bindings: Env; Variables: AuthVariables };
