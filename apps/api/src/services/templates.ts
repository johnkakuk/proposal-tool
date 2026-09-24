import {
  PricingSchema,
  ProposalContentSchema,
  emptyContent,
  emptyPricing,
  type TemplateDetail,
  type TemplateInputSchema,
  type TemplatePatchSchema,
  type TemplateSummary,
} from "@bridger/shared";
import type { z } from "zod";
import { ApiError } from "../lib/errors.js";
import { found, must, type ServiceContext } from "./context.js";
import { validateDocument } from "./proposals.js";

const SUMMARY = "id, name, description, category, thumbnail_url, created_at, updated_at";

export async function listTemplates(ctx: ServiceContext): Promise<TemplateSummary[]> {
  return must(await ctx.db.from("templates").select(SUMMARY).eq("owner_id", ctx.ownerId).order("name"), "list templates") as TemplateSummary[];
}

export async function getTemplate(ctx: ServiceContext, id: string): Promise<TemplateDetail> {
  return found(await ctx.db.from("templates").select("*").eq("owner_id", ctx.ownerId).eq("id", id).maybeSingle(), "load the template", "Template") as TemplateDetail;
}

export async function createTemplate(ctx: ServiceContext, input: z.output<typeof TemplateInputSchema>): Promise<TemplateDetail> {
  const content = input.content ?? emptyContent();
  const pricing = input.pricing ?? emptyPricing();
  validateDocument(content, pricing);
  return must(
    await ctx.db
      .from("templates")
      .insert({ owner_id: ctx.ownerId, name: input.name, description: input.description ?? null, category: input.category ?? null, content, pricing })
      .select("*")
      .single(),
    "create the template",
  ) as TemplateDetail;
}

export async function updateTemplate(ctx: ServiceContext, id: string, input: z.output<typeof TemplatePatchSchema>): Promise<TemplateDetail> {
  const current = await getTemplate(ctx, id);
  if (input.baseUpdatedAt && input.baseUpdatedAt !== current.updated_at) {
    throw new ApiError(409, "conflict", "This template was changed somewhere else. Reload to get the latest version.");
  }
  const patch: Record<string, unknown> = {};
  for (const k of ["name", "description", "category"] as const) if (input[k] !== undefined) patch[k] = input[k];
  if (input.content !== undefined || input.pricing !== undefined) {
    const content = input.content ?? ProposalContentSchema.parse(current.content);
    const pricing = input.pricing ?? PricingSchema.parse(current.pricing);
    validateDocument(content, pricing);
    if (input.content !== undefined) patch.content = content;
    if (input.pricing !== undefined) patch.pricing = pricing;
  }
  if (Object.keys(patch).length === 0) return current;
  const row = must(
    await ctx.db.from("templates").update(patch).eq("owner_id", ctx.ownerId).eq("id", id).eq("updated_at", current.updated_at).select("*").maybeSingle(),
    "save the template",
  ) as TemplateDetail | null;
  if (!row) throw new ApiError(409, "conflict", "This template was changed somewhere else. Reload to get the latest version.");
  return row;
}

export async function duplicateTemplate(ctx: ServiceContext, id: string): Promise<TemplateDetail> {
  const t = await getTemplate(ctx, id);
  return createTemplate(ctx, { name: `${t.name} (copy)`, description: t.description, category: t.category, content: t.content, pricing: t.pricing });
}

export async function deleteTemplate(ctx: ServiceContext, id: string): Promise<void> {
  await getTemplate(ctx, id);
  // proposals.template_id is ON DELETE SET NULL, so proposals made from it are unaffected.
  must(await ctx.db.from("templates").delete().eq("owner_id", ctx.ownerId).eq("id", id), "delete the template");
}
