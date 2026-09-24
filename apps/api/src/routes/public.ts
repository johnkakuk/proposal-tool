import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env.js";
import { rateLimit } from "../lib/rateLimit.js";
import { serviceClient } from "../lib/supabase.js";
import { body } from "../lib/validate.js";
import { getPublicMeta, getPublicProposal, requestExtension } from "../services/public.js";

/** Client-facing endpoints (SPEC §8). No auth; access is by unguessable slug. */
export const publicRoutes = new Hono<AppEnv>()
  .use(async (c, next) => {
    await next();
    c.header("Cache-Control", "no-store");
    c.header("X-Robots-Tag", "noindex, nofollow");
    c.header("Referrer-Policy", "same-origin");
  })
  .get("/proposals/:slug", async (c) => c.json(await getPublicProposal(serviceClient(c.env), c.req.param("slug"), c.env.OWNER_EMAIL)))
  .get("/proposals/:slug/meta", async (c) => c.json(await getPublicMeta(serviceClient(c.env), c.req.param("slug"))))
  .post("/proposals/:slug/extension-request", async (c) => {
    const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
    await rateLimit(c.env.RATE_KV, `ext:${ip}`, 5, 3600);
    const input = await body(c, z.object({ message: z.string().max(1000).optional() }));
    await requestExtension(serviceClient(c.env), c.req.param("slug"), { ip, userAgent: c.req.header("User-Agent"), message: input.message });
    return c.json({ ok: true });
  });
