import { BrandSchema, OwnerSignatureSchema, type Brand } from "@bridger/shared";
import { found, type ServiceContext } from "./context.js";

export interface OwnerSettings {
  brand: Brand | null;
  default_terms_markdown: string;
  default_expiry_days: number;
  timezone: string;
  /** Default "Prepared by" on new covers: owner signature name, else company name. */
  preparedBy: string;
}

export async function getSettings(ctx: ServiceContext): Promise<OwnerSettings> {
  const row = found(
    await ctx.db
      .from("settings")
      .select("brand, default_terms_markdown, default_expiry_days, timezone, owner_signature")
      .eq("owner_id", ctx.ownerId)
      .maybeSingle(),
    "load settings",
    "Settings",
  ) as { brand: unknown; default_terms_markdown: string; default_expiry_days: number; timezone: string; owner_signature: unknown };
  const brand = BrandSchema.safeParse(row.brand);
  const sig = OwnerSignatureSchema.safeParse(row.owner_signature);
  return {
    brand: brand.success ? brand.data : null,
    default_terms_markdown: row.default_terms_markdown,
    default_expiry_days: row.default_expiry_days,
    timezone: row.timezone,
    preparedBy: sig.success ? sig.data.name : brand.success ? brand.data.company.name : "",
  };
}
