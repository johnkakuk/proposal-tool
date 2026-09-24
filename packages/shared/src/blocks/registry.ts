import { z } from "zod";
import { DocIdSchema } from "../schemas/common.js";
import * as P from "./definitions.js";

/**
 * Block registry (§5.2). One source of truth for each block type's props schema,
 * defaults, and an example. The web app extends each entry with its Editor and
 * Renderer components (apps/web/src/blocks), and the MCP `get_block_schema` tool
 * derives its JSON Schema + examples from here.
 *
 * To add a block type: add its props schema in definitions.ts, an entry below,
 * and the Editor/Renderer in the web registry. Type-checking fails until all three exist.
 */

export interface BlockDefinition<S extends z.ZodType = z.ZodType> {
  type: string;
  label: string;
  /** Written for an AI author: what the block is for and when to use it. */
  description: string;
  props: S;
  defaultProps: () => z.input<S>;
  example: z.input<S>;
  /** Top-level props that must be non-empty before publishing. */
  requiredProps: readonly string[];
}

function define<S extends z.ZodType>(def: BlockDefinition<S>): BlockDefinition<S> {
  return def;
}

export const blockRegistry = {
  cover: define({
    type: "cover",
    label: "Cover",
    description: "Title page. Usually the first block.",
    props: P.CoverProps,
    defaultProps: () => ({ title: "", subtitle: "", clientName: "", preparedBy: "", date: "" }),
    example: {
      title: "Content War Chest",
      subtitle: "A year of content, shot in two days",
      clientName: "Acme Roofing",
      preparedBy: "John, Bridger Digital",
      date: "2026-10-01",
    },
    requiredProps: ["title", "clientName"],
  }),
  heading: define({
    type: "heading",
    label: "Heading",
    description: "A section heading. Level 1–3. Headings also label blocks in analytics.",
    props: P.HeadingProps,
    defaultProps: () => ({ text: "", level: 2 as const }),
    example: { text: "Our approach", level: 2 },
    requiredProps: ["text"],
  }),
  text: define({
    type: "text",
    label: "Text",
    description: "Body copy in limited Markdown: headings, **bold**, *italic*, [links](url), lists, > blockquotes.",
    props: P.TextProps,
    defaultProps: () => ({ markdown: "" }),
    example: { markdown: "We'll film **two full days** on site and turn it into a year of posts.\n\n- 52 short videos\n- 12 long-form edits" },
    requiredProps: ["markdown"],
  }),
  image: define({
    type: "image",
    label: "Image",
    description: "A single image with alt text and optional caption.",
    props: P.ImageProps,
    defaultProps: () => ({ url: "", alt: "", width: "normal" as const }),
    example: { url: "https://example.com/photo.jpg", alt: "Crew filming on a rooftop", caption: "Shoot day, 2025", width: "wide" },
    requiredProps: ["url", "alt"],
  }),
  video: define({
    type: "video",
    label: "Video",
    description: "Embedded YouTube, Vimeo, or Loom video.",
    props: P.VideoProps,
    defaultProps: () => ({ url: "" }),
    example: { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", caption: "Sizzle reel" },
    requiredProps: ["url"],
  }),
  columns: define({
    type: "columns",
    label: "Columns",
    description: "2 or 3 side-by-side Markdown columns, each with an optional image.",
    props: P.ColumnsProps,
    defaultProps: () => ({ columns: [{ markdown: "" }, { markdown: "" }] }),
    example: { columns: [{ markdown: "### Before\nInconsistent posting." }, { markdown: "### After\nA post every weekday." }] },
    requiredProps: ["columns"],
  }),
  deliverables: define({
    type: "deliverables",
    label: "Deliverables",
    description: "What the client gets, as a list of titled items.",
    props: P.DeliverablesProps,
    defaultProps: () => ({ title: "Deliverables", items: [] }),
    example: {
      title: "What you get",
      items: [
        { title: "52 short-form videos", description: "Vertical, captioned, ready to post.", icon: "video" },
        { title: "Content calendar", description: "A 12-month posting plan." },
      ],
    },
    requiredProps: ["items"],
  }),
  timeline: define({
    type: "timeline",
    label: "Timeline",
    description: "Project phases in order, each with a duration.",
    props: P.TimelineProps,
    defaultProps: () => ({ phases: [] }),
    example: {
      phases: [
        { title: "Discovery", duration: "1 week", description: "Interviews and shot list." },
        { title: "Production", duration: "2 days", description: "On-site filming." },
      ],
    },
    requiredProps: ["phases"],
  }),
  pricing: define({
    type: "pricing",
    label: "Pricing",
    description: "Renders sections of the proposal's `pricing` object. Every ID in pricingSectionIds must exist in pricing.sections.",
    props: P.PricingBlockProps,
    defaultProps: () => ({ pricingSectionIds: [], showTotals: true }),
    example: { pricingSectionIds: ["sec_production", "sec_addons"], showTotals: true },
    requiredProps: ["pricingSectionIds"],
  }),
  testimonial: define({
    type: "testimonial",
    label: "Testimonial",
    description: "A client quote.",
    props: P.TestimonialProps,
    defaultProps: () => ({ quote: "", author: "", role: "", company: "" }),
    example: { quote: "Best marketing money we've spent.", author: "Jane Doe", role: "Owner", company: "Doe Plumbing" },
    requiredProps: ["quote", "author"],
  }),
  case_study: define({
    type: "case_study",
    label: "Case study",
    description: "Challenge → solution → results for a past client.",
    props: P.CaseStudyProps,
    defaultProps: () => ({ title: "", client: "", challenge: "", solution: "", results: [] }),
    example: {
      title: "From zero to 40k followers",
      client: "Doe Plumbing",
      challenge: "No social presence.",
      solution: "A Content War Chest shoot and weekly posting.",
      results: ["40k followers in 9 months", "3× inbound calls"],
    },
    requiredProps: ["title", "client"],
  }),
  team: define({
    type: "team",
    label: "Team",
    description: "People working on the project.",
    props: P.TeamProps,
    defaultProps: () => ({ members: [] }),
    example: { members: [{ name: "John", role: "Producer", photoUrl: "https://example.com/john.jpg" }] },
    requiredProps: ["members"],
  }),
  faq: define({
    type: "faq",
    label: "FAQ",
    description: "Questions and Markdown answers.",
    props: P.FaqProps,
    defaultProps: () => ({ items: [] }),
    example: { items: [{ q: "Who owns the footage?", a: "You do, once the final invoice is paid." }] },
    requiredProps: ["items"],
  }),
  terms: define({
    type: "terms",
    label: "Terms",
    description: "Terms and conditions in Markdown. Defaults to the workspace default terms.",
    props: P.TermsProps,
    defaultProps: () => ({ title: "Terms & Conditions", markdown: "" }),
    example: { title: "Terms & Conditions", markdown: "1. 50% deposit due on signing.\n2. Balance due on delivery." },
    requiredProps: ["markdown"],
  }),
  cta: define({
    type: "cta",
    label: "Call to action",
    description: "A closing pitch with a button that scrolls to the signature.",
    props: P.CtaProps,
    defaultProps: () => ({ heading: "", body: "", buttonLabel: "Accept proposal" }),
    example: { heading: "Ready to start?", body: "Sign below to lock in your shoot dates.", buttonLabel: "Accept proposal" },
    requiredProps: ["heading", "buttonLabel"],
  }),
  divider: define({
    type: "divider",
    label: "Divider",
    description: "A visual separator.",
    props: P.DividerProps,
    defaultProps: () => ({ style: "line" as const }),
    example: { style: "line" },
    requiredProps: [],
  }),
  page_break: define({
    type: "page_break",
    label: "Page break",
    description: "Forces a page break in the PDF. Invisible on the web.",
    props: P.PageBreakProps,
    defaultProps: () => ({}),
    example: {},
    requiredProps: [],
  }),
  signature: define({
    type: "signature",
    label: "Signature",
    description: "Where the client signs. Exactly one per proposal, and it must be the last block other than dividers.",
    props: P.SignatureProps,
    defaultProps: () => ({ intro: "", showOwnerSignature: true }),
    example: { intro: "By signing, you accept this proposal and the terms above.", showOwnerSignature: true },
    requiredProps: [],
  }),
} as const;

export type BlockType = keyof typeof blockRegistry;
export const BLOCK_TYPES = Object.keys(blockRegistry) as BlockType[];

const blockOf = <T extends BlockType>(type: T) =>
  z.object({
    id: DocIdSchema,
    type: z.literal(type),
    props: blockRegistry[type].props as (typeof blockRegistry)[T]["props"],
    hidden: z.boolean().optional(),
  });

export const BlockSchema = z.discriminatedUnion("type", [
  blockOf("cover"),
  blockOf("heading"),
  blockOf("text"),
  blockOf("image"),
  blockOf("video"),
  blockOf("columns"),
  blockOf("deliverables"),
  blockOf("timeline"),
  blockOf("pricing"),
  blockOf("testimonial"),
  blockOf("case_study"),
  blockOf("team"),
  blockOf("faq"),
  blockOf("terms"),
  blockOf("cta"),
  blockOf("divider"),
  blockOf("page_break"),
  blockOf("signature"),
]);
export type Block = z.infer<typeof BlockSchema>;
export type BlockOfType<T extends BlockType> = Extract<Block, { type: T }>;
export type BlockProps<T extends BlockType> = BlockOfType<T>["props"];

export function getBlockDefinition(type: BlockType): BlockDefinition {
  return blockRegistry[type] as BlockDefinition;
}
