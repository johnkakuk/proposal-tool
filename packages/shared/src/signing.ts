import { z } from "zod";
import { EmailSchema, ShortTextSchema } from "./schemas/common.js";
import { SelectionsSchema, type Pricing, type Selections } from "./schemas/pricing.js";
import type { ProposalContent } from "./schemas/content.js";
import type { OwnerSignature } from "./schemas/settings.js";
import type { PricingResult } from "./pricing.js";

/** The exact consent text shown and stored (SPEC §8.2 step 4). */
export function consentText(company: string): string {
  return `By checking this box and clicking 'Sign & Accept', I agree that my electronic signature is the legal equivalent of my handwritten signature, that I am authorized to accept this proposal on behalf of ${company}, and that I consent to conducting this transaction and receiving related records electronically. I can download a copy of this proposal and my signature at any time.`;
}

export const SignerSchema = z.object({
  name: ShortTextSchema.trim().min(2, "Enter your full name"),
  email: EmailSchema,
  title: ShortTextSchema.trim().min(1, "Enter your title"),
  company: ShortTextSchema.trim().min(1, "Enter your company"),
});
export type Signer = z.infer<typeof SignerSchema>;

/** PNG data URL of a drawn signature, capped at ~375 KB decoded. */
const PngDataUrl = z
  .string()
  .max(500_000)
  .regex(/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/, "Signature image must be a PNG");

export const SignatureInputSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("typed"), text: ShortTextSchema.trim().min(2, "Type your signature") }),
  z.object({ type: z.literal("drawn"), imageDataUrl: PngDataUrl }),
]);

export const SignRequestSchema = z.object({
  /** The version the client was looking at; must equal current_version (else 409). */
  version: z.number().int().min(1),
  selections: SelectionsSchema,
  signer: SignerSchema,
  signature: SignatureInputSchema,
  consent: z.literal(true, { message: "Please agree to sign electronically" }),
  timezoneOffsetMinutes: z.number().int().min(-900).max(900),
});
export type SignRequest = z.infer<typeof SignRequestSchema>;

export const OtpRequestSchema = z.object({ email: EmailSchema });
export const OtpVerifySchema = z.object({ email: EmailSchema, code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code") });
export const DeclineSchema = z.object({ reason: z.string().trim().max(2000).optional() });

/**
 * The frozen record that gets hashed (SPEC §8.2 step 5). Raw IP / user agent / geo
 * are *not* in it; their hash is (`evidenceHash`), so the snapshot can be shown on the
 * public verification page without exposing the signer's IP, while still binding it.
 */
export interface SignatureSnapshot {
  schema: "bridger.signature/1";
  proposal: { id: string; slug: string; title: string; clientName: string | null };
  /** The published version the client reviewed and signed. */
  version: number;
  content: ProposalContent;
  pricing: Pricing;
  selections: Selections;
  totals: PricingResult;
  signer: Signer;
  signature: { type: "typed"; text: string } | { type: "drawn"; imageSha256: string };
  ownerSignature: OwnerSignature | null;
  consentText: string;
  signedAt: string;
  evidenceHash: string;
}

/** Masks an email for public display: jane.doe@acme.com → j*****e@acme.com */
export function maskEmail(email: string): string {
  const [user = "", domain = ""] = email.split("@");
  if (user.length <= 2) return `${user[0] ?? ""}*@${domain}`;
  return `${user[0]}${"*".repeat(Math.min(5, user.length - 2))}${user[user.length - 1]}@${domain}`;
}
