import { ApiError } from "./errors.js";

/**
 * Fixed-window counter in KV (SPEC §2: RATE_KV). KV isn't atomic, so this is a
 * best-effort limit: good enough to stop abuse on the free tier, not an exact quota.
 * `scale` multiplies limits (RATE_LIMIT_SCALE); local dev raises it because every test
 * run shares one IP. Production leaves it at 1.
 */
export async function rateLimit(kv: KVNamespace, key: string, limit: number, windowSeconds: number, scale = 1): Promise<void> {
  limit = Math.max(1, Math.round(limit * scale));
  const window = Math.floor(Date.now() / 1000 / windowSeconds);
  const k = `rl:${key}:${window}`;
  const count = Number((await kv.get(k)) ?? 0);
  if (count >= limit) throw new ApiError(429, "rate_limited", "Too many requests. Please try again later.");
  // KV requires a TTL of at least 60 seconds.
  await kv.put(k, String(count + 1), { expirationTtl: Math.max(60, windowSeconds * 2) });
}
