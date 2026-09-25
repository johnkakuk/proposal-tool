import { DeclineSchema, OtpRequestSchema, OtpVerifySchema, SignRequestSchema } from "@bridger/shared";
import { Hono, type Context } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env.js";
import { rateLimit } from "../lib/rateLimit.js";
import { verifyRenderToken } from "../lib/renderToken.js";
import { serviceClient } from "../lib/supabase.js";
import { body } from "../lib/validate.js";
import { afterSigning } from "../services/afterSigning.js";
import { onDeclined, onExtensionRequested } from "../services/notify.js";
import { sendOtp, verifyOtp } from "../services/otp.js";
import { getPublicCertificate, getPublicMeta, getPublicProposal, loadPublicRow, loadSignature, requestExtension } from "../services/public.js";
import { declineProposal, signProposal } from "../services/signing.js";
import { getPreview } from "../services/preview.js";

const scale = (c: Context<AppEnv>) => Number(c.env.RATE_LIMIT_SCALE ?? 1) || 1;
const ip = (c: Context<AppEnv>) => c.req.header("CF-Connecting-IP") ?? "unknown";
const meta = (c: Context<AppEnv>) => {
  const cf = (c.req.raw as { cf?: { country?: string; region?: string; city?: string } }).cf;
  return {
    ip: c.req.header("CF-Connecting-IP"),
    userAgent: c.req.header("User-Agent"),
    geo: cf ? { country: cf.country, region: cf.region, city: cf.city } : undefined,
  };
};

/** Client-facing endpoints (SPEC §8). No auth; access is by unguessable slug. */
export const publicRoutes = new Hono<AppEnv>()
  .use(async (c, next) => {
    await next();
    c.header("Cache-Control", "no-store");
    c.header("X-Robots-Tag", "noindex, nofollow");
    c.header("Referrer-Policy", "same-origin");
  })
  // Signed 1-hour draft preview (SPEC §10.2 get_preview_url); never tracked
  .get("/preview/:token", async (c) => c.json(await getPreview(c.env, serviceClient(c.env), c.req.param("token"))))
  .get("/proposals/:slug", async (c) => c.json(await getPublicProposal(serviceClient(c.env), c.req.param("slug"), c.env.OWNER_EMAIL)))
  .get("/proposals/:slug/meta", async (c) => c.json(await getPublicMeta(serviceClient(c.env), c.req.param("slug"))))
  .get("/proposals/:slug/certificate", async (c) => {
    const slug = c.req.param("slug");
    const withEvidence = await verifyRenderToken(c.env.SIGNING_SECRET, slug, c.req.query("token"));
    return c.json(await getPublicCertificate(serviceClient(c.env), slug, withEvidence));
  })
  .get("/proposals/:slug/signed.pdf", async (c) => {
    const db = serviceClient(c.env);
    const row = await loadPublicRow(db, c.req.param("slug"));
    const sig = row.signed_at ? await loadSignature(db, row.id) : null;
    if (!sig?.pdf_path) return c.json({ error: { code: "not_ready", message: "The signed PDF isn't ready yet." } }, 404);
    const filename = `${row.title} - signed.pdf`.replace(/[\\/:*?"<>|]+/g, "-");
    const { data } = await db.storage.from("signed-pdfs").createSignedUrl(sig.pdf_path, 300, { download: filename });
    if (!data) return c.json({ error: { code: "storage_error", message: "Couldn't fetch the PDF." } }, 500);
    return c.redirect(data.signedUrl, 302);
  })
  .post("/proposals/:slug/extension-request", async (c) => {
    await rateLimit(c.env.RATE_KV, `ext:${ip(c)}`, 5, 3600, scale(c));
    const input = await body(c, z.object({ message: z.string().max(1000).optional() }));
    const db = serviceClient(c.env);
    const proposalId = await requestExtension(db, c.req.param("slug"), { ...meta(c), message: input.message });
    c.executionCtx.waitUntil(onExtensionRequested(c.env, db, proposalId, input.message?.trim() || null));
    return c.json({ ok: true });
  })
  .post("/proposals/:slug/otp", async (c) => {
    await rateLimit(c.env.RATE_KV, `otp:${ip(c)}`, 10, 3600, scale(c));
    const { email } = await body(c, OtpRequestSchema);
    await sendOtp(c.env, serviceClient(c.env), c.req.param("slug"), email, meta(c));
    return c.json({ ok: true });
  })
  .post("/proposals/:slug/otp/verify", async (c) => {
    await rateLimit(c.env.RATE_KV, `otpv:${ip(c)}`, 30, 3600, scale(c));
    const { email, code } = await body(c, OtpVerifySchema);
    await verifyOtp(c.env, serviceClient(c.env), c.req.param("slug"), email, code, meta(c));
    return c.json({ ok: true });
  })
  .post("/proposals/:slug/sign", async (c) => {
    await rateLimit(c.env.RATE_KV, `sign:${ip(c)}`, 10, 3600, scale(c));
    const input = await body(c, SignRequestSchema);
    const db = serviceClient(c.env);
    const result = await signProposal(c.env, db, c.req.param("slug"), input, meta(c));
    c.executionCtx.waitUntil(afterSigning(c.env, db, result.signatureId));
    return c.json(result);
  })
  .post("/proposals/:slug/decline", async (c) => {
    await rateLimit(c.env.RATE_KV, `decline:${ip(c)}`, 10, 3600, scale(c));
    const { reason } = await body(c, DeclineSchema);
    const db = serviceClient(c.env);
    const proposalId = await declineProposal(db, c.req.param("slug"), reason, meta(c));
    c.executionCtx.waitUntil(onDeclined(c.env, db, proposalId, reason || null));
    return c.json({ ok: true });
  });
