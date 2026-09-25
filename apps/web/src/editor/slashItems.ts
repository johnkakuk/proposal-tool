import { blockRegistry, newBlockId, type BlockType } from "@bridger/shared";
import type { Editor, Range } from "@tiptap/core";
import { BLOCK_TYPES } from "@bridger/shared";
import { MENU_GROUP_ORDER, blockUI, createBlockValue } from "../blocks";
import type { MenuGroup } from "../blocks/types";
import { OBJECT_NODE } from "./convert";

export interface SlashItem {
  id: string;
  label: string;
  description: string;
  icon: string;
  group: MenuGroup;
  keywords: string[];
  /** Why it can't be inserted right now, if it can't. */
  disabledReason?: string;
  run: (editor: Editor, range: Range) => void;
}

const prose = (id: string, label: string, description: string, icon: string, keywords: string[], apply: (e: Editor, r: Range) => void): SlashItem => ({
  id,
  label,
  description,
  icon,
  group: "Basics",
  keywords,
  run: apply,
});

const PROSE_ITEMS: SlashItem[] = [
  prose("paragraph", "Text", "Plain paragraph", "¶", ["paragraph", "body"], (e, r) => e.chain().focus().deleteRange(r).setParagraph().run()),
  prose("h1", "Heading 1", "Large section heading", "H1", ["title", "#"], (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 1 }).run()),
  prose("h2", "Heading 2", "Medium section heading", "H2", ["subtitle", "##"], (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 2 }).run()),
  prose("h3", "Heading 3", "Small section heading", "H3", ["###"], (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 3 }).run()),
  prose("bullets", "Bulleted list", "A simple list", "•", ["ul", "unordered", "-"], (e, r) => e.chain().focus().deleteRange(r).toggleBulletList().run()),
  prose("numbers", "Numbered list", "A list with numbers", "1.", ["ol", "ordered"], (e, r) => e.chain().focus().deleteRange(r).toggleOrderedList().run()),
  prose("quote", "Quote", "Call out a quote or key point", "❝", ["blockquote", ">"], (e, r) => e.chain().focus().deleteRange(r).setBlockquote().run()),
];

function countObjects(editor: Editor, type: BlockType): number {
  let n = 0;
  editor.state.doc.forEach((node) => {
    if (node.type.name === OBJECT_NODE && node.attrs.blockType === type) n++;
  });
  return n;
}

/** Inserts a new object and opens its editor. */
export function insertObject(editor: Editor, range: Range, type: BlockType) {
  const { props, aux } = createBlockValue(type, editor.storage.proposalObject.insertContext);
  const blockId = newBlockId();
  editor.storage.proposalObject.edits.pending.add(blockId);
  editor
    .chain()
    .focus()
    .deleteRange(range)
    .insertContent({ type: OBJECT_NODE, attrs: { blockId, blockType: type, props, aux, hidden: false } })
    .run();

  // Leave a line to keep writing on after the object (empty paragraphs aren't saved).
  editor.state.doc.forEach((node, pos, index) => {
    if (node.attrs.blockId !== blockId) return;
    const next = editor.state.doc.maybeChild(index + 1);
    if (next?.type.name === "paragraph" && next.content.size === 0) return;
    editor.view.dispatch(editor.state.tr.insert(pos + node.nodeSize, editor.schema.nodes.paragraph!.create()));
  });
}

/** Everything the "/" menu offers: prose formats plus every object in the block registry. */
export function allSlashItems(editor: Editor): SlashItem[] {
  const objects = BLOCK_TYPES.filter((t) => !blockUI[t].hiddenFromMenu).map((type): SlashItem => {
    const ui = blockUI[type];
    return {
      id: type,
      label: blockRegistry[type].label,
      description: ui.menu.description,
      icon: ui.menu.icon,
      group: ui.menu.group,
      keywords: ui.menu.keywords,
      disabledReason: ui.singleton && countObjects(editor, type) > 0 ? "Already in this proposal" : undefined,
      run: (e, r) => insertObject(e, r, type),
    };
  });
  const order = (g: MenuGroup) => MENU_GROUP_ORDER.indexOf(g);
  return [...PROSE_ITEMS, ...objects].sort((a, b) => order(a.group) - order(b.group));
}

/** Ranks items for a query: label prefix > label contains > keyword/description match. */
export function filterSlashItems(items: SlashItem[], query: string): SlashItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  const score = (i: SlashItem) => {
    const label = i.label.toLowerCase();
    if (label.startsWith(q)) return 3;
    if (label.includes(q)) return 2;
    if (i.keywords.some((k) => k.toLowerCase().startsWith(q))) return 1.5;
    if (i.keywords.some((k) => k.toLowerCase().includes(q)) || i.description.toLowerCase().includes(q)) return 1;
    return 0;
  };
  return items
    .map((item, idx) => ({ item, s: score(item), idx }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.idx - b.idx)
    .map((x) => x.item);
}
