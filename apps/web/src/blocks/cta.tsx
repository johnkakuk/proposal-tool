import { useRenderContext } from "../render/RenderContext";
import { TextArea, TextInput } from "./fields";
import type { BlockUI } from "./types";

function CtaRenderer({ props }: { props: { heading: string; body: string; buttonLabel: string } }) {
  const { mode } = useRenderContext();
  return (
    <section className="rounded-xl bg-(--color-primary) px-8 py-12 text-center text-(--color-on-primary)">
      <h2 className="font-(family-name:--font-heading) text-3xl font-bold">{props.heading}</h2>
      {props.body && <p className="mx-auto mt-3 max-w-xl opacity-90">{props.body}</p>}
      {mode !== "print" && (
        <button
          type="button"
          className="mt-6 rounded-md bg-(--color-accent) px-6 py-3 font-semibold text-(--color-on-accent) shadow-sm hover:brightness-110"
          onClick={() => mode !== "editor" && document.querySelector("[data-block-type='signature']")?.scrollIntoView({ behavior: "smooth" })}
        >
          {props.buttonLabel || "Accept proposal"}
        </button>
      )}
    </section>
  );
}

export const cta: BlockUI<"cta"> = {
  type: "cta",
  menu: { description: "Closing pitch with an Accept button", icon: "👉", keywords: ["call to action", "button", "accept", "close"], group: "Sales" },
  Renderer: CtaRenderer,
  Editor: ({ props, onChange }) => (
    <div className="space-y-3">
      <TextInput label="Heading" value={props.heading} onChange={(heading) => onChange({ ...props, heading })} />
      <TextArea label="Body" value={props.body} onChange={(body) => onChange({ ...props, body })} rows={2} />
      <TextInput label="Button label" hint="The button scrolls to the signature" value={props.buttonLabel} onChange={(buttonLabel) => onChange({ ...props, buttonLabel })} />
    </div>
  ),
};
