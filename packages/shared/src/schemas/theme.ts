import { z } from "zod";
import { HexColorSchema, ShortTextSchema, UrlSchema } from "./common.js";

export const ThemeColorsSchema = z.object({
  primary: HexColorSchema,
  accent: HexColorSchema,
  background: HexColorSchema,
  text: HexColorSchema,
});

/** Google Fonts family names, e.g. "Inter", "Playfair Display". */
export const FontFamilySchema = z.string().min(1).max(80).regex(/^[A-Za-z0-9 ]+$/, "Use a Google Fonts family name");

export const ThemeSchema = z.object({
  colors: ThemeColorsSchema,
  headingFont: FontFamilySchema,
  bodyFont: FontFamilySchema,
  logoUrl: UrlSchema.optional(),
});
export type Theme = z.infer<typeof ThemeSchema>;

/** Per-proposal overrides of the brand theme. */
export const ThemeOverridesSchema = z.object({
  colors: ThemeColorsSchema.partial().optional(),
  headingFont: FontFamilySchema.optional(),
  bodyFont: FontFamilySchema.optional(),
  clientLogoUrl: UrlSchema.optional(),
});
export type ThemeOverrides = z.infer<typeof ThemeOverridesSchema>;

export const CompanyInfoSchema = z.object({
  name: ShortTextSchema,
  address: z.string().max(500).optional(),
  phone: z.string().max(40).optional(),
  website: UrlSchema.optional(),
});
export type CompanyInfo = z.infer<typeof CompanyInfoSchema>;

/** `settings.brand` jsonb. */
export const BrandSchema = z.object({
  theme: ThemeSchema,
  company: CompanyInfoSchema,
});
export type Brand = z.infer<typeof BrandSchema>;

/** Merges brand theme with per-proposal overrides. */
export function resolveTheme(brand: Theme, overrides?: ThemeOverrides): Theme & { clientLogoUrl?: string } {
  return {
    colors: { ...brand.colors, ...overrides?.colors },
    headingFont: overrides?.headingFont ?? brand.headingFont,
    bodyFont: overrides?.bodyFont ?? brand.bodyFont,
    ...(brand.logoUrl ? { logoUrl: brand.logoUrl } : {}),
    ...(overrides?.clientLogoUrl ? { clientLogoUrl: overrides.clientLogoUrl } : {}),
  };
}

// ---------------------------------------------------------------------------
// Contrast (WCAG 2.1). Brand colors are John's choice; these derive legible text colors
// from them so any palette meets AA (4.5:1 for normal text).
// ---------------------------------------------------------------------------

const channel = (c: number) => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const rgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
const toHex = (c: [number, number, number]) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase()}`;

/** `a` moved `t` (0–1) of the way toward `b`. */
export function mix(a: string, b: string, t: number): string {
  const [x, y] = [rgb(a), rgb(b)];
  return toHex(x.map((v, i) => v + (y[i]! - v) * t) as [number, number, number]);
}

export function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map(channel) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const INK = "#111827";
const PAPER = "#FFFFFF";

/** White or near-black text, whichever reads better on `bg`. */
export function textOn(bg: string): string {
  return contrastRatio(PAPER, bg) >= contrastRatio(INK, bg) ? PAPER : INK;
}

/**
 * `fg` adjusted just enough (toward black or white, whichever gains contrast faster)
 * to reach `min` against `bg`. Returns `fg` unchanged if it already passes.
 */
export function readableOn(fg: string, bg: string, min = 4.5): string {
  if (contrastRatio(fg, bg) >= min) return fg.toUpperCase();
  const target = luminance(bg) > 0.5 ? [0, 0, 0] : [255, 255, 255];
  const from = rgb(fg);
  for (let t = 0.05; t <= 1.0001; t += 0.05) {
    const mixed = from.map((v, i) => v + (target[i]! - v) * t) as [number, number, number];
    const hex = toHex(mixed);
    if (contrastRatio(hex, bg) >= min) return hex;
  }
  return textOn(bg);
}

/** CSS custom properties the renderer applies (§5.4), plus derived legible text colors. */
export function themeToCssVars(theme: Theme): Record<string, string> {
  const { primary, accent, background, text } = theme.colors;
  return {
    "--color-primary": primary,
    "--color-accent": accent,
    "--color-background": background,
    "--color-text": readableOn(text, background),
    /** Secondary text (captions, meta): body text softened toward the background, still AA. */
    "--color-muted": readableOn(mix(text, background, 0.35), background),
    /** Text on primary / accent fills (buttons, cover, CTA). */
    "--color-on-primary": textOn(primary),
    "--color-on-accent": textOn(accent),
    /** Accent used *as text*: on the page background, and on the primary fill. */
    "--color-accent-text": readableOn(accent, background),
    "--color-accent-on-primary": readableOn(accent, primary),
    /** Primary used as text (headings) on the page background. */
    "--color-primary-text": readableOn(primary, background),
    "--font-heading": `"${theme.headingFont}", ui-serif, Georgia, serif`,
    "--font-body": `"${theme.bodyFont}", ui-sans-serif, system-ui, sans-serif`,
  };
}
