import { formatCents, type Pricing } from "@bridger/shared";
import { must, type ServiceContext } from "./context.js";
import { getSettings } from "./settings.js";

/**
 * Everything an AI author should know before writing (SPEC §10.2 get_workspace_context):
 * brand, company, default terms, writing guidelines, and a services/pricing catalog
 * pulled from the templates.
 */
export async function getWorkspaceContext(ctx: ServiceContext) {
  const [settings, extra, templates] = await Promise.all([
    getSettings(ctx),
    ctx.db.from("settings").select("guidelines_markdown, ai_can_publish, ai_can_email_client").eq("owner_id", ctx.ownerId).single(),
    ctx.db.from("templates").select("id, name, description, category, pricing").eq("owner_id", ctx.ownerId).order("name"),
  ]);
  const t = must(templates, "load templates") as { id: string; name: string; description: string | null; category: string | null; pricing: Pricing }[];
  const catalog = t.flatMap((tpl) =>
    tpl.pricing.sections.flatMap((s) =>
      s.items.map((i) => ({
        template: tpl.name,
        section: s.title,
        sectionMode: s.mode,
        item: i.name,
        description: i.description ?? null,
        unitPriceCents: i.unitPriceCents,
        unitPrice: formatCents(i.unitPriceCents),
        quantity: i.quantity,
        unitLabel: i.unitLabel ?? null,
        billing: i.billing,
      })),
    ),
  );
  return {
    brand: settings.brand,
    company: settings.brand?.company ?? null,
    preparedBy: settings.preparedBy,
    defaultTermsMarkdown: settings.default_terms_markdown,
    defaultExpiryDays: settings.default_expiry_days,
    timezone: settings.timezone,
    writingGuidelinesMarkdown: (extra.data?.guidelines_markdown as string) ?? "",
    permissions: { aiCanPublish: Boolean(extra.data?.ai_can_publish), aiCanEmailClient: Boolean(extra.data?.ai_can_email_client) },
    templates: t.map(({ pricing: _pricing, ...rest }) => rest),
    servicesCatalog: catalog,
    tips: [
      "Start from the closest template (create_proposal with templateId), then adjust with update_block / set_pricing.",
      "Money is integer cents: $1,500.00 is 150000.",
      "Use get_preview_url to check the result before publish_proposal.",
    ],
  };
}
