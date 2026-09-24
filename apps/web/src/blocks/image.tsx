import { OptionalTextInput, SelectInput, TextInput } from "./fields";
import type { BlockUI } from "./types";

const WIDTH = { normal: "max-w-2xl", wide: "max-w-4xl", full: "max-w-none" } as const;

export const image: BlockUI<"image"> = {
  type: "image",
  menu: { description: "A photo or graphic", icon: "🖼️", keywords: ["picture", "photo", "graphic"], group: "Media" },
  Renderer: ({ props }) => (
    <figure className={`mx-auto ${WIDTH[props.width]}`}>
      {props.url ? (
        <img src={props.url} alt={props.alt} className="w-full rounded-lg" />
      ) : (
        <div className="flex aspect-video items-center justify-center rounded-lg bg-slate-100 text-sm text-slate-400">Add an image URL</div>
      )}
      {props.caption && <figcaption className="mt-2 text-center text-sm opacity-70">{props.caption}</figcaption>}
    </figure>
  ),
  Editor: ({ props, onChange }) => (
    <div className="space-y-3">
      <TextInput label="Image URL" value={props.url} onChange={(url) => onChange({ ...props, url })} placeholder="https://…" />
      <TextInput label="Alt text" hint="Describes the image for screen readers" value={props.alt} onChange={(alt) => onChange({ ...props, alt })} />
      <OptionalTextInput label="Caption" value={props.caption} onChange={(caption) => onChange({ ...props, caption })} />
      <SelectInput
        label="Width"
        value={props.width}
        options={[
          { value: "normal", label: "Normal" },
          { value: "wide", label: "Wide" },
          { value: "full", label: "Full width" },
        ]}
        onChange={(width) => onChange({ ...props, width })}
      />
    </div>
  ),
};
