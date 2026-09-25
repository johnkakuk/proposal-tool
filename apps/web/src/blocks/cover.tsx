import { formatIsoDate } from "../render/format";
import { EditorGrid, OptionalTextInput, TextInput } from "./fields";
import type { BlockUI } from "./types";

export const cover: BlockUI<"cover"> = {
  type: "cover",
  menu: { description: "Title page with the client's name", icon: "🏁", keywords: ["title", "hero", "front page"], group: "Layout" },
  Renderer: ({ props }) => (
    <section
      className="relative overflow-hidden rounded-xl bg-(--color-primary) bg-cover bg-center px-8 py-16 text-(--color-on-primary) @lg:px-12 @lg:py-24"
      style={props.backgroundImageUrl ? { backgroundImage: `linear-gradient(rgb(0 0 0 / .55), rgb(0 0 0 / .55)), url("${props.backgroundImageUrl}")` } : undefined}
    >
      {props.clientLogoUrl && <img src={props.clientLogoUrl} alt="" className="mb-10 h-12 w-auto object-contain" />}
      <p className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-(--color-accent-on-primary)">Proposal{props.clientName ? ` for ${props.clientName}` : ""}</p>
      <h1 className="font-(family-name:--font-heading) text-4xl leading-tight font-bold @lg:text-5xl">{props.title || "Untitled proposal"}</h1>
      {props.subtitle && <p className="mt-4 max-w-2xl text-lg opacity-90">{props.subtitle}</p>}
      <div className="mt-12 flex flex-wrap gap-x-10 gap-y-2 text-sm opacity-90">
        {props.preparedBy && <span>Prepared by {props.preparedBy}</span>}
        {props.date && <span>{formatIsoDate(props.date)}</span>}
      </div>
    </section>
  ),
  Editor: ({ props, onChange }) => {
    const set = <K extends keyof typeof props>(k: K) => (v: (typeof props)[K]) => onChange({ ...props, [k]: v });
    return (
      <EditorGrid>
        <TextInput label="Title" value={props.title} onChange={set("title")} />
        <TextInput label="Subtitle" value={props.subtitle} onChange={set("subtitle")} />
        <TextInput label="Client name" value={props.clientName} onChange={set("clientName")} />
        <TextInput label="Prepared by" value={props.preparedBy} onChange={set("preparedBy")} />
        <TextInput label="Date" type="date" value={props.date} onChange={set("date")} />
        <OptionalTextInput label="Client logo URL" value={props.clientLogoUrl} onChange={set("clientLogoUrl")} placeholder="https://…" />
        <OptionalTextInput label="Background image URL" value={props.backgroundImageUrl} onChange={set("backgroundImageUrl")} placeholder="https://…" />
      </EditorGrid>
    );
  },
};
