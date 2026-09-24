import { Markdown } from "../render/Markdown";
import { ListEditor, MarkdownInput, OptionalTextInput } from "./fields";
import type { BlockUI } from "./types";

export const columns: BlockUI<"columns"> = {
  type: "columns",
  menu: { description: "2 or 3 side-by-side columns", icon: "▥", keywords: ["side by side", "compare", "grid"], group: "Layout" },
  Renderer: ({ props }) => (
    <div className={`grid gap-6 ${props.columns.length === 3 ? "@lg:grid-cols-3" : "@lg:grid-cols-2"}`}>
      {props.columns.map((c, i) => (
        <div key={i}>
          {c.imageUrl && <img src={c.imageUrl} alt="" className="mb-3 w-full rounded-lg" />}
          <Markdown>{c.markdown}</Markdown>
        </div>
      ))}
    </div>
  ),
  Editor: ({ props, onChange }) => (
    <ListEditor<(typeof props.columns)[number]>
      itemLabel="Column"
      min={2}
      max={3}
      items={props.columns}
      onChange={(columns) => onChange({ columns })}
      newItem={() => ({ markdown: "" })}
      renderItem={(c, update) => (
        <>
          <MarkdownInput label="Content" value={c.markdown} onChange={(markdown) => update({ ...c, markdown })} rows={4} />
          <OptionalTextInput label="Image URL (optional)" value={c.imageUrl} onChange={(imageUrl) => update({ ...c, imageUrl })} />
        </>
      )}
    />
  ),
};
