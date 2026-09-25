import type { AuditActor, CreatedVia } from "@bridger/shared";
import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

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
  /** Multiplies public rate limits. Unset (1) in production; raised in local dev. */
  RATE_LIMIT_SCALE?: string;
  // Bindings
  BROWSER: Fetcher;
  // KV
  OAUTH_KV: KVNamespace;
  /** Set by the OAuth provider wrapper (src/index.ts); absent in unit tests. */
  OAUTH_PROVIDER?: OAuthHelpers;
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

/** Who is calling: John (Supabase session), an API key, or an OAuth-connected AI client. */
export type Principal = "owner" | "api_key" | "oauth";

/** Set by auth middleware on authenticated routes. */
export interface AuthVariables {
  ownerId: string;
  actor: AuditActor;
  principal: Principal;
  /** How proposals created by this caller are attributed. */
  createdVia: Exclude<CreatedVia, "template">;
  /** e.g. "Claude", "ChatGPT", or the API key's name. */
  clientName?: string;
}

export type AppEnv = { Bindings: Env; Variables: AuthVariables };
