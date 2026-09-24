import { BLOCK_TYPES, blockRegistry, type Block, type BlockType } from "@bridger/shared";
import type { ComponentType } from "react";

/**
 * Web half of the block registry (SPEC §5.2). The shared registry owns schemas and
 * defaults; this adds the Editor and Renderer for each type. `satisfies Record<BlockType, …>`
 * makes a missing block type a compile error. Phase 2 replaces the placeholders.
 */

export interface RendererProps<T extends BlockType = BlockType> {
  block: Extract<Block, { type: T }>;
}
export interface EditorProps<T extends BlockType = BlockType> {
  block: Extract<Block, { type: T }>;
  onChange: (props: Extract<Block, { type: T }>["props"]) => void;
}

interface WebBlockEntry {
  Renderer: ComponentType<RendererProps<never>>;
  Editor: ComponentType<EditorProps<never>>;
}

function Placeholder({ block }: { block: Block }) {
  return (
    <div className="rounded-md border border-dashed border-slate-300 p-4 text-sm text-slate-500">
      {blockRegistry[block.type].label} block
    </div>
  );
}

const placeholder: WebBlockEntry = { Renderer: Placeholder, Editor: Placeholder };

export const webBlockRegistry = Object.fromEntries(BLOCK_TYPES.map((t) => [t, placeholder])) as Record<BlockType, WebBlockEntry> satisfies Record<
  BlockType,
  WebBlockEntry
>;
