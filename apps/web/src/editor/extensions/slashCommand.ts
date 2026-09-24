import { computePosition, flip, offset, shift } from "@floating-ui/dom";
import { Extension } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import { ReactRenderer } from "@tiptap/react";
import Suggestion, { exitSuggestion, type SuggestionProps } from "@tiptap/suggestion";
import { SlashMenu, type SlashMenuHandle } from "../SlashMenu";
import { allSlashItems, filterSlashItems, type SlashItem } from "../slashItems";

const SLASH_KEY = new PluginKey("slashCommand");

/** Typing "/" at the start of a line or after a space opens the insert menu. */
export const SlashCommand = Extension.create({
  name: "slashCommand",

  addProseMirrorPlugins() {
    return [
      Suggestion<SlashItem, SlashItem>({
        editor: this.editor,
        pluginKey: SLASH_KEY,
        char: "/",
        allowSpaces: false,
        // Only in top-level paragraphs/headings, not inside lists or quotes.
        allow: ({ state, range }) => state.doc.resolve(range.from).depth === 1,
        items: ({ query, editor }) => filterSlashItems(allSlashItems(editor), query),
        command: ({ editor, range, props: item }) => item.run(editor, range),
        render: () => {
          let renderer: ReactRenderer<SlashMenuHandle> | null = null;
          const place = (props: SuggestionProps<SlashItem, SlashItem>) => {
            const rect = props.clientRect?.();
            const el = renderer?.element as HTMLElement | undefined;
            if (!rect || !el) return;
            void computePosition({ getBoundingClientRect: () => rect }, el, { placement: "bottom-start", strategy: "fixed", middleware: [offset(6), flip(), shift({ padding: 8 })] }).then(
              ({ x, y }) => Object.assign(el.style, { left: `${x}px`, top: `${y}px` }),
            );
          };
          return {
            onStart: (props) => {
              renderer = new ReactRenderer(SlashMenu, { props, editor: props.editor });
              const el = renderer.element as HTMLElement;
              Object.assign(el.style, { position: "fixed", zIndex: "50", left: "0", top: "0" });
              document.body.appendChild(el);
              place(props);
            },
            onUpdate: (props) => {
              renderer?.updateProps(props);
              place(props);
            },
            onKeyDown: ({ event, view }) => {
              if (event.key === "Escape") {
                exitSuggestion(view, SLASH_KEY);
                return true;
              }
              return renderer?.ref?.onKeyDown(event) ?? false;
            },
            onExit: () => {
              (renderer?.element as HTMLElement | undefined)?.remove();
              renderer?.destroy();
              renderer = null;
            },
          };
        },
      }),
    ];
  },
});
