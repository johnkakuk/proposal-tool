import type { AuditEventType } from "@bridger/shared";
import { must, type ServiceContext } from "./context.js";

/** Appends an audit event (append-only table). */
export async function audit(ctx: ServiceContext, proposalId: string, eventType: AuditEventType, metadata: Record<string, unknown> = {}): Promise<void> {
  must(
    await ctx.db.from("audit_events").insert({
      owner_id: ctx.ownerId,
      proposal_id: proposalId,
      event_type: eventType,
      actor: ctx.actor,
      ip: ctx.ip ?? null,
      user_agent: ctx.userAgent ?? null,
      metadata,
    }),
    "write the audit log",
  );
}

const EDIT_COALESCE_MS = 15 * 60 * 1000;

/**
 * Autosave runs every few seconds, so `edited` is logged at most once per 15 minutes
 * per actor per proposal (the latest edit is still reflected in proposals.updated_at).
 */
export async function auditEdited(ctx: ServiceContext, proposalId: string, fields: string[]): Promise<void> {
  const last = must(
    await ctx.db
      .from("audit_events")
      .select("event_type, actor, occurred_at")
      .eq("proposal_id", proposalId)
      .order("occurred_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    "read the audit log",
  ) as { event_type: string; actor: string; occurred_at: string } | null;
  if (last && last.event_type === "edited" && last.actor === ctx.actor && Date.now() - Date.parse(last.occurred_at) < EDIT_COALESCE_MS) return;
  await audit(ctx, proposalId, "edited", { fields });
}
