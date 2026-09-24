import type { BlockProps, BlockType, PricingSection } from "@bridger/shared";
import type { ComponentType } from "react";

/**
 * The web half of a block type: how it looks, how it's edited, and how it appears
 * in the slash menu. Schemas, defaults, and examples live in the shared registry
 * (packages/shared/src/blocks/registry.ts); this file never duplicates them.
 *
 * Prose (`text`, `heading`) is written directly in the editor with markdown
 * shortcuts. Everything else is an "object": an atom node inserted with `/`.
 */

/** Extra data an object owns inside the editor document. Only pricing uses it today. */
export interface PricingAux {
  sections: PricingSection[];
}

export type AuxFor<T extends BlockType> = T extends "pricing" ? PricingAux : null;

export interface RendererProps<T extends BlockType> {
  props: BlockProps<T>;
  blockId: string;
}

export interface EditorProps<T extends BlockType> {
  props: BlockProps<T>;
  onChange: (next: BlockProps<T>) => void;
  aux: AuxFor<T>;
  /** Updates props and aux together as a single undo step. */
  onUpdate: (next: { props: BlockProps<T>; aux: AuxFor<T> }) => void;
  blockId: string;
}

export type MenuGroup = "Basics" | "Sales" | "Content" | "Media" | "Layout";

export interface BlockUI<T extends BlockType> {
  type: T;
  /** Slash-menu entry. Label defaults to the shared registry's label. */
  menu: { description: string; icon: string; keywords: string[]; group: MenuGroup };
  /** How it looks in the editor preview, the public viewer, and the PDF. */
  Renderer: ComponentType<RendererProps<T>>;
  /** Form shown when the object is being edited in place. */
  Editor: ComponentType<EditorProps<T>>;
  /** At most one per proposal (the slash menu disables it once present). */
  singleton?: boolean;
  /** Hidden from the slash menu (prose types are written directly). */
  hiddenFromMenu?: boolean;
  /** Initial props and aux for a newly inserted object. Defaults to the shared defaultProps. */
  create?: () => { props: BlockProps<T>; aux: AuxFor<T> };
  /**
   * Called when an object is copied (duplicate button, copy/paste). Regenerate any IDs
   * the object owns so the document stays valid. Pricing uses this for section IDs.
   */
  onDuplicate?: (value: { props: BlockProps<T>; aux: AuxFor<T> }) => { props: BlockProps<T>; aux: AuxFor<T> };
}

export type BlockUIRegistry = { [T in BlockType]: BlockUI<T> };
