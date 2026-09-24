import { z } from "zod";
import { ShortTextSchema } from "./common.js";

/** Owner-facing email types (§9). Each can be switched off in Settings. */
export const OWNER_NOTIFICATION_TYPES = [
  "first_view",
  "return_visit",
  "signed",
  "declined",
  "expiring_soon",
  "expired",
  "extension_requested",
  "ai_draft_created",
  "ai_published",
  "daily_digest",
] as const;
export type OwnerNotificationType = (typeof OWNER_NOTIFICATION_TYPES)[number];

export const NotificationPrefsSchema = z.object(
  Object.fromEntries(OWNER_NOTIFICATION_TYPES.map((t) => [t, z.boolean()])) as Record<OwnerNotificationType, z.ZodBoolean>,
);
export type NotificationPrefs = z.infer<typeof NotificationPrefsSchema>;

export const defaultNotificationPrefs = (): NotificationPrefs => ({
  first_view: true,
  return_visit: true,
  signed: true,
  declined: true,
  expiring_soon: true,
  expired: true,
  extension_requested: true,
  ai_draft_created: true,
  ai_published: true,
  daily_digest: false,
});

/** `settings.owner_signature` jsonb. `imagePath` is a Storage path for drawn signatures. */
export const OwnerSignatureSchema = z.object({
  name: ShortTextSchema,
  title: ShortTextSchema,
  type: z.enum(["typed", "drawn"]),
  text: ShortTextSchema.optional(),
  imagePath: z.string().max(500).optional(),
});
export type OwnerSignature = z.infer<typeof OwnerSignatureSchema>;
