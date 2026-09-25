import {
  ClientInputSchema,
  ClientPatchSchema,
  CreateProposalSchema,
  DuplicateProposalSchema,
  ListProposalsQuerySchema,
  SaveAsTemplateSchema,
  TemplateInputSchema,
  TemplatePatchSchema,
  UpdateProposalSchema,
} from "@bridger/shared";
import { Hono, type Context } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../env.js";
import { serviceClient } from "../../lib/supabase.js";
import { body, parseOr422 } from "../../lib/validate.js";
import { requireOwner } from "../../middleware/auth.js";
import * as clients from "../../services/clients.js";
import type { ServiceContext } from "../../services/context.js";
import * as proposals from "../../services/proposals.js";
import { publishProposal } from "../../services/publish.js";
import { audit } from "../../services/audit.js";
import { exportProposalPdf } from "../../services/pdf.js";
import { loadSignature } from "../../services/public.js";
import * as templates from "../../services/templates.js";

/**
 * REST v1 (SPEC §10.3). Used by the admin SPA now; Phase 7 adds API-key/OAuth auth
 * and the MCP tools on top of the same services.
 */

function ctx(c: Context<AppEnv>): ServiceContext {
  return {
    db: serviceClient(c.env),
    ownerId: c.get("ownerId"),
    actor: c.get("actor"),
    createdVia: "manual",
    ip: c.req.header("CF-Connecting-IP"),
    userAgent: c.req.header("User-Agent"),
  };
}

const id = (c: Context<AppEnv>) => parseOr422(z.uuid({ message: "Invalid id" }), c.req.param("id"));

export const v1 = new Hono<AppEnv>()
  .use(requireOwner)

  // Proposals
  .get("/proposals", async (c) => c.json(await proposals.listProposals(ctx(c), parseOr422(ListProposalsQuerySchema, c.req.query()))))
  .post("/proposals", async (c) => c.json(await proposals.createProposal(ctx(c), await body(c, CreateProposalSchema)), 201))
  .get("/proposals/:id", async (c) => c.json(await proposals.getProposal(ctx(c), id(c))))
  .patch("/proposals/:id", async (c) => c.json(await proposals.updateProposal(ctx(c), id(c), await body(c, UpdateProposalSchema))))
  .post("/proposals/:id/duplicate", async (c) => c.json(await proposals.duplicateProposal(ctx(c), id(c), await body(c, DuplicateProposalSchema)), 201))
  .post("/proposals/:id/publish", async (c) => c.json(await publishProposal(ctx(c), id(c), c.env.APP_URL)))
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
  .delete("/templates/:id", async (c) => {
    await templates.deleteTemplate(ctx(c), id(c));
    return c.body(null, 204);
  })

  // Clients
  .get("/clients", async (c) => c.json(await clients.listClients(ctx(c), c.req.query("q"))))
  .post("/clients", async (c) => c.json(await clients.createClient(ctx(c), await body(c, ClientInputSchema)), 201))
  .get("/clients/:id", async (c) => c.json(await clients.getClient(ctx(c), id(c))))
  .patch("/clients/:id", async (c) => c.json(await clients.updateClient(ctx(c), id(c), await body(c, ClientPatchSchema))))
  .delete("/clients/:id", async (c) => {
    await clients.deleteClient(ctx(c), id(c));
    return c.body(null, 204);
  });
