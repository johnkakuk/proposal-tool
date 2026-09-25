import { PricingSchema, ProposalContentSchema, checkPublishable, documentHash, type ProposalDetail } from "@bridger/shared";
import { ApiError } from "../lib/errors.js";
import { getClientRow } from "./clients.js";
import { isAutomated, must, type ServiceContext } from "./context.js";
import { getProposal } from "./proposals.js";
import { getSettings } from "./settings.js";

const DAY_MS = 86_400_000;

export interface PublishResult {
  proposal: ProposalDetail;
  /** False when nothing changed since the last publish (no new version). */
  published: boolean;
  publicUrl: string;
}

export const publicUrl = (appUrl: string, slug: string) => `${appUrl.replace(/\/$/, "")}/p/${slug}`;

/**
 * Publish or update (SPEC §4, §7.2): validate, then atomically snapshot a new version.
 * The link never changes; the viewer always shows the latest published version.
 */
export async function publishProposal(ctx: ServiceContext, id: string, appUrl: string): Promise<PublishResult> {
  if (isAutomated(ctx)) {
    const { data } = await ctx.db.from("settings").select("ai_can_publish").eq("owner_id", ctx.ownerId).single();
    if (!data?.ai_can_publish) throw new ApiError(403, "ai_publish_disabled", "Publishing by AI is turned off in Settings → AI & API. Leave it as a draft and ask John to publish.");
  }
  const p = await getProposal(ctx, id);
  if (p.signed_at) throw new ApiError(409, "locked", "This proposal is signed and locked. Duplicate it as a new revision to make changes.");
  if (p.status === "archived") throw new ApiError(409, "archived", "Archived proposals can't be published.");
  if (p.status === "declined") throw new ApiError(409, "declined", "This proposal was declined. Duplicate it to send a new one.");

  const url = publicUrl(appUrl, p.slug);
  const needsReopen = p.status === "expired";
  if (!p.has_unpublished_changes && p.current_version > 0 && !needsReopen) {
    return { proposal: p, published: false, publicUrl: url };
  }

  const content = ProposalContentSchema.parse(p.content);
  const pricing = PricingSchema.parse(p.pricing);
  const client = p.client_id ? await getClientRow(ctx, p.client_id) : null;
  const issues = checkPublishable(content, pricing, { clientHasEmail: Boolean(client?.email) });
  const settings = await getSettings(ctx);
  const expiresAt = p.expires_at ?? new Date(Date.now() + settings.default_expiry_days * DAY_MS).toISOString();
  if (Date.parse(expiresAt) <= Date.now()) issues.push({ path: "expiresAt", message: "The expiry date is in the past. Pick a new date to extend it." });
  if (issues.length) throw new ApiError(422, "not_publishable", issues.map((i) => i.message).join("; "), issues);

  const wantsOwnerSignature = content.blocks.some((b) => b.type === "signature" && !b.hidden && b.props.showOwnerSignature);
  must(
    await ctx.db.rpc("publish_proposal", {
      p_proposal_id: p.id,
      p_owner_id: ctx.ownerId,
      p_expected_updated_at: p.updated_at,
      p_content_hash: await documentHash(p),
      p_owner_signature: wantsOwnerSignature ? settings.ownerSignature : null,
      p_expires_at: expiresAt,
      p_actor: ctx.actor,
      p_ip: ctx.ip ?? null,
      p_user_agent: ctx.userAgent ?? null,
    }),
    "publish the proposal",
  );
  return { proposal: await getProposal(ctx, id), published: true, publicUrl: url };
}
