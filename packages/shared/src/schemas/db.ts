import { z } from "zod";

/**
 * Enums mirrored from the Postgres schema (supabase/migrations). A test checks
 * these lists match the SQL enum definitions exactly.
 */

export const PROPOSAL_STATUSES = ["draft", "sent", "viewed", "signed", "declined", "expired", "archived"] as const;
export const ProposalStatusSchema = z.enum(PROPOSAL_STATUSES);
export type ProposalStatus = z.infer<typeof ProposalStatusSchema>;

export const CREATED_VIA = ["manual", "template", "mcp", "api"] as const;
export const CreatedViaSchema = z.enum(CREATED_VIA);
export type CreatedVia = z.infer<typeof CreatedViaSchema>;

export const VERSION_REASONS = ["published", "signed"] as const;
export type VersionReason = (typeof VERSION_REASONS)[number];

export const AUDIT_EVENT_TYPES = [
  "created",
  "edited",
  "published",
  "link_copied",
  "emailed",
  "viewed",
  "otp_sent",
  "otp_verified",
  "signed",
  "declined",
  "expired",
  "extended",
  "extension_requested",
  "pdf_exported",
  "archived",
  "duplicated",
] as const;
export const AuditEventTypeSchema = z.enum(AUDIT_EVENT_TYPES);
export type AuditEventType = z.infer<typeof AuditEventTypeSchema>;

/** `owner | client | system | ai:<client name>` */
export const AuditActorSchema = z.string().regex(/^(owner|client|system|ai:[^\s].{0,63})$/);
export type AuditActor = z.infer<typeof AuditActorSchema>;

export const SIGNATURE_TYPES = ["typed", "drawn"] as const;
export const DEVICES = ["desktop", "tablet", "mobile"] as const;
export const HEATMAP_KINDS = ["click", "tap", "move"] as const;
