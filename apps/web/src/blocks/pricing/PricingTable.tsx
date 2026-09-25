import type { PricingResult, PricingSection, SectionResult } from "@bridger/shared";
import { Markdown } from "../../render/Markdown";
import { useRenderContext } from "../../render/RenderContext";
import { cadenceParts, formatQuantity, money } from "./format";

/** Client-facing pricing: sections, line items, discounts, and (optionally) proposal totals. */
export function PricingTable({ sectionIds, showTotals }: { sectionIds: string[]; showTotals: boolean }) {
  const { pricing, result, selections, onSelect } = useRenderContext();
  const sections = sectionIds.flatMap((id) => {
    const section = pricing.sections.find((s) => s.id === id);
    const computed = result?.sections.find((s) => s.sectionId === id);
    return section && computed ? [{ section, computed }] : [];
  });

  if (sections.length === 0) return <p className="rounded-lg border border-dashed border-black/20 p-6 text-center text-sm text-(--color-muted)">No pricing yet.</p>;

  return (
    <div className="space-y-8">
      {sections.map(({ section, computed }) => (
        <Section key={section.id} section={section} computed={computed} selected={new Set(selections[section.id] ?? [])} onSelect={onSelect} />
      ))}
      {showTotals && result && <Totals result={result} notes={pricing.notes} />}
    </div>
  );
}

function Section({ section, computed, selected, onSelect }: { section: PricingSection; computed: SectionResult; selected: Set<string>; onSelect?: (sectionId: string, ids: string[]) => void }) {
  const interactive = Boolean(onSelect) && section.mode !== "fixed";
  const toggle = (itemId: string) => {
    if (!onSelect) return;
    if (section.mode === "choose_one") onSelect(section.id, [itemId]);
    else onSelect(section.id, selected.has(itemId) ? [...selected].filter((x) => x !== itemId) : [...selected, itemId]);
  };

  return (
    <section>
      <header className="mb-3">
        <h3 className="font-(family-name:--font-heading) text-xl font-bold">{section.title}</h3>
        {section.mode === "optional" && <p className="text-sm text-(--color-muted)">Optional add-ons{interactive ? ": choose any" : ""}</p>}
        {section.mode === "choose_one" && <p className="text-sm text-(--color-muted)">Choose one</p>}
        {section.description && <Markdown className="mt-1 text-sm">{section.description}</Markdown>}
      </header>

      {section.mode === "choose_one" ? (
        <div role="radiogroup" aria-label={section.title} className={`grid gap-3 ${section.items.length >= 3 ? "@lg:grid-cols-3" : section.items.length === 2 ? "@lg:grid-cols-2" : ""}`}>
          {computed.lines.map((line, i) => {
            const item = section.items[i]!;
            const on = selected.has(line.itemId);
            return (
              <button
                key={line.itemId}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={!interactive}
                onClick={() => toggle(line.itemId)}
                className={`rounded-xl border-2 p-5 text-left transition ${on ? "border-(--color-accent) bg-(--color-accent)/5" : "border-black/10"} ${interactive ? "cursor-pointer hover:border-(--color-accent)/60" : "cursor-default"}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-semibold">{line.name}</span>
                  {on && <span className="rounded-full bg-(--color-accent) px-2 py-0.5 text-xs font-semibold text-(--color-on-accent)">Selected</span>}
                </div>
                <div className="mt-2 text-2xl font-bold tabular-nums">{money(line.totalCents, line.billing)}</div>
                {line.discount && <div className="text-sm line-through text-(--color-muted)">{money(line.subtotalCents, line.billing)}</div>}
                {item.description && <Markdown className="mt-2 text-sm text-(--color-muted)">{item.description}</Markdown>}
              </button>
            );
          })}
        </div>
      ) : (
        <ul className="divide-y divide-black/10 rounded-lg border border-black/10">
          {computed.lines.map((line, i) => {
            const item = section.items[i]!;
            const on = selected.has(line.itemId);
            const muted = section.mode === "optional" && !on;
            return (
              <li key={line.itemId} className={`flex gap-3 p-4 ${muted ? "text-(--color-muted)" : ""}`}>
                {section.mode === "optional" && (
                  <input type="checkbox" className="mt-1 size-4 accent-(--color-accent)" checked={on} disabled={!interactive} onChange={() => toggle(line.itemId)} aria-label={`Add ${line.name}`} />
                )}
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{line.name}</div>
                  {item.description && <Markdown className="text-sm text-(--color-muted)">{item.description}</Markdown>}
                  {(line.quantity !== 1 || item.unitLabel) && (
                    <div className="text-sm tabular-nums text-(--color-muted)">
                      {formatQuantity(line.quantity)}
                      {item.unitLabel ? ` ${item.unitLabel}` : ""} × {money(line.unitPriceCents)}
                    </div>
                  )}
                  {line.discount && line.discount.amountCents > 0 && (
                    <div className="text-sm text-(--color-accent-text)">
                      −{money(line.discount.amountCents)} {line.discount.label}
                    </div>
                  )}
                </div>
                <div className="text-right font-semibold tabular-nums">
                  {line.discount && line.discount.amountCents > 0 && <div className="text-sm font-normal line-through text-(--color-muted)">{money(line.subtotalCents, line.billing)}</div>}
                  {money(line.totalCents, line.billing)}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {computed.discounts.filter((d) => d.amountCents > 0).map((d) => (
        <div key={d.discountId} className="mt-2 flex justify-between px-4 text-sm text-(--color-accent-text)">
          <span>{d.label}</span>
          <span className="tabular-nums">−{money(d.amountCents)}</span>
        </div>
      ))}
    </section>
  );
}

function Totals({ result, notes }: { result: PricingResult; notes?: string }) {
  const hasAdjustments = result.discounts.some((d) => d.amountCents > 0) || result.tax !== null;
  return (
    <div className="rounded-xl bg-(--color-primary)/5 p-5">
      {hasAdjustments && (
        <dl className="mb-3 space-y-1 border-b border-black/10 pb-3 text-sm">
          <Row label="Subtotal" amounts={result.subtotal} />
          {result.discounts.filter((d) => d.amountCents > 0).map((d) => (
            <Row key={d.discountId} label={d.label} amounts={d.byCadence} negative className="text-(--color-accent-text)" />
          ))}
          {result.tax && <Row label={`Tax (${result.tax.ratePct}%)`} amounts={result.tax.byCadence} />}
        </dl>
      )}
      <dl>
        <Row label="Total" amounts={result.total} className="text-lg font-bold" />
      </dl>
      {notes && <Markdown className="mt-3 text-sm text-(--color-muted)">{notes}</Markdown>}
    </div>
  );
}

function Row({ label, amounts, negative, className }: { label: string; amounts: PricingResult["total"]; negative?: boolean; className?: string }) {
  return (
    <div className={`flex justify-between gap-4 ${className ?? ""}`}>
      <dt>{label}</dt>
      <dd className="text-right tabular-nums">
        {cadenceParts(amounts).map(([c, v]) => (
          <div key={c}>
            {negative ? "−" : ""}
            {money(v, c)}
          </div>
        ))}
      </dd>
    </div>
  );
}
