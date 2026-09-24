import {
  newDiscountId,
  newItemId,
  newSectionId,
  tryComputePricing,
  type Billing,
  type Discount,
  type LineItem,
  type PricingSection,
} from "@bridger/shared";
import { useState } from "react";
import { AddButton, IconButton, MarkdownInput, MoneyInput, NumberInput, SelectInput, TextInput, Toggle } from "../fields";
import { CADENCE_LABEL, cadenceParts, money } from "./format";

export const newLineItem = (): LineItem => ({ id: newItemId(), name: "", quantity: 1, unitPriceCents: 0, billing: "one_time", selectedByDefault: false });

export const newPricingSection = (): PricingSection => ({
  id: newSectionId(),
  title: "Investment",
  mode: "fixed",
  items: [{ ...newLineItem(), selectedByDefault: true }],
  discounts: [],
});

const MODE_OPTIONS = [
  { value: "fixed" as const, label: "Fixed: everything included" },
  { value: "optional" as const, label: "Optional add-ons: client picks any" },
  { value: "choose_one" as const, label: "Packages: client picks one" },
];
const BILLING_OPTIONS = (Object.keys(CADENCE_LABEL) as Billing[]).map((value) => ({ value, label: CADENCE_LABEL[value] }));

/** Keeps a section valid when its mode changes (choose_one needs ≥1 item and ≤1 default). */
function withMode(section: PricingSection, mode: PricingSection["mode"]): PricingSection {
  let items = section.items;
  if (mode === "choose_one") {
    if (items.length === 0) items = [newLineItem()];
    const firstDefault = Math.max(0, items.findIndex((i) => i.selectedByDefault));
    items = items.map((i, idx) => ({ ...i, selectedByDefault: idx === firstDefault }));
  }
  return { ...section, mode, items };
}

export function SectionEditor({ section, onChange, onRemove }: { section: PricingSection; onChange: (s: PricingSection) => void; onRemove: () => void }) {
  const computed = tryComputePricing({ currency: "USD", sections: [section], discounts: [] });
  const lines = computed.ok ? computed.result.sections[0]!.lines : [];
  const setItem = (i: number, item: LineItem) => onChange({ ...section, items: section.items.map((x, j) => (j === i ? item : x)) });
  const setDefault = (i: number, on: boolean) =>
    onChange({
      ...section,
      items: section.items.map((x, j) => (section.mode === "choose_one" ? { ...x, selectedByDefault: j === i } : j === i ? { ...x, selectedByDefault: on } : x)),
    });
  const moveItem = (i: number, d: number) => {
    const items = [...section.items];
    const [x] = items.splice(i, 1);
    items.splice(i + d, 0, x!);
    onChange({ ...section, items });
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4" data-testid="pricing-section-editor">
      <div className="grid gap-3 @lg:grid-cols-[1fr_16rem_auto]">
        <TextInput label="Section title" value={section.title} onChange={(title) => onChange({ ...section, title })} />
        <SelectInput label="Type" value={section.mode} options={MODE_OPTIONS} onChange={(mode) => onChange(withMode(section, mode))} />
        <div className="flex items-end">
          <IconButton label="Remove section" tone="danger" onClick={onRemove}>
            🗑
          </IconButton>
        </div>
      </div>

      <div className="mt-4">
        <div className="hidden grid-cols-[1.5rem_1fr_4.5rem_7rem_7rem_6.5rem_5.5rem] gap-2 px-1 pb-1 text-xs font-medium text-slate-500 @2xl:grid">
          <span title={section.mode === "fixed" ? "" : "Selected by default"}>{section.mode === "fixed" ? "" : "Def."}</span>
          <span>Item</span>
          <span>Qty</span>
          <span>Unit price</span>
          <span>Billing</span>
          <span className="text-right">Total</span>
          <span />
        </div>
        <div className="space-y-2">
          {section.items.map((item, i) => (
            <ItemRow
              key={item.id}
              item={item}
              mode={section.mode}
              total={lines[i]?.totalCents ?? 0}
              first={i === 0}
              last={i === section.items.length - 1}
              canRemove={section.mode !== "choose_one" || section.items.length > 1}
              onChange={(next) => setItem(i, next)}
              onDefault={(on) => setDefault(i, on)}
              onMove={(d) => moveItem(i, d)}
              onRemove={() => onChange({ ...section, items: section.items.filter((_, j) => j !== i) })}
            />
          ))}
        </div>
        <div className="mt-2">
          <AddButton onClick={() => onChange({ ...section, items: [...section.items, { ...newLineItem(), selectedByDefault: section.mode === "fixed" }] })}>Add line item</AddButton>
        </div>
      </div>

      <details className="mt-3 rounded-md bg-slate-50 px-3 py-2">
        <summary className="cursor-pointer text-sm font-medium text-slate-600">Description &amp; section discounts {section.discounts.length > 0 && `(${section.discounts.length})`}</summary>
        <div className="mt-3 space-y-3">
          <MarkdownInput label="Section description (optional)" value={section.description} onChange={(d) => onChange({ ...section, description: d || undefined })} rows={2} />
          <DiscountList discounts={section.discounts} onChange={(discounts) => onChange({ ...section, discounts })} />
        </div>
      </details>

      {computed.ok && (
        <div className="mt-3 flex justify-end gap-4 text-sm text-slate-600">
          <span>{section.mode === "fixed" ? "Section total" : "Section total (default picks)"}:</span>
          <span className="font-semibold tabular-nums text-ink">
            {cadenceParts(computed.result.sections[0]!.total)
              .map(([c, v]) => money(v, c))
              .join(" + ")}
          </span>
        </div>
      )}
    </div>
  );
}

function ItemRow(p: {
  item: LineItem;
  mode: PricingSection["mode"];
  total: number;
  first: boolean;
  last: boolean;
  canRemove: boolean;
  onChange: (i: LineItem) => void;
  onDefault: (on: boolean) => void;
  onMove: (d: number) => void;
  onRemove: () => void;
}) {
  const { item } = p;
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50/50 p-2">
      <div className="grid grid-cols-[1.5rem_1fr] items-center gap-2 @2xl:grid-cols-[1.5rem_1fr_4.5rem_7rem_7rem_6.5rem_5.5rem]">
        <span className="flex justify-center">
          {p.mode !== "fixed" && (
            <input
              type={p.mode === "choose_one" ? "radio" : "checkbox"}
              aria-label="Selected by default"
              title="Selected by default"
              className="size-4 accent-brand"
              checked={item.selectedByDefault}
              onChange={(e) => p.onDefault(e.target.checked)}
            />
          )}
        </span>
        <input
          aria-label="Item name"
          placeholder="Item name"
          className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
          value={item.name}
          onChange={(e) => p.onChange({ ...item, name: e.target.value })}
        />
        <div className="col-span-2 grid grid-cols-[4.5rem_1fr_1fr] gap-2 @2xl:contents">
          <NumberInput compact label="Quantity" value={item.quantity} max={1_000_000} onChange={(quantity) => p.onChange({ ...item, quantity })} />
          <MoneyInput compact label="Unit price" cents={item.unitPriceCents} onChange={(unitPriceCents) => p.onChange({ ...item, unitPriceCents })} />
          <select
            aria-label="Billing"
            className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
            value={item.billing}
            onChange={(e) => p.onChange({ ...item, billing: e.target.value as Billing })}
          >
            {BILLING_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <span className="hidden text-right text-sm font-semibold tabular-nums @2xl:block">{money(p.total, item.billing)}</span>
        <div className="col-span-2 flex justify-end @2xl:col-span-1">
          <IconButton label="More options" onClick={() => setOpen(!open)}>
            {open ? "▾" : "⋯"}
          </IconButton>
          <IconButton label="Move up" disabled={p.first} onClick={() => p.onMove(-1)}>
            ↑
          </IconButton>
          <IconButton label="Move down" disabled={p.last} onClick={() => p.onMove(1)}>
            ↓
          </IconButton>
          <IconButton label="Remove item" tone="danger" disabled={!p.canRemove} onClick={p.onRemove}>
            ✕
          </IconButton>
        </div>
      </div>
      {open && (
        <div className="mt-2 grid gap-3 border-t border-slate-200 pt-3 @lg:grid-cols-2">
          <TextInput label="Unit label" placeholder="hr, video, month…" value={item.unitLabel} onChange={(v) => p.onChange({ ...item, unitLabel: v || undefined })} />
          <div className="@lg:col-span-2">
            <MarkdownInput label="Description" value={item.description} onChange={(v) => p.onChange({ ...item, description: v || undefined })} rows={2} />
          </div>
          <div className="@lg:col-span-2">
            {item.discount ? (
              <DiscountFields discount={item.discount} lineLevel onChange={(discount) => p.onChange({ ...item, discount })} onRemove={() => p.onChange({ ...item, discount: undefined })} />
            ) : (
              <AddButton onClick={() => p.onChange({ ...item, discount: { id: newDiscountId(), label: "", type: "percent", value: 10, appliesTo: "all" } })}>Discount on this item</AddButton>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function DiscountList({ discounts, onChange }: { discounts: Discount[]; onChange: (d: Discount[]) => void }) {
  return (
    <div className="space-y-2">
      {discounts.map((d, i) => (
        <DiscountFields key={d.id} discount={d} onChange={(next) => onChange(discounts.map((x, j) => (j === i ? next : x)))} onRemove={() => onChange(discounts.filter((_, j) => j !== i))} />
      ))}
      <AddButton onClick={() => onChange([...discounts, { id: newDiscountId(), label: "", type: "percent", value: 10, appliesTo: "all" }])}>Add discount</AddButton>
    </div>
  );
}

export function DiscountFields({ discount, onChange, onRemove, lineLevel }: { discount: Discount; onChange: (d: Discount) => void; onRemove: () => void; lineLevel?: boolean }) {
  return (
    <div className={`grid items-end gap-2 rounded-md border border-slate-200 bg-white p-2 ${lineLevel ? "@lg:grid-cols-[1fr_7rem_7rem_auto]" : "@lg:grid-cols-[1fr_7rem_7rem_9rem_auto]"}`}>
      <TextInput label="Discount label" placeholder="Returning client discount" value={discount.label} onChange={(label) => onChange({ ...discount, label })} />
      <SelectInput
        label="Type"
        value={discount.type}
        options={[
          { value: "percent", label: "Percent" },
          { value: "amount", label: "Dollar amount" },
        ]}
        onChange={(type) => onChange({ ...discount, type, value: type === "percent" ? 10 : 10_000 })}
      />
      {discount.type === "percent" ? (
        <NumberInput label="Percent" suffix="%" max={100} value={discount.value} onChange={(value) => onChange({ ...discount, value })} />
      ) : (
        <MoneyInput label="Amount" cents={discount.value} onChange={(value) => onChange({ ...discount, value })} />
      )}
      {!lineLevel && (
        <SelectInput
          label="Applies to"
          value={discount.appliesTo}
          options={[
            { value: "all", label: "Everything" },
            { value: "one_time", label: "One-time only" },
            { value: "recurring", label: "Recurring only" },
          ]}
          onChange={(appliesTo) => onChange({ ...discount, appliesTo })}
        />
      )}
      <IconButton label="Remove discount" tone="danger" onClick={onRemove}>
        ✕
      </IconButton>
    </div>
  );
}

export function PricingBlockEditor({
  sections,
  showTotals,
  foreignSectionIds,
  onSectionsChange,
  onShowTotalsChange,
}: {
  sections: PricingSection[];
  showTotals: boolean;
  /** Sections this block displays but another pricing block owns. */
  foreignSectionIds: string[];
  onSectionsChange: (s: PricingSection[]) => void;
  onShowTotalsChange: (v: boolean) => void;
}) {
  return (
    <div className="space-y-3">
      {sections.map((s, i) => (
        <SectionEditor
          key={s.id}
          section={s}
          onChange={(next) => onSectionsChange(sections.map((x, j) => (j === i ? next : x)))}
          onRemove={() => {
            if (s.items.some((it) => it.name) && !window.confirm(`Remove the “${s.title || "untitled"}” pricing section?`)) return;
            onSectionsChange(sections.filter((_, j) => j !== i));
          }}
        />
      ))}
      {foreignSectionIds.length > 0 && <p className="text-xs text-slate-500">Also shows {foreignSectionIds.length} section(s) edited in another pricing table.</p>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <AddButton onClick={() => onSectionsChange([...sections, newPricingSection()])}>Add pricing section</AddButton>
        <Toggle label="Show proposal totals under this table" checked={showTotals} onChange={onShowTotalsChange} />
      </div>
    </div>
  );
}
