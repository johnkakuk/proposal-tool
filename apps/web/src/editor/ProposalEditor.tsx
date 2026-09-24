import type { Pricing, ProposalContent } from "@bridger/shared";
import type { Editor } from "@tiptap/core";
import { Placeholder } from "@tiptap/extensions";
import { EditorContent, useEditor } from "@tiptap/react";
import { useEffect, useRef } from "react";
import { fromEditorDocument, toEditorDocument, type SerializedDocument } from "./convert";
import { BlockIds } from "./extensions/blockIds";
import { ProposalObject } from "./extensions/proposalObject";
import { SlashCommand } from "./extensions/slashCommand";
import { proseKit } from "./prose";

interface Props {
  content: ProposalContent;
  pricing: Pricing;
  editable: boolean;
  /** Called with the serialized document on load and after every change. */
  onChange: (doc: SerializedDocument) => void;
  onEditor?: (editor: Editor | null) => void;
}

/**
 * The proposal writing surface: Markdown-style prose plus objects inserted with "/".
 * `content`/`pricing` are read once, when the editor mounts; remount (change `key`) to load
 * a different document.
 */
export function ProposalEditor({ content, pricing, editable, onChange, onEditor }: Props) {
  const initial = useRef(toEditorDocument(content, pricing));
  const theme = useRef(content.theme);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const editor = useEditor({
    extensions: [
      proseKit,
      BlockIds,
      ProposalObject,
      SlashCommand,
      Placeholder.configure({
        showOnlyCurrent: true,
        placeholder: ({ node }) => (node.type.name === "heading" ? "Heading" : "Write here, or type “/” to add pricing, deliverables, a timeline…"),
      }),
    ],
    content: initial.current.doc,
    editable,
    shouldRerenderOnTransaction: false,
    editorProps: { attributes: { class: "proposal-editor proposal-prose focus:outline-none", "aria-label": "Proposal content" } },
    onCreate: ({ editor }) => onChangeRef.current(fromEditorDocument(editor.getJSON(), initial.current.unplacedSections, theme.current)),
    onUpdate: ({ editor }) => onChangeRef.current(fromEditorDocument(editor.getJSON(), initial.current.unplacedSections, theme.current)),
  });

  useEffect(() => {
    editor?.setEditable(editable);
  }, [editor, editable]);

  useEffect(() => {
    onEditor?.(editor);
    return () => onEditor?.(null);
  }, [editor, onEditor]);

  return <EditorContent editor={editor} />;
}
