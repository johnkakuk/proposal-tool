import { z } from "zod";
import { BlockSchema } from "../blocks/registry.js";
import { ThemeOverridesSchema } from "./theme.js";

export const ProposalContentSchema = z
  .object({
    schemaVersion: z.literal(1),
    theme: ThemeOverridesSchema.optional(),
    blocks: z.array(BlockSchema).max(300),
  })
  .superRefine((c, ctx) => {
    const seen = new Map<string, number>();
    c.blocks.forEach((b, i) => {
      const prev = seen.get(b.id);
      if (prev !== undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["blocks", i, "id"],
          message: `Block ${i + 1} (${b.type}) reuses id '${b.id}' from block ${prev + 1}; block IDs must be unique`,
        });
      }
      seen.set(b.id, i);
    });
  });
export type ProposalContent = z.infer<typeof ProposalContentSchema>;
export type ProposalContentInput = z.input<typeof ProposalContentSchema>;

export const emptyContent = (): ProposalContent => ({ schemaVersion: 1, blocks: [] });
