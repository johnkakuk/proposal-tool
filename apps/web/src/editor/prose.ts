import { MarkdownManager } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";

/**
 * Prose nodes and marks allowed in proposals: the limited Markdown subset from SPEC §5.2
 * (headings 1–3, bold, italic, links, bullet/numbered lists, blockquotes, line breaks).
 * Code, strikethrough, underline, and horizontal rules are off; dividers are objects.
 */
export const proseKit = StarterKit.configure({
  code: false,
  codeBlock: false,
  strike: false,
  underline: false,
  horizontalRule: false,
  heading: { levels: [1, 2, 3] },
  link: { openOnClick: false, autolink: true, defaultProtocol: "https" },
});

/** Top-level prose node types that carry a stable `blockId`. */
export const PROSE_BLOCK_TYPES = ["paragraph", "heading", "bulletList", "orderedList", "blockquote"] as const;

/** Headless Markdown ⇄ ProseMirror JSON, shared by the editor and the converters. */
export const markdown = new MarkdownManager({ extensions: [proseKit] });
