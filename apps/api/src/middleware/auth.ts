import { createMiddleware } from "hono/factory";
import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify, type JWTPayload } from "jose";
import type { AppEnv } from "../env.js";
import { ApiError } from "../lib/errors.js";

/**
 * Verifies the owner's Supabase access token (Authorization: Bearer <jwt>).
 * Supabase signs with asymmetric keys (ES256/RS256, published as JWKS) on current
 * projects, and HS256 with the JWT secret on legacy ones; both are accepted.
 * Public signups are disabled, so any valid authenticated user is the owner.
 * Phase 7 adds API keys and OAuth tokens here.
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

export const requireOwner = createMiddleware<AppEnv>(async (c, next) => {
  const header = c.req.header("Authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) throw new ApiError(401, "unauthorized", "Sign in required");
  let payload: JWTPayload;
  try {
    payload = await verifySupabaseJwt(match[1]!, c.env);
  } catch {
    throw new ApiError(401, "unauthorized", "Your session has expired. Sign in again.");
  }
  if (payload.role !== "authenticated" || typeof payload.sub !== "string") throw new ApiError(401, "unauthorized", "Sign in required");
  c.set("ownerId", payload.sub);
  c.set("actor", "owner");
  await next();
});
