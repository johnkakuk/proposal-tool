import {
  BLOCK_TYPES,
  BlockSchema,
  PricingSchema,
  ProposalContentSchema,
  blockRegistry,
  newBlockId,
  zodIssues,
  type Block,
  type BlockPositionSchema,
  type InsertBlockSchema,
  type ProposalContent,
  type ProposalDetail,
  type UpdateBlockSchema,
} from "@bridger/shared";
import type { z } from "zod";
import { ApiError } from "../lib/errors.js";
import type { ServiceContext } from "./context.js";
import { getProposal, updateProposal } from "./proposals.js";
import { getSettings } from "./settings.js";

/**
 * Targeted edits by block ID (SPEC §10.2 insert/update/delete/move_block). Each edit is
 * validated as a whole document before saving, and every error names the block by
 * position and type so an AI author can fix its own mistake.
 */

const describe = (content: ProposalContent) => content.blocks.map((b, i) => `${i + 1}. ${b.type} '${b.id}'`).join(", ") || "(no blocks)";

function indexOf(content: ProposalContent, blockId: string): number {
  const i = content.blocks.findIndex((b) => b.id === blockId);
  if (i < 0) throw new ApiError(404, "no_such_block", `No block with id '${blockId}'. Blocks: ${describe(content)}`);
  return i;
}

/** Resolves a position. "end" means just before the signature (it must stay last). */
function resolvePosition(content: ProposalContent, position: z.output<typeof BlockPositionSchema>): number {
  if (position === "end") {
    const sig = content.blocks.findIndex((b) => b.type === "signature");
    return sig >= 0 ? sig : content.blocks.length;
  }
  if ("index" in position) return Math.min(position.index, content.blocks.length);
  if ("afterBlockId" in position) return indexOf(content, position.afterBlockId) + 1;
  return indexOf(content, position.beforeBlockId);
}

function validateBlock(block: unknown, where: string): Block {
  const r = BlockSchema.safeParse(block);
  if (!r.success) {
    const type = (block as { type?: string }).type;
    if (!BLOCK_TYPES.includes(type as Block["type"])) {
      throw new ApiError(422, "unknown_block_type", `${where}: unknown block type '${type}'. Valid types: ${BLOCK_TYPES.join(", ")}. Call get_block_schema for props.`);
    }
    const issues = zodIssues(r.error).map((i) => ({ ...i, message: `${where} (${type}): ${i.message}` }));
    throw new ApiError(422, "invalid_block", issues.map((i) => i.message).join("; "), issues);
  }
  return r.data;
}

async function save(ctx: ServiceContext, p: ProposalDetail, content: ProposalContent): Promise<ProposalDetail> {
  const parsed = ProposalContentSchema.safeParse(content);
  if (!parsed.success) {
    const issues = zodIssues(parsed.error, content);
    throw new ApiError(422, "invalid_document", issues.map((i) => i.message).join("; "), issues);
  }
  return updateProposal(ctx, p.id, { content: parsed.data, baseUpdatedAt: p.updated_at });
}

export async function insertBlock(ctx: ServiceContext, proposalId: string, input: z.output<typeof InsertBlockSchema>): Promise<{ proposal: ProposalDetail; blockId: string }> {
  const p = await getProposal(ctx, proposalId);
  const content = structuredClone(p.content);
  const at = resolvePosition(content, input.position);
  const type = input.block.type as Block["type"];
  const defaults = BLOCK_TYPES.includes(type) ? (blockRegistry[type].defaultProps() as Record<string, unknown>) : {};
  const props: Record<string, unknown> = { ...defaults, ...input.block.props };
  // Terms start from the workspace default terms unless the caller wrote their own.
  if (type === "terms" && !props.markdown) props.markdown = (await getSettings(ctx)).default_terms_markdown;
  const id = input.block.id ?? newBlockId();
  if (content.blocks.some((b) => b.id === id)) throw new ApiError(422, "duplicate_block_id", `A block with id '${id}' already exists. Omit id to generate one.`);
  const block = validateBlock({ id, type, props, ...(input.block.hidden ? { hidden: true } : {}) }, `Block ${at + 1}`);
  content.blocks.splice(at, 0, block);
  return { proposal: await save(ctx, p, content), blockId: id };
}

export async function updateBlock(ctx: ServiceContext, proposalId: string, blockId: string, input: z.output<typeof UpdateBlockSchema>): Promise<ProposalDetail> {
  const p = await getProposal(ctx, proposalId);
  const content = structuredClone(p.content);
  const i = indexOf(content, blockId);
  const current = content.blocks[i]!;
  const next = { ...current, props: { ...(current.props as Record<string, unknown>), ...(input.props ?? {}) }, ...(input.hidden !== undefined ? { hidden: input.hidden } : {}) };
  if (next.hidden === false) delete (next as { hidden?: boolean }).hidden;
  content.blocks[i] = validateBlock(next, `Block ${i + 1}`);
  return save(ctx, p, content);
}

export async function deleteBlock(ctx: ServiceContext, proposalId: string, blockId: string): Promise<ProposalDetail> {
  const p = await getProposal(ctx, proposalId);
  const content = structuredClone(p.content);
  content.blocks.splice(indexOf(content, blockId), 1);
  return save(ctx, p, content);
}

export async function moveBlock(ctx: ServiceContext, proposalId: string, blockId: string, position: z.output<typeof BlockPositionSchema>): Promise<ProposalDetail> {
  const p = await getProposal(ctx, proposalId);
  const content = structuredClone(p.content);
  const [block] = content.blocks.splice(indexOf(content, blockId), 1);
  content.blocks.splice(resolvePosition(content, position), 0, block!);
  return save(ctx, p, content);
}

/** Replaces all blocks, and optionally pricing in the same save (so section IDs can change together). */
export async function replaceContent(ctx: ServiceContext, proposalId: string, content: ProposalContent, pricing?: z.output<typeof PricingSchema>): Promise<ProposalDetail> {
  const p = await getProposal(ctx, proposalId);
  if (!pricing) return save(ctx, p, content);
  const parsed = ProposalContentSchema.safeParse(content);
  if (!parsed.success) {
    const issues = zodIssues(parsed.error, content);
    throw new ApiError(422, "invalid_document", issues.map((i) => i.message).join("; "), issues);
  }
  return updateProposal(ctx, p.id, { content: parsed.data, pricing, baseUpdatedAt: p.updated_at });
}

/** Replaces pricing and returns the recomputed totals so the model can check its math. */
export async function setPricing(ctx: ServiceContext, proposalId: string, pricing: z.output<typeof PricingSchema>): Promise<ProposalDetail> {
  const p = await getProposal(ctx, proposalId);
  return updateProposal(ctx, proposalId, { pricing, baseUpdatedAt: p.updated_at });
}
