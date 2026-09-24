import { newBlockId } from "@bridger/shared";
import { getBlockUI } from "../../blocks";
import type { ObjectAttrs } from "../convert";

/** A copy of an object with a fresh ID; the block type's onDuplicate regenerates IDs it owns. */
export function duplicateObjectAttrs(attrs: ObjectAttrs): ObjectAttrs {
  const ui = getBlockUI(attrs.blockType);
  const copied = ui.onDuplicate ? ui.onDuplicate({ props: attrs.props as never, aux: attrs.aux as never }) : { props: attrs.props, aux: attrs.aux };
  return { ...attrs, blockId: newBlockId(), props: copied.props as Record<string, unknown>, aux: copied.aux as ObjectAttrs["aux"] };
}
