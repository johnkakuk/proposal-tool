import { z } from "zod";
import { blockRegistry, BLOCK_TYPES } from "./blocks/registry.js";
import { ProposalContentSchema } from "./schemas/content.js";
import { PricingSchema } from "./schemas/pricing.js";

/** Payload for the MCP `get_block_schema` tool: JSON Schemas plus an example per block type. */
export function getBlockSchemaDocument() {
  return {
    proposalContent: z.toJSONSchema(ProposalContentSchema, { io: "input", unrepresentable: "any" }),
    pricing: z.toJSONSchema(PricingSchema, { io: "input", unrepresentable: "any" }),
    blockTypes: BLOCK_TYPES.map((type) => {
      const def = blockRegistry[type];
      return { type, label: def.label, description: def.description, requiredProps: def.requiredProps, example: def.example };
    }),
    rules: [
      "Money is integer cents: $1,500.00 is 150000.",
      "Block IDs must be unique and stay the same across edits (analytics attach to them).",
      "Exactly one signature block, and it must be the last block other than dividers.",
      "Every pricing block's pricingSectionIds must exist in pricing.sections.",
      "choose_one sections are radio groups: mark at most one item selectedByDefault.",
    ],
  };
}
