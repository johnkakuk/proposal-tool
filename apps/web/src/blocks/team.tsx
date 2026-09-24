import { EditorGrid, ListEditor, TextArea, TextInput } from "./fields";
import type { BlockUI } from "./types";

export const team: BlockUI<"team"> = {
  type: "team",
  menu: { description: "The people on the project", icon: "👥", keywords: ["people", "crew", "staff", "bios"], group: "Content" },
  Renderer: ({ props }) => (
    <div className="grid gap-6 sm:grid-cols-3">
      {props.members.map((m, i) => (
        <div key={i} className="text-center">
          {m.photoUrl ? <img src={m.photoUrl} alt={m.name} className="mx-auto size-28 rounded-full object-cover" /> : <div className="mx-auto size-28 rounded-full bg-slate-200" />}
          <h3 className="mt-3 font-semibold">{m.name}</h3>
          <p className="text-sm opacity-70">{m.role}</p>
          {m.bio && <p className="mt-2 text-sm opacity-80">{m.bio}</p>}
        </div>
      ))}
    </div>
  ),
  Editor: ({ props, onChange }) => (
    <ListEditor<(typeof props.members)[number]>
      itemLabel="Person"
      items={props.members}
      onChange={(members) => onChange({ members })}
      newItem={() => ({ name: "", role: "", photoUrl: "" })}
      renderItem={(m, update) => (
        <>
          <EditorGrid>
            <TextInput label="Name" value={m.name} onChange={(name) => update({ ...m, name })} />
            <TextInput label="Role" value={m.role} onChange={(role) => update({ ...m, role })} />
          </EditorGrid>
          <TextInput label="Photo URL" value={m.photoUrl} onChange={(photoUrl) => update({ ...m, photoUrl })} />
          <TextArea label="Bio (optional)" value={m.bio} onChange={(bio) => update({ ...m, bio: bio || undefined })} rows={2} />
        </>
      )}
    />
  ),
};
