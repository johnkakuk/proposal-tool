import { createMiddleware } from "hono/factory";
import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify, type JWTPayload } from "jose";
import type { AppEnv, AuthVariables } from "../env.js";
import { resolveApiKey } from "../lib/apiKeys.js";
import { ApiError } from "../lib/errors.js";
import { serviceClient } from "../lib/supabase.js";

/**
 * Authenticates /api/v1 callers (SPEC §3):
 *  - John's Supabase access token (ES256/RS256 via JWKS, or legacy HS256)
 *  - a static API key (`bdp_…`) for Claude Code, scripts, Zapier
 *  - an OAuth access token issued to an AI client (Claude.ai, ChatGPT connectors)
 * Public signups are disabled, so any valid Supabase user is the owner.
 */

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function jwks(supabaseUrl: string) {
  let set = jwksCache.get(supabaseUrl);
  if (!set) {
    set = createRemoteJWKSet(new URL("/auth/v1/.well-known/jwks.json", supabaseUrl));
    jwksCache.set(supabaseUrl, set);
  }
  return set;
}

export async function verifySupabaseJwt(token: string, env: { SUPABASE_URL: string; SUPABASE_JWT_SECRET: string }): Promise<JWTPayload> {
  const { alg } = decodeProtectedHeader(token);
  const opts = { audience: "authenticated" };
  const { payload } =
    alg === "HS256"
      ? await jwtVerify(token, new TextEncoder().encode(env.SUPABASE_JWT_SECRET), { ...opts, algorithms: ["HS256"] })
      : await jwtVerify(token, jwks(env.SUPABASE_URL), { ...opts, algorithms: ["ES256", "RS256", "EdDSA"] });
  return payload;
}

/** Props stored with an OAuth grant (set on the consent screen). */
export interface OAuthGrantProps {
  ownerId: string;
  clientName: string;
}

const looksLikeJwt = (t: string) => /^[\w-]+\.[\w-]+\.[\w-]+$/.test(t);

export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const token = /^Bearer\s+(.+)$/i.exec(c.req.header("Authorization") ?? "")?.[1]?.trim();
  if (!token) throw new ApiError(401, "unauthorized", "Sign in required");

  let who: AuthVariables | null = null;
  if (token.startsWith("bdp_")) {
    const key = await resolveApiKey(serviceClient(c.env), token);
    if (key) who = { ownerId: key.ownerId, actor: `ai:${key.name}`, principal: "api_key", createdVia: "api", clientName: key.name };
  } else if (looksLikeJwt(token)) {
    try {
      const payload = await verifySupabaseJwt(token, c.env);
      if (payload.role === "authenticated" && typeof payload.sub === "string") who = { ownerId: payload.sub, actor: "owner", principal: "owner", createdVia: "manual" };
    } catch {
      /* fall through to 401 */
    }
  } else if (c.env.OAUTH_PROVIDER) {
    const summary = await c.env.OAUTH_PROVIDER.unwrapToken<OAuthGrantProps>(token).catch(() => null);
    if (summary && summary.expiresAt * 1000 > Date.now()) {
      const { ownerId, clientName } = summary.grant.props;
      who = { ownerId, actor: `ai:${clientName}`, principal: "oauth", createdVia: "api", clientName };
    }
  }
  if (!who) throw new ApiError(401, "unauthorized", "Your session has expired or the key is invalid.");
  for (const [k, v] of Object.entries(who)) c.set(k as keyof AuthVariables, v as never);
  await next();
});

/** Only John himself (not an API key or AI client) may manage credentials and connections. */
export const requireHuman = createMiddleware<AppEnv>(async (c, next) => {
  if (c.get("principal") !== "owner") throw new ApiError(403, "forbidden", "Only the account owner can do this, from the app.");
  await next();
});
