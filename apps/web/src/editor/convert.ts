import { newBlockId, type Block, type BlockType, type Pricing, type PricingSection, type ProposalContent } from "@bridger/shared";
import type { JSONContent } from "@tiptap/core";
import { markdown } from "./prose";

/**
 * Converts between the stored document (ProposalContent + Pricing, SPEC §5) and the
 * editor document (TipTap JSON).
 *
 *   stored `text` block      ⇄ a run of prose nodes (paragraphs, lists, quotes) between
 *                               headings/objects; the run's first node carries the block ID
 *   stored `heading` block   ⇄ a top-level heading node
 *   any other block          ⇄ a `proposalObject` atom node {blockId, blockType, props, hidden, aux}
 *   hidden text/heading      ⇄ a `proposalObject` too (prose can't be hidden inline)
 *
 * Pricing sections live inside the pricing object that first shows them (`aux.sections`),
 * so editing a table is one undoable change. Sections no table shows are kept aside
 * ("unplaced") and written back unchanged.
 */

export const OBJECT_NODE = "proposalObject";

export interface ObjectAttrs {
  blockId: string | null;
  blockType: BlockType;
  props: Record<string, unknown>;
  hidden: boolean;
  aux: { sections: PricingSection[] } | null;
}

export interface EditorDocument {
  doc: JSONContent;
  /** Pricing sections not shown by any pricing block. */
  unplacedSections: PricingSection[];
}

const clampLevel = (n: unknown): 1 | 2 | 3 => (n === 1 || n === 2 ? n : 3);

function objectNode(block: Block, aux: ObjectAttrs["aux"] = null): JSONContent {
  const attrs: ObjectAttrs = { blockId: block.id, blockType: block.type, props: block.props as Record<string, unknown>, hidden: Boolean(block.hidden), aux };
  return { type: OBJECT_NODE, attrs };
}

export function toEditorDocument(content: ProposalContent, pricing: Pricing): EditorDocument {
  const claimed = new Set<string>();
  const nodes: JSONContent[] = [];

  for (const block of content.blocks) {
    if (block.type === "text" && !block.hidden) {
      const parsed = markdown.parse(block.props.markdown).content ?? [];
      const run = (parsed.length ? parsed : [{ type: "paragraph" }]).map((n) =>
        n.type === "heading" ? { ...n, attrs: { ...n.attrs, level: clampLevel(n.attrs?.level) } } : n,
      );
      run[0] = { ...run[0], attrs: { ...run[0]!.attrs, blockId: block.id } };
      nodes.push(...run);
    } else if (block.type === "heading" && !block.hidden) {
      nodes.push({ type: "heading", attrs: { level: block.props.level, blockId: block.id }, content: block.props.text ? [{ type: "text", text: block.props.text }] : [] });
    } else if (block.type === "pricing") {
      const owned = block.props.pricingSectionIds.flatMap((id) => {
        const s = pricing.sections.find((x) => x.id === id);
        if (!s || claimed.has(id)) return [];
        claimed.add(id);
        return [s];
      });
      nodes.push(objectNode(block, { sections: owned }));
    } else {
      nodes.push(objectNode(block));
    }
  }

  return {
    doc: { type: "doc", content: nodes.length ? nodes : [{ type: "paragraph" }] },
    unplacedSections: pricing.sections.filter((s) => !claimed.has(s.id)),
  };
}

const plainText = (node: JSONContent): string => (node.text ?? "") + (node.content ?? []).map(plainText).join("");

export interface SerializedDocument {
  content: ProposalContent;
  /** Sections in document order, followed by unplaced ones. */
  sections: PricingSection[];
}

export function fromEditorDocument(doc: JSONContent, unplacedSections: PricingSection[] = [], theme?: ProposalContent["theme"]): SerializedDocument {
  const blocks: Block[] = [];
  const sections: PricingSection[] = [];
  let run: JSONContent[] = [];

  const flush = () => {
    if (run.length === 0) return;
    const md = markdown.serialize({ type: "doc", content: run }).trim();
    const id = (run[0]!.attrs?.blockId as string | null | undefined) ?? newBlockId();
    run = [];
    if (md) blocks.push({ id, type: "text", props: { markdown: md } });
  };

  for (const node of doc.content ?? []) {
    if (node.type === "heading") {
      flush();
      const text = plainText(node).trim();
      if (text) blocks.push({ id: (node.attrs?.blockId as string | null) ?? newBlockId(), type: "heading", props: { text, level: clampLevel(node.attrs?.level) } });
    } else if (node.type === OBJECT_NODE) {
      flush();
      const a = node.attrs as ObjectAttrs;
      const block = { id: a.blockId ?? newBlockId(), type: a.blockType, props: a.props, ...(a.hidden ? { hidden: true } : {}) } as Block;
      blocks.push(block);
      if (a.blockType === "pricing" && a.aux) sections.push(...a.aux.sections);
    } else {
      run.push(node);
    }
  }
  flush();

  return {
    content: { schemaVersion: 1, ...(theme ? { theme } : {}), blocks },
    sections: [...sections, ...unplacedSections],
  };
}

/** Rebuilds the full Pricing object from serialized sections plus proposal-level settings. */
export function assemblePricing(sections: PricingSection[], meta: Omit<Pricing, "sections">): Pricing {
  return { ...meta, sections };
}
