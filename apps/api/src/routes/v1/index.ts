import {
  ClientInputSchema,
  ClientPatchSchema,
  CreateProposalSchema,
  DuplicateProposalSchema,
  ListProposalsQuerySchema,
  SaveAsTemplateSchema,
  SendProposalEmailSchema,
  TemplateInputSchema,
  TemplatePatchSchema,
  UpdateProposalSchema,
  InsertBlockSchema,
  UpdateBlockSchema,
  MoveBlockSchema,
  ReplaceContentSchema,
  SetPricingSchema,
  getBlockSchemaDocument,
} from "@bridger/shared";
import { Hono, type Context } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../env.js";
import { serviceClient } from "../../lib/supabase.js";
import { body, parseOr422 } from "../../lib/validate.js";
import { requireAuth, requireHuman } from "../../middleware/auth.js";
import { ctx, uuidParam } from "../../lib/ctx.js";
import * as blocks from "../../services/blocks.js";
import * as credentials from "../../services/credentials.js";
import { isAutomated } from "../../services/context.js";
import { onAiDraftCreated, onAiPublished } from "../../services/notify.js";
import { createPreviewUrl } from "../../services/preview.js";
import { getWorkspaceContext } from "../../services/workspace.js";
import { openApiDocument } from "./openapi.js";
import { exportAll } from "../../services/export.js";
import { getDashboardStats } from "../../services/stats.js";
import { consentKey, type PendingConsent } from "../oauth.js";
import { ApiError } from "../../lib/errors.js";
import * as clients from "../../services/clients.js";
import * as proposals from "../../services/proposals.js";
import { publishProposal } from "../../services/publish.js";
import { sendProposalEmail } from "../../services/sendProposal.js";
import { audit } from "../../services/audit.js";
import { exportProposalPdf } from "../../services/pdf.js";
import * as analytics from "../../services/analytics.js";
import { OWNER_COOKIE, hasOwnerCookie, ownerCookieHeader, ownerCookieValue } from "../../lib/ownerCookie.js";
import { loadSignature } from "../../services/public.js";
import * as templates from "../../services/templates.js";

/**
 * REST v1 (SPEC §10.3). The admin SPA, scripts (API keys), and AI clients (OAuth) all use
 * these routes; the MCP tools (src/mcp) call the same services. Automated callers can't
 * delete anything or manage credentials (requireHuman).
 */

const id = (c: Parameters<typeof uuidParam>[0]) => uuidParam(c);

export const v1 = new Hono<AppEnv>()
  // Public: the OpenAPI description (for ChatGPT Actions, Zapier)
  .get("/openapi.json", (c) => c.json(openApiDocument(c.env.APP_URL)))
  .use(requireAuth)

  .get("/stats", async (c) => c.json(await getDashboardStats(ctx(c))))

  // AI helpers (mirrors of MCP tools)
  .get("/workspace/context", async (c) => c.json(await getWorkspaceContext(ctx(c))))
  .get("/schema/blocks", (c) => c.json(getBlockSchemaDocument()))
  .post("/proposals/:id/preview-url", async (c) => c.json(await createPreviewUrl(ctx(c), c.env, id(c))))
  .put("/proposals/:id/content", async (c) => {
    const input = await body(c, ReplaceContentSchema);
    return c.json(await blocks.replaceContent(ctx(c), id(c), input.content, input.pricing));
  })
  .put("/proposals/:id/pricing", async (c) => {
    const p = await blocks.setPricing(ctx(c), id(c), (await body(c, SetPricingSchema)).pricing);
    return c.json({ totals: p.totals, proposal: p });
  })
  .post("/proposals/:id/blocks", async (c) => c.json(await blocks.insertBlock(ctx(c), id(c), await body(c, InsertBlockSchema)), 201))
  .patch("/proposals/:id/blocks/:blockId", async (c) => c.json(await blocks.updateBlock(ctx(c), id(c), c.req.param("blockId"), await body(c, UpdateBlockSchema))))
  .delete("/proposals/:id/blocks/:blockId", async (c) => c.json(await blocks.deleteBlock(ctx(c), id(c), c.req.param("blockId"))))
  .post("/proposals/:id/blocks/:blockId/move", async (c) => c.json(await blocks.moveBlock(ctx(c), id(c), c.req.param("blockId"), (await body(c, MoveBlockSchema)).position)))

  // Proposals
  .get("/proposals", async (c) => c.json(await proposals.listProposals(ctx(c), parseOr422(ListProposalsQuerySchema, c.req.query()))))
  .post("/proposals", async (c) => {
    const s = ctx(c);
    const p = await proposals.createProposal(s, await body(c, CreateProposalSchema));
    if (isAutomated(s)) c.executionCtx.waitUntil(onAiDraftCreated(c.env, s.db, p.id, s.createdViaClient ?? "AI"));
    return c.json(p, 201);
  })
  .get("/proposals/:id", async (c) => c.json(await proposals.getProposal(ctx(c), id(c))))
  .patch("/proposals/:id", async (c) => c.json(await proposals.updateProposal(ctx(c), id(c), await body(c, UpdateProposalSchema))))
  .post("/proposals/:id/duplicate", async (c) => c.json(await proposals.duplicateProposal(ctx(c), id(c), await body(c, DuplicateProposalSchema)), 201))
  .post("/proposals/:id/publish", async (c) => {
    const s = ctx(c);
    const r = await publishProposal(s, id(c), c.env.APP_URL);
    if (r.published && isAutomated(s)) c.executionCtx.waitUntil(onAiPublished(c.env, s.db, r.proposal.id, s.createdViaClient ?? "AI", r.proposal.current_version));
    return c.json(r);
  })
  // Owner-side events worth auditing that don't change data (SPEC §6.1).
  .post("/proposals/:id/events", async (c) => {
    const { type } = await body(c, z.object({ type: z.enum(["link_copied"]) }));
    const proposalId = id(c);
    await proposals.getProposal(ctx(c), proposalId); // ownership check
    await audit(ctx(c), proposalId, type);
    return c.body(null, 204);
  })
  .get("/proposals/:id/signature", async (c) => {
    const p = await proposals.getProposal(ctx(c), id(c));
    const sig = p.signed_at ? await loadSignature(serviceClient(c.env), p.id) : null;
    if (!sig) return c.json({ error: { code: "not_signed", message: "This proposal hasn't been signed." } }, 404);
    const pdfUrl = sig.pdf_path ? (await serviceClient(c.env).storage.from("signed-pdfs").createSignedUrl(sig.pdf_path, 300)).data?.signedUrl ?? null : null;
    return c.json({
      certificateId: sig.certificate_id,
      signerName: sig.signer_name,
      signerEmail: sig.signer_email,
      signerTitle: sig.signer_title,
      signerCompany: sig.signer_company,
      signedAt: sig.consent_given_at,
      documentHash: sig.document_hash,
      pdfUrl,
      certificateUrl: `${c.env.APP_URL.replace(/\/$/, "")}/p/${p.slug}/certificate`,
    });
  })
  .post("/proposals/:id/pdf", async (c) => {
    const p = await proposals.getProposal(ctx(c), id(c));
    const { bytes, filename } = await exportProposalPdf(c.env, serviceClient(c.env), p);
    await audit(ctx(c), p.id, "pdf_exported", { version: p.current_version });
    return new Response(bytes, {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${filename.replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(filename)}` },
    });
  })
  .post("/proposals/:id/send-email", async (c) => c.json(await sendProposalEmail(ctx(c), c.env, id(c), await body(c, SendProposalEmailSchema))))
  .delete("/proposals/:id", requireHuman, async (c) => {
    await proposals.purgeProposal(ctx(c), id(c));
    return c.body(null, 204);
  })
  .post("/proposals/:id/restore", async (c) => c.json(await proposals.restoreProposal(ctx(c), id(c))))
  // Analytics sidebar (SPEC §7.3)
  .get("/proposals/:id/analytics", async (c) => c.json(await analytics.getAnalytics(ctx(c), id(c))))
  .get("/proposals/:id/analytics/sessions/:sid", async (c) => c.json(await analytics.getSessionDetail(ctx(c), id(c), parseOr422(z.uuid(), c.req.param("sid")))))
  .get("/proposals/:id/analytics/heatmap", async (c) =>
    c.json(
      await analytics.getHeatmap(
        ctx(c),
        id(c),
        parseOr422(
          z.object({
            version: z.coerce.number().int().min(1),
            device: z.enum(["desktop", "tablet", "mobile"]).default("desktop"),
            kind: z.enum(["clicks", "moves"]).default("clicks"),
            sessionId: z.uuid().optional(),
          }),
          c.req.query(),
        ),
      ),
    ),
  )
  .get("/proposals/:id/audit", async (c) => c.json(await analytics.getAuditTrail(ctx(c), id(c))))
  .get("/proposals/:id/versions", async (c) => c.json(await analytics.listVersions(ctx(c), id(c))))
  .get("/proposals/:id/versions/:version", async (c) => c.json(await analytics.getVersion(ctx(c), id(c), parseOr422(z.coerce.number().int().min(1), c.req.param("version")))))
  .post("/proposals/:id/archive", async (c) => c.json(await proposals.archiveProposal(ctx(c), id(c))))
  .post("/proposals/:id/save-as-template", async (c) =>
    c.json(await proposals.saveProposalAsTemplate(ctx(c), id(c), await body(c, SaveAsTemplateSchema)), 201),
  )

  // Templates
  .get("/templates", async (c) => c.json(await templates.listTemplates(ctx(c))))
  .post("/templates", async (c) => c.json(await templates.createTemplate(ctx(c), await body(c, TemplateInputSchema)), 201))
  .get("/templates/:id", async (c) => c.json(await templates.getTemplate(ctx(c), id(c))))
  .patch("/templates/:id", async (c) => c.json(await templates.updateTemplate(ctx(c), id(c), await body(c, TemplatePatchSchema))))
  .post("/templates/:id/duplicate", async (c) => c.json(await templates.duplicateTemplate(ctx(c), id(c)), 201))
  .delete("/templates/:id", requireHuman, async (c) => {
    await templates.deleteTemplate(ctx(c), id(c));
    return c.body(null, 204);
  })

  .get("/export", requireHuman, async (c) => {
    c.header("Content-Disposition", `attachment; filename="bridger-proposals-export.json"`);
    return c.json(await exportAll(ctx(c)));
  })

  // Settings → AI & API (owner only)
  .get("/api-keys", requireHuman, async (c) => c.json(await credentials.listApiKeys(ctx(c))))
  .post("/api-keys", requireHuman, async (c) => c.json(await credentials.createApiKey(ctx(c), (await body(c, z.object({ name: z.string().trim().min(1).max(60) }))).name), 201))
  .delete("/api-keys/:id", requireHuman, async (c) => {
    await credentials.revokeApiKey(ctx(c), id(c));
    return c.body(null, 204);
  })
  // OAuth consent screen (/app/connect/:id)
  .get("/oauth/consent/:cid", requireHuman, async (c) => {
    const pending = await c.env.OAUTH_KV.get<PendingConsent>(consentKey(c.req.param("cid")), "json");
    if (!pending) throw new ApiError(404, "expired", "This connection request expired. Start again from the app you're connecting.");
    return c.json({ clientName: pending.clientName, redirectHost: pending.redirectHost, scope: pending.request.scope });
  })
  .post("/oauth/consent/:cid", requireHuman, async (c) => {
    const { approve } = await body(c, z.object({ approve: z.boolean() }));
    const key = consentKey(c.req.param("cid"));
    const pending = await c.env.OAUTH_KV.get<PendingConsent>(key, "json");
    if (!pending) throw new ApiError(404, "expired", "This connection request expired. Start again from the app you're connecting.");
    await c.env.OAUTH_KV.delete(key);
    if (!approve) {
      const url = new URL(pending.request.redirectUri);
      url.searchParams.set("error", "access_denied");
      if (pending.request.state) url.searchParams.set("state", pending.request.state);
      return c.json({ redirectTo: url.toString() });
    }
    if (!c.env.OAUTH_PROVIDER) throw new ApiError(503, "unavailable", "OAuth isn't available.");
    const { redirectTo } = await c.env.OAUTH_PROVIDER.completeAuthorization({
      request: pending.request,
      userId: c.get("ownerId"),
      metadata: { clientName: pending.clientName },
      scope: pending.request.scope,
      props: { ownerId: c.get("ownerId"), clientName: pending.clientName, principal: "oauth" },
    });
    return c.json({ redirectTo });
  })
  .get("/connections", requireHuman, async (c) => c.json(await credentials.listConnections(ctx(c), c.env.OAUTH_PROVIDER)))
  .delete("/connections/:grantId", requireHuman, async (c) => {
    await credentials.revokeConnection(ctx(c), c.env.OAUTH_PROVIDER, c.req.param("grantId"));
    return c.body(null, 204);
  })

  // Tracking settings (SPEC §7.6): "this browser is me" and the current IP for exclusion
  .get("/tracking/whoami", requireHuman, async (c) =>
    c.json({ ip: c.req.header("CF-Connecting-IP") ?? "127.0.0.1", ownerCookie: await hasOwnerCookie(c.req.header("Cookie"), c.env.SIGNING_SECRET) }),
  )
  .post("/tracking/owner-cookie", requireHuman, async (c) => {
    c.header("Set-Cookie", ownerCookieHeader(await ownerCookieValue(c.env.SIGNING_SECRET), c.env.APP_URL.startsWith("https"), 365 * 86_400));
    return c.json({ ownerCookie: true });
  })
  .delete("/tracking/owner-cookie", requireHuman, async (c) => {
    c.header("Set-Cookie", ownerCookieHeader("", c.env.APP_URL.startsWith("https"), 0));
    return c.json({ ownerCookie: false, cookie: OWNER_COOKIE });
  })

  // Clients
  .get("/clients", async (c) => c.json(await clients.listClients(ctx(c), c.req.query("q"))))
  .post("/clients", async (c) => c.json(await clients.createClient(ctx(c), await body(c, ClientInputSchema)), 201))
  .get("/clients/:id", async (c) => c.json(await clients.getClient(ctx(c), id(c))))
  .patch("/clients/:id", async (c) => c.json(await clients.updateClient(ctx(c), id(c), await body(c, ClientPatchSchema))))
  .delete("/clients/:id", requireHuman, async (c) => {
    await clients.deleteClient(ctx(c), id(c));
    return c.body(null, 204);
  });
