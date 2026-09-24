import { EditorGrid, ListEditor, SelectInput, TextArea, TextInput } from "./fields";
import { DELIVERABLE_ICONS, iconFor } from "./icons";
import type { BlockUI } from "./types";

export const deliverables: BlockUI<"deliverables"> = {
  type: "deliverables",
  menu: { description: "What the client gets", icon: "📦", keywords: ["scope", "includes", "what you get"], group: "Sales" },
  Renderer: ({ props }) => (
    <section>
      {props.title && <h2 className="proposal-h2">{props.title}</h2>}
      <div className="grid gap-4 @lg:grid-cols-2">
        {props.items.map((item, i) => (
          <div key={i} className="flex gap-3 rounded-lg border border-black/10 p-4">
            <span aria-hidden className="text-2xl leading-none">
              {iconFor(item.icon)}
            </span>
            <div>
              <h3 className="font-semibold">{item.title}</h3>
              <p className="mt-1 text-sm opacity-80">{item.description}</p>
            </div>
          </div>
        ))}
        {props.items.length === 0 && <p className="text-sm opacity-50">No deliverables yet.</p>}
      </div>
    </section>
  ),
  Editor: ({ props, onChange }) => (
    <div className="space-y-3">
      <TextInput label="Section title" value={props.title} onChange={(title) => onChange({ ...props, title })} />
      <ListEditor
        itemLabel="Deliverable"
        items={props.items}
        onChange={(items) => onChange({ ...props, items })}
        newItem={() => ({ title: "", description: "", icon: "check" })}
        renderItem={(item, update) => (
          <>
            <EditorGrid>
              <TextInput label="Title" value={item.title} onChange={(title) => update({ ...item, title })} />
              <SelectInput
                label="Icon"
                value={item.icon ?? "check"}
                options={Object.entries(DELIVERABLE_ICONS).map(([value, glyph]) => ({ value, label: `${glyph} ${value}` }))}
                onChange={(icon) => update({ ...item, icon })}
              />
            </EditorGrid>
            <TextArea label="Description" value={item.description} onChange={(description) => update({ ...item, description })} rows={2} />
          </>
        )}
      />
    </div>
  ),
};
