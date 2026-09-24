import { z } from "zod";
import { MAX_CENTS, hasAtMostTwoDecimals } from "../money.js";

/** IDs inside documents (blocks, pricing sections, items, discounts). Human/AI-friendly but constrained. */
export const DocIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, "IDs may only contain letters, digits, '_' and '-'");

export const CentsSchema = z
  .number()
  .int("Money must be integer cents (e.g. 150000 for $1,500.00)")
  .min(0)
  .max(MAX_CENTS);

export const TwoDecimalSchema = z
  .number()
  .refine(hasAtMostTwoDecimals, "At most 2 decimal places");

/** Markdown in the limited subset (headings, bold, italic, links, lists, blockquote). Length-capped. */
export const MarkdownSchema = z.string().max(50_000);

export const ShortTextSchema = z.string().max(300);
export const LongTextSchema = z.string().max(5_000);

/** http(s) URL. Empty string is allowed in drafts; publish validation flags required empties. */
export const UrlSchema = z
  .string()
  .max(2_000)
  .refine((v) => v === "" || /^https?:\/\/\S+$/i.test(v), "Must be an http(s) URL");

export const HexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a 6-digit hex color like #1A2B3C");

export const EmailSchema = z.email().max(320);
