import { useRenderContext } from "../render/RenderContext";
import { SelectInput } from "./fields";
import type { BlockUI } from "./types";

export const divider: BlockUI<"divider"> = {
  type: "divider",
  menu: { description: "A visual separator", icon: "➖", keywords: ["line", "separator", "hr", "rule", "spacer"], group: "Layout" },
  Renderer: ({ props }) =>
    props.style === "space" ? (
      <div className="h-12" />
    ) : props.style === "dots" ? (
      <div className="py-4 text-center tracking-[1em] text-(--color-muted)">•••</div>
    ) : (
      <hr className="my-4 border-black/15" />
    ),
  Editor: ({ props, onChange }) => (
    <SelectInput
      label="Style"
      value={props.style}
      options={[
        { value: "line", label: "Line" },
        { value: "dots", label: "Dots" },
        { value: "space", label: "Blank space" },
      ]}
      onChange={(style) => onChange({ style })}
    />
  ),
};

function PageBreakRenderer() {
  const { mode } = useRenderContext();
  if (mode === "print") return <div style={{ breakAfter: "page" }} />;
  if (mode === "editor") return <div className="border-t-2 border-dashed border-slate-300 pt-1 text-center text-xs text-slate-500">Page break (PDF only)</div>;
  return null;
}

export const page_break: BlockUI<"page_break"> = {
  type: "page_break",
  menu: { description: "Start a new page in the PDF", icon: "📄", keywords: ["pdf", "print", "new page"], group: "Layout" },
  Renderer: PageBreakRenderer,
  Editor: () => <p className="text-sm text-slate-500">Starts a new page in the PDF. Invisible on the web.</p>,
};
