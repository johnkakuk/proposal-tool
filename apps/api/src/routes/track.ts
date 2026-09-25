import { MAX_TRACK_BYTES, TrackEventsSchema, TrackSessionSchema } from "@bridger/shared";
import { requestGeo } from "../lib/geo.js";
import { Hono, type Context } from "hono";
import type { AppEnv } from "../env.js";
import { ApiError } from "../lib/errors.js";
import { rateLimit } from "../lib/rateLimit.js";
import { serviceClient } from "../lib/supabase.js";
import { parseOr422 } from "../lib/validate.js";
import { ingestEvents, startSession } from "../services/tracking.js";

/**
 * Tracking ingest (SPEC §11.2) at /t/*. Bodies are capped at 64 KB and may arrive via
 * navigator.sendBeacon (text/plain), so JSON is parsed from the raw text.
 */
async function json(c: Context<AppEnv>): Promise<unknown> {
  const text = await c.req.text();
  if (text.length > MAX_TRACK_BYTES) throw new ApiError(413, "too_large", "Payload too large");
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(400, "invalid_json", "Invalid JSON");
  }
}

const scale = (c: Context<AppEnv>) => Number(c.env.RATE_LIMIT_SCALE ?? 1) || 1;
const ip = (c: Context<AppEnv>) => c.req.header("CF-Connecting-IP") ?? "127.0.0.1";

export const track = new Hono<AppEnv>()
  .use(async (c, next) => {
    const len = Number(c.req.header("Content-Length") ?? 0);
    if (len > MAX_TRACK_BYTES) throw new ApiError(413, "too_large", "Payload too large");
    await next();
    c.header("Cache-Control", "no-store");
  })
  .post("/session", async (c) => {
    await rateLimit(c.env.RATE_KV, `ts:${ip(c)}`, 60, 3600, scale(c));
    const input = parseOr422(TrackSessionSchema, await json(c));
    const { result, background } = await startSession(c.env, serviceClient(c.env), input, {
      ip: ip(c),
      userAgent: c.req.header("User-Agent"),
      cookie: c.req.header("Cookie"),
      geo: requestGeo(c.req.raw),
    });
    if (background) c.executionCtx.waitUntil(background);
    return c.json(result);
  })
  .post("/events", async (c) => {
    const input = parseOr422(TrackEventsSchema, await json(c));
    // Flushes every 5 s → ~120 per 10 min; allow headroom, per session and per IP.
    await rateLimit(c.env.RATE_KV, `te:${input.sessionId}`, 200, 600, scale(c));
    await rateLimit(c.env.RATE_KV, `tei:${ip(c)}`, 1000, 600, scale(c));
    const { background } = await ingestEvents(c.env, serviceClient(c.env), input);
    if (background) c.executionCtx.waitUntil(background);
    return c.body(null, 204);
  });
