import type { SendProposalEmailSchema } from "@bridger/shared";
import type { z } from "zod";
import { proposalSent } from "../emails/templates.js";
import type { Env } from "../env.js";
import { sendEmail } from "../lib/email.js";
import { ApiError } from "../lib/errors.js";
import { audit } from "./audit.js";
import { getClientRow } from "./clients.js";
import { isAutomated, type ServiceContext } from "./context.js";
import { ownerContext, publicUrl } from "./notify.js";
import { getProposal } from "./proposals.js";
import { getSettings } from "./settings.js";

/**
 * Emails the proposal link to the client (SPEC §9 "Proposal sent"). Only when John
 * clicks "Send email" (or, in Phase 7, an MCP client with ai_can_email_client on).
 */
export async function sendProposalEmail(ctx: ServiceContext, env: Env, id: string, input: z.output<typeof SendProposalEmailSchema>): Promise<{ to: string }> {
  if (isAutomated(ctx)) {
    const { data } = await ctx.db.from("settings").select("ai_can_email_client").eq("owner_id", ctx.ownerId).single();
    if (!data?.ai_can_email_client) throw new ApiError(403, "ai_email_disabled", "Emailing clients by AI is turned off in Settings → AI & API. Give John the link instead.");
  }
  const p = await getProposal(ctx, id);
  if (p.current_version === 0) throw new ApiError(409, "not_published", "Publish the proposal before emailing it.");
  if (p.status === "signed" || p.status === "declined" || p.status === "archived") throw new ApiError(409, "not_sendable", `A ${p.status} proposal can't be sent.`);
  if (p.status === "expired" || (p.expires_at && Date.parse(p.expires_at) <= Date.now())) throw new ApiError(409, "expired", "This proposal has expired. Extend it before sending.");
  const client = p.client_id ? await getClientRow(ctx, p.client_id) : null;
  if (!client?.email) throw new ApiError(422, "no_client_email", "Add an email address to the client first.");

  const [owner, settings] = await Promise.all([ownerContext(ctx.db, ctx.ownerId), getSettings(ctx)]);
  const r = await sendEmail(env, ctx.db, {
    ownerId: ctx.ownerId,
    proposalId: p.id,
    to: client.email,
    template: "proposal_sent",
    replyTo: env.OWNER_EMAIL,
    ...proposalSent({
      brand: owner.brand,
      title: p.title,
      client: client.company ?? client.name,
      message: input.message || null,
      publicUrl: publicUrl(env, p.slug),
      expiresAt: p.expires_at,
      senderName: settings.preparedBy || "John",
      timezone: owner.timezone,
    }),
  });
  if (!r.ok) throw new ApiError(503, "email_failed", "The email couldn't be sent. Please try again.");
  await audit(ctx, p.id, "emailed", { to: client.email, version: p.current_version });
  return { to: client.email };
}
