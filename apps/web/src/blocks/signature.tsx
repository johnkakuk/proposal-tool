import { Markdown } from "../render/Markdown";
import { useRenderContext } from "../render/RenderContext";
import { MarkdownInput, Toggle } from "./fields";
import type { BlockUI } from "./types";

function SignatureRenderer({ props }: { props: { intro: string; showOwnerSignature: boolean } }) {
  const { ownerSignatureName } = useRenderContext();
  return (
    <section className="rounded-xl border-2 border-(--color-primary)/15 p-6 sm:p-8">
      <h2 className="proposal-h2 !mt-0">Accept this proposal</h2>
      {props.intro && <Markdown>{props.intro}</Markdown>}
      <div className={`mt-8 grid gap-8 ${props.showOwnerSignature ? "sm:grid-cols-2" : ""}`}>
        <div>
          {/* Phase 4 replaces this with the signing flow. */}
          <div className="flex h-16 items-end border-b border-black/30 pb-1 text-sm opacity-40">Client signature</div>
          <p className="mt-2 text-sm opacity-70">Signed electronically when the client accepts</p>
        </div>
        {props.showOwnerSignature && (
          <div>
            <div className="flex h-16 items-end border-b border-black/30 pb-1 font-['Caveat',cursive] text-3xl">{ownerSignatureName ?? ""}</div>
            <p className="mt-2 text-sm opacity-70">{ownerSignatureName ? `${ownerSignatureName}, Bridger Digital` : "Your signature (set it up in Settings)"}</p>
          </div>
        )}
      </div>
    </section>
  );
}

export const signature: BlockUI<"signature"> = {
  type: "signature",
  singleton: true,
  menu: { description: "Where the client signs. Keep it last.", icon: "✍️", keywords: ["sign", "accept", "agreement", "e-signature"], group: "Sales" },
  Renderer: SignatureRenderer,
  Editor: ({ props, onChange }) => (
    <div className="space-y-3">
      <MarkdownInput label="Intro" value={props.intro} onChange={(intro) => onChange({ ...props, intro })} rows={3} />
      <Toggle label="Show my signature next to the client's" checked={props.showOwnerSignature} onChange={(showOwnerSignature) => onChange({ ...props, showOwnerSignature })} />
    </div>
  ),
};
