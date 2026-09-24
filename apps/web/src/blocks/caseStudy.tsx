import { Markdown } from "../render/Markdown";
import { EditorGrid, ListEditor, MarkdownInput, OptionalTextInput, TextInput } from "./fields";
import type { BlockUI } from "./types";

export const case_study: BlockUI<"case_study"> = {
  type: "case_study",
  menu: { description: "Challenge, solution, and results for a past client", icon: "📊", keywords: ["portfolio", "results", "success story"], group: "Content" },
  Renderer: ({ props }) => (
    <article className="overflow-hidden rounded-xl border border-black/10">
      {props.imageUrl && <img src={props.imageUrl} alt="" className="max-h-72 w-full object-cover" />}
      <div className="p-6 sm:p-8">
        <p className="text-sm font-semibold uppercase tracking-wide text-(--color-accent)">Case study · {props.client}</p>
        <h3 className="mt-1 font-(family-name:--font-heading) text-2xl font-bold">{props.title}</h3>
        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          <div>
            <h4 className="mb-1 font-semibold">The challenge</h4>
            <Markdown>{props.challenge}</Markdown>
          </div>
          <div>
            <h4 className="mb-1 font-semibold">What we did</h4>
            <Markdown>{props.solution}</Markdown>
          </div>
        </div>
        {props.results.length > 0 && (
          <ul className="mt-6 grid gap-2 sm:grid-cols-2">
            {props.results.map((r, i) => (
              <li key={i} className="rounded-md bg-(--color-accent)/10 px-3 py-2 font-medium">
                {r}
              </li>
            ))}
          </ul>
        )}
      </div>
    </article>
  ),
  Editor: ({ props, onChange }) => {
    const set = <K extends keyof typeof props>(k: K) => (v: (typeof props)[K]) => onChange({ ...props, [k]: v });
    return (
      <div className="space-y-3">
        <EditorGrid>
          <TextInput label="Title" value={props.title} onChange={set("title")} />
          <TextInput label="Client" value={props.client} onChange={set("client")} />
        </EditorGrid>
        <MarkdownInput label="Challenge" value={props.challenge} onChange={set("challenge")} rows={3} />
        <MarkdownInput label="Solution" value={props.solution} onChange={set("solution")} rows={3} />
        <OptionalTextInput label="Image URL" value={props.imageUrl} onChange={set("imageUrl")} />
        <ListEditor
          itemLabel="Result"
          items={props.results}
          onChange={set("results")}
          newItem={() => ""}
          renderItem={(r, update) => <TextInput label="Result" value={r} onChange={update} placeholder="3× inbound calls" />}
        />
      </div>
    );
  },
};
