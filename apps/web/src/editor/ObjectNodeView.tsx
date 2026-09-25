import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { useEffect, useRef, useState } from "react";
import { blockLabel, getBlockUI } from "../blocks";
import { IconButton } from "../blocks/fields";
import type { ObjectAttrs } from "./convert";
import { duplicateObjectAttrs } from "./extensions/objectAttrs";

/**
 * Renders any object block inside the editor: its Renderer as a live preview, a toolbar,
 * and its Editor form while editing. Edits go through updateAttributes, so they're part
 * of undo/redo.
 */
export function ObjectNodeView({ node, editor, getPos, updateAttributes, deleteNode, selected }: NodeViewProps) {
  const attrs = node.attrs as ObjectAttrs;
  const ui = getBlockUI(attrs.blockType);
  const edits = editor.storage.proposalObject.edits;
  const blockId = attrs.blockId ?? "";
  const [editing, setEditing] = useState(() => edits.pending.delete(blockId));
  const editable = editor.isEditable;
  const formRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const listener = (id: string) => {
      if (id === blockId) {
        edits.pending.delete(id);
        setEditing(true);
      }
    };
    edits.listeners.add(listener);
    return () => void edits.listeners.delete(listener);
  }, [edits, blockId]);

  // Focus the first field when the editor opens.
  useEffect(() => {
    if (editing) formRef.current?.querySelector<HTMLElement>("input, textarea, select")?.focus({ preventScroll: true });
  }, [editing]);

  const pos = () => (typeof getPos === "function" ? getPos() : undefined);

  const select = (at: number) => {
    const { tr, doc } = editor.state;
    editor.view.dispatch(tr.setSelection(NodeSelection.create(doc, at)).scrollIntoView());
  };

  const move = (dir: -1 | 1) => {
    const from = pos();
    if (from === undefined) return;
    const { doc } = editor.state;
    const index = doc.resolve(from).index(0);
    const sibling = doc.maybeChild(index + dir);
    if (!sibling) return;
    const tr = editor.state.tr;
    if (dir === -1) {
      tr.delete(from, from + node.nodeSize).insert(from - sibling.nodeSize, node);
      editor.view.dispatch(tr);
      select(from - sibling.nodeSize);
    } else {
      tr.insert(from + node.nodeSize + sibling.nodeSize, node).delete(from, from + node.nodeSize);
      editor.view.dispatch(tr);
      select(from + sibling.nodeSize);
    }
  };

  const duplicate = () => {
    const from = pos();
    if (from === undefined) return;
    const copy = editor.schema.nodes.proposalObject!.create(duplicateObjectAttrs(attrs));
    editor.view.dispatch(editor.state.tr.insert(from + node.nodeSize, copy));
  };

  /** Adds an empty line after the object and puts the caret there (objects can sit back to back). */
  const insertLineBelow = () => {
    const from = pos();
    if (from === undefined) return;
    const at = from + node.nodeSize;
    const tr = editor.state.tr.insert(at, editor.schema.nodes.paragraph!.create());
    editor.view.dispatch(tr.setSelection(TextSelection.create(tr.doc, at + 1)).scrollIntoView());
    editor.commands.focus();
  };

  const closeEditor = () => {
    setEditing(false);
    const from = pos();
    if (from !== undefined) select(from);
    editor.commands.focus();
  };

  const label = blockLabel(attrs.blockType);

  return (
    <NodeViewWrapper
      data-block-type={attrs.blockType}
      data-block-id={blockId}
      className={`group/object relative my-6 rounded-xl transition ${selected || editing ? "ring-2 ring-brand/40 ring-offset-4" : "hover:ring-1 hover:ring-slate-300 hover:ring-offset-4"}`}
    >
      <div contentEditable={false}>
        {editable && (
          <div
            data-object-toolbar
            className={`absolute -top-4 right-2 z-10 flex items-center gap-0.5 rounded-lg border border-slate-200 bg-white px-1 py-0.5 shadow-sm transition ${selected || editing ? "opacity-100" : "opacity-0 group-hover/object:opacity-100 focus-within:opacity-100"}`}
          >
            <span data-drag-handle draggable title="Drag to move" className="cursor-grab px-1 text-slate-500 active:cursor-grabbing" aria-hidden>
              ⋮⋮
            </span>
            <span className="px-1 text-xs font-medium text-slate-500">
              {ui.menu.icon} {label}
            </span>
            <button
              type="button"
              onClick={() => (editing ? closeEditor() : setEditing(true))}
              className="rounded px-2 py-0.5 text-xs font-semibold text-brand hover:bg-brand/5"
            >
              {editing ? "Done" : "Edit"}
            </button>
            <IconButton label="Insert line below" onClick={insertLineBelow}>
              ↵
            </IconButton>
            <IconButton label="Move up" onClick={() => move(-1)}>
              ↑
            </IconButton>
            <IconButton label="Move down" onClick={() => move(1)}>
              ↓
            </IconButton>
            {!ui.singleton && (
              <IconButton label="Duplicate" onClick={duplicate}>
                ⧉
              </IconButton>
            )}
            <IconButton label={attrs.hidden ? "Show to client" : "Hide from client"} onClick={() => updateAttributes({ hidden: !attrs.hidden })}>
              {attrs.hidden ? "◌" : "◉"}
            </IconButton>
            <IconButton label="Delete" tone="danger" onClick={deleteNode}>
              🗑
            </IconButton>
          </div>
        )}

        {attrs.hidden && <div className="mb-2 inline-block rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">Hidden from client</div>}

        {editing && editable ? (
          <div
            ref={formRef}
            data-object-editor
            className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-ink"
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                closeEditor();
              }
            }}
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-700">
                {ui.menu.icon} {label}
              </h3>
              <span className="text-xs text-slate-500">Esc to close</span>
            </div>
            <ui.Editor
              blockId={blockId}
              props={attrs.props as never}
              aux={attrs.aux as never}
              onChange={(props) => updateAttributes({ props })}
              onUpdate={({ props, aux }) => updateAttributes({ props, aux })}
            />
          </div>
        ) : (
          <div className={attrs.hidden ? "opacity-50" : ""} onDoubleClick={() => editable && setEditing(true)}>
            <ui.Renderer blockId={blockId} props={attrs.props as never} />
          </div>
        )}
      </div>
    </NodeViewWrapper>
  );
}
