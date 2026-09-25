import { EditorGrid, ListEditor, TextArea, TextInput } from "./fields";
import type { BlockUI } from "./types";

export const timeline: BlockUI<"timeline"> = {
  type: "timeline",
  menu: { description: "Project phases and durations", icon: "🗓️", keywords: ["schedule", "phases", "roadmap", "process"], group: "Sales" },
  Renderer: ({ props }) => (
    <ol className="relative ml-2 space-y-6 border-l-2 border-(--color-accent)/40 pl-6">
      {props.phases.map((p, i) => (
        <li key={i} className="relative">
          <span className="absolute -left-[33px] flex size-4 items-center justify-center rounded-full bg-(--color-accent) ring-4 ring-(--color-background)" />
          <div className="flex flex-wrap items-baseline gap-x-3">
            <h3 className="font-semibold">{p.title}</h3>
            {p.duration && <span className="text-sm text-(--color-muted)">{p.duration}</span>}
          </div>
          {p.description && <p className="mt-1 text-sm text-(--color-muted)">{p.description}</p>}
        </li>
      ))}
      {props.phases.length === 0 && <li className="text-sm text-(--color-muted)">No phases yet.</li>}
    </ol>
  ),
  Editor: ({ props, onChange }) => (
    <ListEditor
      itemLabel="Phase"
      items={props.phases}
      onChange={(phases) => onChange({ phases })}
      newItem={() => ({ title: "", duration: "", description: "" })}
      renderItem={(p, update) => (
        <>
          <EditorGrid>
            <TextInput label="Phase" value={p.title} onChange={(title) => update({ ...p, title })} />
            <TextInput label="Duration" value={p.duration} onChange={(duration) => update({ ...p, duration })} placeholder="2 weeks" />
          </EditorGrid>
          <TextArea label="Description" value={p.description} onChange={(description) => update({ ...p, description })} rows={2} />
        </>
      )}
    />
  ),
};
