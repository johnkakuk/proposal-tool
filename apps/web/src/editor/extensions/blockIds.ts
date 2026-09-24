import { newBlockId } from "@bridger/shared";
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { OBJECT_NODE, type ObjectAttrs } from "../convert";
import { PROSE_BLOCK_TYPES } from "../prose";
import { duplicateObjectAttrs } from "./objectAttrs";

/**
 * Keeps every top-level node's `blockId` present and unique. Block IDs must stay stable
 * because analytics and heatmaps attach to them (SPEC §5.1).
 *  - Splitting a paragraph doesn't copy its ID (keepOnSplit: false), so the new half gets one.
 *  - Pasted or duplicated objects get a new ID, and their block type's onDuplicate hook
 *    regenerates any IDs they own (e.g. pricing section IDs).
 */
export const BlockIds = Extension.create({
  name: "blockIds",

  addGlobalAttributes() {
    return [{ types: [...PROSE_BLOCK_TYPES], attributes: { blockId: { default: null, rendered: false, keepOnSplit: false } } }];
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("blockIds"),
        appendTransaction(transactions, _old, state) {
          if (!transactions.some((t) => t.docChanged)) return null;
          const tr = state.tr;
          const seen = new Set<string>();
          state.doc.forEach((node, pos) => {
            if (!("blockId" in node.attrs)) return;
            const id = node.attrs.blockId as string | null;
            if (id && !seen.has(id)) {
              seen.add(id);
              return;
            }
            const attrs = node.type.name === OBJECT_NODE ? duplicateObjectAttrs(node.attrs as ObjectAttrs) : { ...node.attrs, blockId: newBlockId() };
            seen.add(attrs.blockId!);
            tr.setNodeMarkup(pos, undefined, attrs);
          });
          return tr.docChanged ? tr : null;
        },
      }),
    ];
  },
});
