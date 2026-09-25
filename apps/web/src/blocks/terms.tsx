import { blockRegistry } from "@bridger/shared";
import { Markdown } from "../render/Markdown";
import { MarkdownInput, TextInput } from "./fields";
import type { BlockUI } from "./types";

export const terms: BlockUI<"terms"> = {
  type: "terms",
  menu: { description: "Terms and conditions", icon: "📜", keywords: ["legal", "conditions", "contract", "t&c"], group: "Sales" },
  create: ({ defaultTerms }) => ({ props: { ...blockRegistry.terms.defaultProps(), markdown: defaultTerms ?? "" }, aux: null }),
  Renderer: ({ props }) => (
    <section className="rounded-lg border border-black/10 p-6">
      <h2 className="proposal-h2 !mt-0">{props.title}</h2>
      <Markdown className="text-sm">{props.markdown}</Markdown>
    </section>
  ),
  Editor: ({ props, onChange }) => (
    <div className="space-y-3">
      <TextInput label="Title" value={props.title} onChange={(title) => onChange({ ...props, title })} />
      <MarkdownInput label="Terms" value={props.markdown} onChange={(markdown) => onChange({ ...props, markdown })} rows={10} />
    </div>
  ),
};
