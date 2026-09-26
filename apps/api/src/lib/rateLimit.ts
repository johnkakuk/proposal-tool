import { ApiError } from "./errors.js";

/**
 * Rate limiting with Cloudflare's Workers Rate Limiting binding (`ratelimits` in
 * wrangler.jsonc). No KV reads or writes, so it costs nothing against KV's free-tier
 * write quota. Each binding is one policy (limit per 10 or 60 s); the key (e.g.
 * `sign:<ip>`) picks the counter. The binding is per Cloudflare location and eventually
 * consistent: fine for stopping abuse, not an exact quota.
 *
 * It fails open. If the binding is missing or throws, the request is allowed and the
 * problem is logged: rate limiting must never be the reason a client can't verify an
 * email, sign, or decline. `RATE_LIMIT_OFF=1` (local dev and tests, which all share one
 * IP) skips it; production never sets it.
 */
export type Limiter = Pick<RateLimit, "limit">;

export async function rateLimit(limiter: Limiter | undefined, key: string, opts: { off?: string } = {}): Promise<void> {
  if (opts.off === "1" || opts.off === "true") return;
  let allowed = true;
  try {
    if (!limiter) throw new Error("rate limit binding missing");
    allowed = (await limiter.limit({ key })).success;
  } catch (err) {
    console.error(`rate limiter unavailable for ${key.split(":")[0]}; allowing the request`, err instanceof Error ? err.message : err);
    return;
  }
  if (!allowed) throw new ApiError(429, "rate_limited", "Too many requests. Please wait a minute and try again.");
}
