import { z } from "zod";
import { EmailSchema, ShortTextSchema, UrlSchema } from "./common.js";
import { ProposalContentSchema } from "./content.js";
import { ProposalStatusSchema } from "./db.js";
import { PricingSchema } from "./pricing.js";

/**
 * Request bodies for /api/v1/*. The admin SPA, the REST API, and (Phase 7) the MCP
 * tools all validate with these, then call the same Worker services.
 */

const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .transform((v) => (v.trim() === "" ? null : v.trim()))
    .nullable()
    .optional();

export const ClientInputSchema = z.object({
  name: ShortTextSchema.trim().min(1, "Client name is required"),
  company: optionalText(300),
  email: z
    .union([EmailSchema, z.literal("")])
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional(),
  phone: optionalText(40),
  website: z
    .union([UrlSchema, z.literal("")])
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional(),
  logo_url: z
    .union([UrlSchema, z.literal("")])
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional(),
  notes: optionalText(10_000),
});
export type ClientInput = z.input<typeof ClientInputSchema>;
export const ClientPatchSchema = ClientInputSchema.partial();

const uuid = z.uuid();

export const CreateProposalSchema = z.object({
  title: ShortTextSchema.trim().min(1, "Title is required"),
  clientId: uuid.nullable().optional(),
  templateId: uuid.nullable().optional(),
  content: ProposalContentSchema.optional(),
  pricing: PricingSchema.optional(),
  expiresAt: z.iso.datetime({ offset: true }).nullable().optional(),
});
export type CreateProposalInput = z.input<typeof CreateProposalSchema>;

export const UpdateProposalSchema = z.object({
  title: ShortTextSchema.trim().min(1, "Title is required").optional(),
  clientId: uuid.nullable().optional(),
  expiresAt: z.iso.datetime({ offset: true }).nullable().optional(),
  content: ProposalContentSchema.optional(),
  pricing: PricingSchema.optional(),
  /** Optimistic concurrency: the `updated_at` the editor last saw. Mismatch → 409. */
  baseUpdatedAt: z.string().optional(),
});
export type UpdateProposalInput = z.input<typeof UpdateProposalSchema>;

export const ListProposalsQuerySchema = z.object({
  status: ProposalStatusSchema.optional(),
  clientId: uuid.optional(),
  q: z.string().max(200).optional(),
});

export const DuplicateProposalSchema = z.object({
  /** "Duplicate as new revision": keeps the title and links via revision_of. */
  asRevision: z.boolean().default(false),
  clientId: uuid.nullable().optional(),
});

export const TemplateInputSchema = z.object({
  name: ShortTextSchema.trim().min(1, "Template name is required"),
  description: optionalText(2_000),
  category: optionalText(100),
  content: ProposalContentSchema.optional(),
  pricing: PricingSchema.optional(),
});
export type TemplateInput = z.input<typeof TemplateInputSchema>;
export const TemplatePatchSchema = TemplateInputSchema.partial().extend({ baseUpdatedAt: z.string().optional() });

export const SaveAsTemplateSchema = z.object({
  name: ShortTextSchema.trim().min(1, "Template name is required"),
  description: optionalText(2_000),
  category: optionalText(100),
});

/** "Send email" to the client (SPEC §9): optional personal message. */
export const SendProposalEmailSchema = z.object({
  message: z.string().trim().max(5_000).optional(),
});
