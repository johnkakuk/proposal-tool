import { checkPublishable, type Pricing, type ProposalContent, type Theme } from "@bridger/shared";
import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { DiscountList } from "../blocks/pricing/PricingEditor";
import { cadenceParts, money } from "../blocks/pricing/format";
import { NumberInput } from "../blocks/fields";
import { ProposalEditor } from "../editor/ProposalEditor";
import { assemblePricing, type SerializedDocument } from "../editor/convert";
import { ProposalBlocks, RenderProvider, useRenderContextValue } from "../render/ProposalRenderer";
import { Button, inputClass } from "../components/ui";
import type { InsertContext } from "../blocks/types";
import type { SaveState } from "./useAutosave";

type Device = "desktop" | "mobile";

export interface DocumentWorkspaceProps {
  initialContent: ProposalContent;
  initialPricing: Pricing;
  readOnly?: boolean;
  /** Receives the full document (content + pricing) after every change. */
  onDocumentChange: (doc: { content: ProposalContent; pricing: Pricing }) => void;
  saveState: SaveState;
  onRetrySave?: () => void;
  brand: Theme | null;
  ownerSignatureName?: string;
  /** Workspace defaults for objects inserted with "/". */
  insertContext?: InsertContext;
  /** Left side of the top bar (back link, title). */
  heading: ReactNode;
  /** Right side of the top bar (page actions). */
  actions?: ReactNode;
  /** Cards at the top of the sidebar (details, client, expiry…). */
  sidebar?: ReactNode;
  /** Whether to show the publish checklist, and the client-email input to it. */
  publishCheck?: { clientHasEmail: boolean };
  banner?: ReactNode;
  /** Replaces the sidebar (e.g. the analytics drawer). */
  drawer?: ReactNode;
  /** Replaces the editing canvas (e.g. a heatmap or an older version). The editor stays mounted. */
  canvasOverride?: ReactNode;
}

export function DocumentWorkspace(p: DocumentWorkspaceProps) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [device, setDevice] = useState<Device>("desktop");
  const [preview, setPreview] = useState(false);
  const [doc, setDoc] = useState<SerializedDocument | null>(null);
  const [meta, setMeta] = useState<Omit<Pricing, "sections">>(() => {
    const { sections: _sections, ...rest } = p.initialPricing;
    return rest;
  });

  const pricing = useMemo(() => assemblePricing(doc?.sections ?? p.initialPricing.sections, meta), [doc, meta, p.initialPricing.sections]);
  const content = doc?.content ?? p.initialContent;

  // Report changes from the handlers themselves (not an effect), so a keystroke is a
  // single batched render instead of a chain of cascading updates.
  const latest = useRef({ doc, meta });
  latest.current = { doc, meta };
  const onDocumentChangeRef = useRef(p.onDocumentChange);
  onDocumentChangeRef.current = p.onDocumentChange;
  const report = (d: SerializedDocument | null, m: Omit<Pricing, "sections">) => {
    if (d) onDocumentChangeRef.current({ content: d.content, pricing: assemblePricing(d.sections, m) });
  };
  const handleDocChange = useCallback((d: SerializedDocument) => {
    setDoc(d);
    report(d, latest.current.meta);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const handleMetaChange = (m: Omit<Pricing, "sections">) => {
    setMeta(m);
    report(latest.current.doc, m);
  };

  const renderValue = useRenderContextValue(pricing, preview ? "preview" : "editor", { ownerSignatureName: p.ownerSignatureName });
  const history = useEditorState({ editor, selector: ({ editor: e }) => ({ canUndo: e?.can().undo() ?? false, canRedo: e?.can().redo() ?? false }) });
  const onEditor = useCallback((e: Editor | null) => setEditor(e), []);

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2">
          <div className="flex min-w-0 flex-1 items-center gap-3">{p.heading}</div>
          <SaveIndicator state={p.saveState} onRetry={p.onRetrySave} />
          <div className="flex items-center gap-1">
            <Button variant="ghost" aria-label="Undo" title="Undo (⌘Z)" disabled={p.readOnly || !history?.canUndo} onClick={() => editor?.chain().focus().undo().run()}>
              ↶
            </Button>
            <Button variant="ghost" aria-label="Redo" title="Redo (⌘⇧Z)" disabled={p.readOnly || !history?.canRedo} onClick={() => editor?.chain().focus().redo().run()}>
              ↷
            </Button>
          </div>
          <div role="group" aria-label="Preview width" className="flex rounded-md bg-slate-100 p-0.5">
            {(["desktop", "mobile"] as const).map((d) => (
              <button
                key={d}
                type="button"
                aria-pressed={device === d}
                onClick={() => setDevice(d)}
                className={`rounded px-2.5 py-1 text-xs font-medium capitalize ${device === d ? "bg-white shadow-xs" : "text-slate-600"}`}
              >
                {d}
              </button>
            ))}
          </div>
          <Button variant={preview ? "primary" : "secondary"} aria-pressed={preview} onClick={() => setPreview(!preview)}>
            {preview ? "Back to editing" : "Preview"}
          </Button>
          {p.actions}
        </div>
        {p.banner}
      </header>

      <div className="flex flex-1 flex-col lg:flex-row">
        <div className="min-w-0 flex-1 bg-slate-100/70 px-4 py-8">
          {p.canvasOverride}
          <div hidden={Boolean(p.canvasOverride)}>
          <RenderProvider value={renderValue} theme={p.brand} overrides={content.theme}>
            <div
              className={`@container mx-auto rounded-xl bg-(--color-background) shadow-sm ring-1 ring-slate-200 transition-[max-width] ${device === "mobile" ? "max-w-[390px] px-5 py-8" : "max-w-4xl px-8 py-12 sm:px-14"}`}
              data-device={device}
            >
              {/* The editor stays mounted in preview so undo history survives. */}
              <div hidden={preview}>
                <ProposalEditor content={p.initialContent} pricing={p.initialPricing} editable={!p.readOnly} onChange={handleDocChange} onEditor={onEditor} insertContext={p.insertContext} />
              </div>
              {preview && <ProposalBlocks content={content} />}
            </div>
          </RenderProvider>
          </div>
        </div>

        {p.drawer ?? (
        <aside className="w-full shrink-0 space-y-4 border-l border-slate-200 bg-white p-4 lg:sticky lg:top-[57px] lg:h-[calc(100vh-57px)] lg:w-80 lg:overflow-y-auto">
          {p.sidebar}
          <PricingSummary pricing={pricing} result={renderValue.result} meta={meta} onMetaChange={handleMetaChange} readOnly={p.readOnly} />
          {p.publishCheck && <PublishChecklist content={content} pricing={pricing} clientHasEmail={p.publishCheck.clientHasEmail} />}
        </aside>
        )}
      </div>
    </div>
  );
}

function SaveIndicator({ state, onRetry }: { state: SaveState; onRetry?: () => void }) {
  if (state.kind === "error") {
    return (
      <span role="alert" className="flex max-w-md items-center gap-2 text-xs text-red-700">
        <span className="line-clamp-2">Not saved: {state.error instanceof Error ? state.error.message : "error"}</span>
        {onRetry && (
          <button type="button" onClick={onRetry} className="shrink-0 font-semibold underline">
            Retry
          </button>
        )}
      </span>
    );
  }
  const text = { saved: "Saved", pending: "Unsaved changes", saving: "Saving…" }[state.kind];
  return (
    <span role="status" aria-live="polite" className={`text-xs ${state.kind === "saved" ? "text-slate-500" : "text-slate-600"}`}>
      {text}
    </span>
  );
}

export function SidebarCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 p-3">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
      {children}
    </section>
  );
}

function PricingSummary({
  pricing,
  result,
  meta,
  onMetaChange,
  readOnly,
}: {
  pricing: Pricing;
  result: ReturnType<typeof useRenderContextValue>["result"];
  meta: Omit<Pricing, "sections">;
  onMetaChange: (m: Omit<Pricing, "sections">) => void;
  readOnly?: boolean;
}) {
  return (
    <SidebarCard title="Pricing summary">
      {pricing.sections.length === 0 ? (
        <p className="text-sm text-slate-500">Type “/pricing” in the document to add a pricing table.</p>
      ) : result ? (
        <dl className="space-y-1 text-sm">
          <div className="flex justify-between gap-2">
            <dt className="text-slate-500">Total (default picks)</dt>
            <dd className="text-right font-semibold tabular-nums">
              {cadenceParts(result.total).map(([c, v]) => (
                <div key={c}>{money(v, c)}</div>
              ))}
            </dd>
          </div>
        </dl>
      ) : (
        <p className="text-sm text-red-700">Pricing can't be totaled yet. Check the package sections have a default.</p>
      )}
      {!readOnly && (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-medium text-slate-600">Proposal discounts, tax &amp; notes</summary>
          <div className="mt-3 space-y-3">
            <DiscountList discounts={meta.discounts} onChange={(discounts) => onMetaChange({ ...meta, discounts })} />
            <NumberInput label="Tax rate (display only)" suffix="%" max={100} value={meta.taxRatePct ?? 0} onChange={(v) => onMetaChange({ ...meta, taxRatePct: v || undefined })} />
            <label className="block text-xs font-medium text-slate-600">
              Notes under totals
              <textarea rows={2} className={`mt-1 ${inputClass}`} value={meta.notes ?? ""} onChange={(e) => onMetaChange({ ...meta, notes: e.target.value || undefined })} />
            </label>
          </div>
        </details>
      )}
    </SidebarCard>
  );
}

function PublishChecklist({ content, pricing, clientHasEmail }: { content: ProposalContent; pricing: Pricing; clientHasEmail: boolean }) {
  const issues = checkPublishable(content, pricing, { clientHasEmail });
  return (
    <SidebarCard title="Ready to publish?">
      {issues.length === 0 ? (
        <p className="text-sm text-emerald-700">✓ Everything required is in place.</p>
      ) : (
        <ul className="space-y-1.5 text-sm text-slate-700">
          {issues.map((i) => (
            <li key={i.path + i.message} className="flex gap-2">
              <span aria-hidden className="text-amber-500">•</span>
              <span>{i.message}</span>
            </li>
          ))}
        </ul>
      )}
    </SidebarCard>
  );
}
