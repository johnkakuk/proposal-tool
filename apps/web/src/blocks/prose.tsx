import { blockRegistry } from "@bridger/shared";
import { Markdown } from "../render/Markdown";
import { MarkdownInput, SelectInput, TextInput } from "./fields";
import type { BlockUI } from "./types";

/**
 * Prose is typed straight into the editor (markdown shortcuts: "## " for a heading,
 * "- " for a list, **bold**…), so these don't appear in the slash menu. Their Editor is
 * only used for prose the author has hidden from the client.
 */

export const text: BlockUI<"text"> = {
  type: "text",
  hiddenFromMenu: true,
  menu: { description: blockRegistry.text.description, icon: "¶", keywords: ["paragraph"], group: "Basics" },
  Renderer: ({ props }) => <Markdown>{props.markdown}</Markdown>,
  Editor: ({ props, onChange }) => <MarkdownInput label="Text" value={props.markdown} onChange={(markdown) => onChange({ markdown })} rows={8} />,
};

export const heading: BlockUI<"heading"> = {
  type: "heading",
  hiddenFromMenu: true,
  menu: { description: blockRegistry.heading.description, icon: "H", keywords: ["title"], group: "Basics" },
  Renderer: ({ props }) => {
    const Tag = (`h${props.level}` as "h1" | "h2" | "h3");
    return (
      <div className="proposal-prose">
        <Tag>{props.text}</Tag>
      </div>
    );
  },
  Editor: ({ props, onChange }) => (
    <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
      <TextInput label="Heading" value={props.text} onChange={(text) => onChange({ ...props, text })} />
      <SelectInput
        label="Level"
        value={props.level}
        options={[1, 2, 3].map((l) => ({ value: l as 1 | 2 | 3, label: `Heading ${l}` }))}
        onChange={(level) => onChange({ ...props, level })}
      />
    </div>
  ),
};
