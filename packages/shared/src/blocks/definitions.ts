import { z } from "zod";
import { DocIdSchema, LongTextSchema, MarkdownSchema, ShortTextSchema, UrlSchema } from "../schemas/common.js";

/**
 * Props schemas for every v1 block type (§5.2). Drafts may leave strings empty;
 * `requiredProps` in the registry lists what publish validation insists on.
 */

export const CoverProps = z.object({
  title: ShortTextSchema,
  subtitle: ShortTextSchema.default(""),
  clientName: ShortTextSchema,
  clientLogoUrl: UrlSchema.optional(),
  backgroundImageUrl: UrlSchema.optional(),
  preparedBy: ShortTextSchema,
  /** ISO date (YYYY-MM-DD). */
  date: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/, "Use YYYY-MM-DD"),
});

export const HeadingProps = z.object({
  text: ShortTextSchema,
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(2),
});

export const TextProps = z.object({ markdown: MarkdownSchema });

export const ImageProps = z.object({
  url: UrlSchema,
  alt: ShortTextSchema,
  caption: ShortTextSchema.optional(),
  width: z.enum(["full", "wide", "normal"]).default("normal"),
});

export const VideoProps = z.object({
  /** YouTube, Vimeo, or Loom URL. */
  url: UrlSchema,
  caption: ShortTextSchema.optional(),
});

export const ColumnsProps = z.object({
  columns: z
    .array(z.object({ markdown: MarkdownSchema, imageUrl: UrlSchema.optional() }))
    .min(2, "columns needs 2 or 3 columns")
    .max(3, "columns needs 2 or 3 columns"),
});

export const DeliverablesProps = z.object({
  title: ShortTextSchema,
  items: z
    .array(z.object({ title: ShortTextSchema, description: LongTextSchema, icon: z.string().max(40).optional() }))
    .max(50),
});

export const TimelineProps = z.object({
  phases: z
    .array(z.object({ title: ShortTextSchema, duration: z.string().max(60), description: LongTextSchema }))
    .max(30),
});

export const PricingBlockProps = z.object({
  /** Which sections of the proposal's `pricing` object to render here. */
  pricingSectionIds: z.array(DocIdSchema).max(50),
  showTotals: z.boolean().default(true),
});

export const TestimonialProps = z.object({
  quote: LongTextSchema,
  author: ShortTextSchema,
  role: ShortTextSchema.default(""),
  company: ShortTextSchema.default(""),
  avatarUrl: UrlSchema.optional(),
});

export const CaseStudyProps = z.object({
  title: ShortTextSchema,
  client: ShortTextSchema,
  challenge: MarkdownSchema,
  solution: MarkdownSchema,
  results: z.array(ShortTextSchema).max(20),
  imageUrl: UrlSchema.optional(),
});

export const TeamProps = z.object({
  members: z
    .array(z.object({ name: ShortTextSchema, role: ShortTextSchema, photoUrl: UrlSchema, bio: LongTextSchema.optional() }))
    .max(30),
});

export const FaqProps = z.object({
  items: z.array(z.object({ q: ShortTextSchema, a: MarkdownSchema })).max(50),
});

export const TermsProps = z.object({ title: ShortTextSchema, markdown: MarkdownSchema });

export const CtaProps = z.object({
  heading: ShortTextSchema,
  body: LongTextSchema,
  /** The button scrolls to the signature block. */
  buttonLabel: z.string().max(60),
});

export const DividerProps = z.object({ style: z.enum(["line", "dots", "space"]).default("line") });

/** PDF-only page break. */
export const PageBreakProps = z.object({});

export const SignatureProps = z.object({
  intro: MarkdownSchema,
  showOwnerSignature: z.boolean().default(true),
});
