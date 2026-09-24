import { EditorGrid, OptionalTextInput, TextArea, TextInput } from "./fields";
import type { BlockUI } from "./types";

export const testimonial: BlockUI<"testimonial"> = {
  type: "testimonial",
  menu: { description: "A client quote", icon: "💬", keywords: ["quote", "review", "social proof"], group: "Content" },
  Renderer: ({ props }) => (
    <figure className="mx-auto max-w-2xl rounded-xl bg-(--color-primary)/5 p-8 text-center">
      <blockquote className="font-(family-name:--font-heading) text-xl leading-relaxed">“{props.quote}”</blockquote>
      <figcaption className="mt-6 flex items-center justify-center gap-3 text-sm">
        {props.avatarUrl && <img src={props.avatarUrl} alt="" className="size-10 rounded-full object-cover" />}
        <span>
          <strong>{props.author}</strong>
          {(props.role || props.company) && <span className="opacity-70"> · {[props.role, props.company].filter(Boolean).join(", ")}</span>}
        </span>
      </figcaption>
    </figure>
  ),
  Editor: ({ props, onChange }) => {
    const set = <K extends keyof typeof props>(k: K) => (v: (typeof props)[K]) => onChange({ ...props, [k]: v });
    return (
      <div className="space-y-3">
        <TextArea label="Quote" value={props.quote} onChange={set("quote")} rows={3} />
        <EditorGrid>
          <TextInput label="Name" value={props.author} onChange={set("author")} />
          <TextInput label="Role" value={props.role} onChange={set("role")} />
          <TextInput label="Company" value={props.company} onChange={set("company")} />
          <OptionalTextInput label="Photo URL" value={props.avatarUrl} onChange={set("avatarUrl")} />
        </EditorGrid>
      </div>
    );
  },
};
