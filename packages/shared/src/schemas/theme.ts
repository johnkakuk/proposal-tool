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

/** CSS custom properties the renderer applies (§5.4). */
export function themeToCssVars(theme: Theme): Record<string, string> {
  return {
    "--color-primary": theme.colors.primary,
    "--color-accent": theme.colors.accent,
    "--color-background": theme.colors.background,
    "--color-text": theme.colors.text,
    "--font-heading": `"${theme.headingFont}", ui-serif, Georgia, serif`,
    "--font-body": `"${theme.bodyFont}", ui-sans-serif, system-ui, sans-serif`,
  };
}
