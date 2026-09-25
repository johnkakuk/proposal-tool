import { mergeAttributes, Node } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { ReactNodeViewRenderer } from "@tiptap/react";
import type { InsertContext } from "../../blocks/types";
import { OBJECT_NODE, type ObjectAttrs } from "../convert";
import { ObjectNodeView } from "../ObjectNodeView";

/** Lets the slash menu / keyboard ask a node view to open its editor. */
export interface ObjectEditRequests {
  pending: Set<string>;
  listeners: Set<(blockId: string) => void>;
  request: (blockId: string) => void;
}

declare module "@tiptap/core" {
  interface Storage {
    proposalObject: { edits: ObjectEditRequests; insertContext: InsertContext };
  }
}

/**
 * One generic node for every object block. What it looks like and how it's edited comes
 * from the block registry (src/blocks), so new object types need no editor changes.
 */
export const ProposalObject = Node.create({
  name: OBJECT_NODE,
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,
  isolating: true,

  addAttributes() {
    return {
      blockId: { default: null, rendered: false },
      blockType: { default: "divider", rendered: false },
      props: { default: {}, rendered: false },
      hidden: { default: false, rendered: false },
      aux: { default: null, rendered: false },
    };
  },

  addStorage() {
    const edits: ObjectEditRequests = {
      pending: new Set(),
      listeners: new Set(),
      request(blockId) {
        this.pending.add(blockId);
        this.listeners.forEach((l) => l(blockId));
      },
    };
    const insertContext: InsertContext = {};
    return { edits, insertContext };
  },

  // Copy/paste within the editor carries the object's data but not its ID; BlockIds assigns
  // a new one and runs the block type's onDuplicate.
  parseHTML() {
    return [
      {
        tag: "div[data-proposal-object]",
        getAttrs: (el) => {
          try {
            const data = JSON.parse((el as HTMLElement).dataset.proposalObject ?? "");
            return { blockId: null, blockType: data.blockType, props: data.props, hidden: Boolean(data.hidden), aux: data.aux ?? null };
          } catch {
            return false;
          }
        },
      },
    ];
  },

  renderHTML({ node }) {
    const a = node.attrs as ObjectAttrs;
    return ["div", mergeAttributes({ "data-proposal-object": JSON.stringify({ blockType: a.blockType, props: a.props, hidden: a.hidden, aux: a.aux }) })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ObjectNodeView, {
      // Let form fields inside the object handle their own events, but let ProseMirror
      // handle drag-and-drop from the handle.
      stopEvent: ({ event }) => {
        if (event.type.startsWith("drag") || event.type === "drop") return false;
        const target = event.target as HTMLElement | null;
        return Boolean(target?.closest?.("[data-object-editor], [data-object-toolbar] button"));
      },
    });
  },

  addKeyboardShortcuts() {
    return {
      // Enter on a selected object opens its editor.
      Enter: ({ editor }) => {
        const { selection } = editor.state;
        if (!(selection instanceof NodeSelection) || selection.node.type.name !== OBJECT_NODE) return false;
        this.storage.edits.request(selection.node.attrs.blockId as string);
        return true;
      },
    };
  },
});
