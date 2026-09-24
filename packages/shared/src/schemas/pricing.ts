import { z } from "zod";
import { CentsSchema, DocIdSchema, MarkdownSchema, ShortTextSchema, TwoDecimalSchema } from "./common.js";

export const BILLING_CADENCES = ["one_time", "monthly", "quarterly", "yearly"] as const;
export const BillingSchema = z.enum(BILLING_CADENCES);
export type Billing = z.infer<typeof BillingSchema>;

export const DiscountSchema = z
  .object({
    id: DocIdSchema,
    /** May be empty in drafts; publish validation requires it. */
    label: ShortTextSchema,
    type: z.enum(["percent", "amount"]),
    /** Percent: 0–100 (up to 2 decimals). Amount: integer cents. */
    value: z.number().min(0),
    /** Which cadence buckets a section/proposal-level discount targets. Ignored on line discounts. */
    appliesTo: z.enum(["one_time", "recurring", "all"]).default("all"),
  })
  .superRefine((d, ctx) => {
    if (d.type === "percent") {
      if (d.value > 100) ctx.addIssue({ code: "custom", path: ["value"], message: "Percent discount must be between 0 and 100" });
      if (!TwoDecimalSchema.safeParse(d.value).success)
        ctx.addIssue({ code: "custom", path: ["value"], message: "Percent discount allows at most 2 decimal places" });
    } else if (!CentsSchema.safeParse(d.value).success) {
      ctx.addIssue({ code: "custom", path: ["value"], message: "Amount discount must be a non-negative integer number of cents" });
    }
  });
export type Discount = z.infer<typeof DiscountSchema>;

export const LineItemSchema = z.object({
  id: DocIdSchema,
  /** May be empty in drafts; publish validation requires it. */
  name: ShortTextSchema,
  description: MarkdownSchema.optional(),
  /** May be decimal (e.g. 1.5 hours); at most 2 decimal places. */
  quantity: TwoDecimalSchema.pipe(z.number().min(0).max(1_000_000)),
  unitPriceCents: CentsSchema,
  unitLabel: z.string().max(40).optional(),
  billing: BillingSchema,
  selectedByDefault: z.boolean().default(false),
  discount: DiscountSchema.optional(),
});
export type LineItem = z.infer<typeof LineItemSchema>;

export const PricingSectionSchema = z
  .object({
    id: DocIdSchema,
    title: ShortTextSchema,
    description: MarkdownSchema.optional(),
    /** fixed: all included; optional: client toggles items; choose_one: radio group (Good/Better/Best). */
    mode: z.enum(["fixed", "optional", "choose_one"]),
    items: z.array(LineItemSchema).max(200),
    discounts: z.array(DiscountSchema).max(20).default([]),
  })
  .superRefine((s, ctx) => {
    if (s.mode === "choose_one") {
      if (s.items.length === 0)
        ctx.addIssue({ code: "custom", path: ["items"], message: `choose_one section '${s.id}' needs at least one item` });
      const defaults = s.items.filter((i) => i.selectedByDefault).length;
      if (defaults > 1)
        ctx.addIssue({
          code: "custom",
          path: ["items"],
          message: `choose_one section '${s.id}' has ${defaults} items with selectedByDefault; at most one is allowed`,
        });
    }
    reportDuplicateIds(ctx, s.items.map((i) => i.id), ["items"], "line item");
  });
export type PricingSection = z.infer<typeof PricingSectionSchema>;

export const PricingSchema = z
  .object({
    currency: z.literal("USD").default("USD"),
    sections: z.array(PricingSectionSchema).max(50),
    discounts: z.array(DiscountSchema).max(20).default([]),
    /** Display-only tax, applied last. Off when omitted. */
    taxRatePct: TwoDecimalSchema.pipe(z.number().min(0).max(100)).optional(),
    notes: MarkdownSchema.optional(),
  })
  .superRefine((p, ctx) => {
    reportDuplicateIds(ctx, p.sections.map((s) => s.id), ["sections"], "pricing section");
  });
export type Pricing = z.infer<typeof PricingSchema>;
export type PricingInput = z.input<typeof PricingSchema>;

/** Client choices: section ID → selected item IDs. */
export const SelectionsSchema = z.record(DocIdSchema, z.array(DocIdSchema).max(200));
export type Selections = z.infer<typeof SelectionsSchema>;

export const emptyPricing = (): Pricing => ({ currency: "USD", sections: [], discounts: [] });

function reportDuplicateIds(ctx: z.RefinementCtx, ids: string[], path: (string | number)[], what: string): void {
  const seen = new Set<string>();
  ids.forEach((id, i) => {
    if (seen.has(id)) ctx.addIssue({ code: "custom", path: [...path, i, "id"], message: `Duplicate ${what} id '${id}'` });
    seen.add(id);
  });
}
