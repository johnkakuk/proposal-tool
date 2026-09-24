import { Markdown } from "../render/Markdown";
import { ListEditor, MarkdownInput, TextInput } from "./fields";
import type { BlockUI } from "./types";

export const faq: BlockUI<"faq"> = {
  type: "faq",
  menu: { description: "Questions and answers", icon: "❓", keywords: ["questions", "answers", "accordion"], group: "Content" },
  Renderer: ({ props }) => (
    <div className="divide-y divide-black/10 rounded-lg border border-black/10">
      {props.items.map((item, i) => (
        <details key={i} className="group p-4">
          <summary className="cursor-pointer list-none font-semibold marker:hidden">
            <span className="mr-2 inline-block transition group-open:rotate-90">›</span>
            {item.q}
          </summary>
          <Markdown className="mt-2 pl-5">{item.a}</Markdown>
        </details>
      ))}
    </div>
  ),
  Editor: ({ props, onChange }) => (
    <ListEditor
      itemLabel="Question"
      items={props.items}
      onChange={(items) => onChange({ items })}
      newItem={() => ({ q: "", a: "" })}
      renderItem={(item, update) => (
        <>
          <TextInput label="Question" value={item.q} onChange={(q) => update({ ...item, q })} />
          <MarkdownInput label="Answer" value={item.a} onChange={(a) => update({ ...item, a })} rows={3} />
        </>
      )}
    />
  ),
};
