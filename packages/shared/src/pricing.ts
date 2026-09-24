import { mulDivRoundHalfUp, toHundredths } from "./money.js";
import {
  BILLING_CADENCES,
  type Billing,
  type Discount,
  type LineItem,
  type Pricing,
  type PricingSection,
  type Selections,
} from "./schemas/pricing.js";
import type { Issue } from "./validate.js";

/**
 * The pricing engine (§5.3). Pure, integer-cent math shared by the editor,
 * the public viewer, and the server. The server always recomputes with this
 * module and never trusts totals sent by a client.
 *
 * Order of operations:
 *   1. line subtotal = round(quantity × unitPrice)
 *   2. line discount (percent: round(subtotal × pct/100); amount: capped at subtotal)
 *   3. section subtotal per cadence = sum of selected line totals
 *   4. section discounts, applied in array order to the running cadence buckets
 *   5. proposal discounts, same rules, on the sum of section totals
 *   6. tax (display only) last, per cadence
 * Rounding is half-up to whole cents at every step.
 */

export type CadenceAmounts = Record<Billing, number>;

export interface AppliedDiscount {
  discountId: string;
  label: string;
  type: Discount["type"];
  value: number;
  appliesTo: Discount["appliesTo"];
  /** Total cents removed (sum of byCadence). */
  amountCents: number;
  byCadence: CadenceAmounts;
}

export interface LineResult {
  itemId: string;
  name: string;
  billing: Billing;
  quantity: number;
  unitPriceCents: number;
  unitLabel?: string;
  selected: boolean;
  subtotalCents: number;
  discount: { discountId: string; label: string; type: Discount["type"]; value: number; amountCents: number } | null;
  totalCents: number;
}

export interface SectionResult {
  sectionId: string;
  title: string;
  mode: PricingSection["mode"];
  /** Every item, selected or not, so the UI can show prices for unselected options. */
  lines: LineResult[];
  /** Sum of selected line totals, per cadence. */
  subtotal: CadenceAmounts;
  discounts: AppliedDiscount[];
  total: CadenceAmounts;
}

export interface PricingResult {
  currency: "USD";
  /** Normalized selections: every section, item IDs in section order. */
  selections: Selections;
  sections: SectionResult[];
  /** Sum of section totals, per cadence (before proposal-level discounts). */
  subtotal: CadenceAmounts;
  discounts: AppliedDiscount[];
  totalBeforeTax: CadenceAmounts;
  tax: { ratePct: number; byCadence: CadenceAmounts } | null;
  total: CadenceAmounts;
}

export class PricingError extends Error {
  constructor(public readonly issues: Issue[]) {
    super(issues.map((i) => i.message).join("; "));
    this.name = "PricingError";
  }
}

export const zeroCadences = (): CadenceAmounts => ({ one_time: 0, monthly: 0, quarterly: 0, yearly: 0 });

const RECURRING: readonly Billing[] = ["monthly", "quarterly", "yearly"];

function targetsOf(appliesTo: Discount["appliesTo"]): readonly Billing[] {
  if (appliesTo === "one_time") return ["one_time"];
  if (appliesTo === "recurring") return RECURRING;
  return BILLING_CADENCES;
}

// ---------------------------------------------------------------------------
// Selections
// ---------------------------------------------------------------------------

/**
 * Validates client selections and fills in defaults for sections the client
 * didn't send. Fixed sections always select every item. Unknown IDs are errors.
 */
export function resolveSelections(pricing: Pricing, selections: Selections = {}): { selections: Selections; issues: Issue[] } {
  const issues: Issue[] = [];
  const out: Selections = {};
  const sectionIds = new Set(pricing.sections.map((s) => s.id));

  for (const sid of Object.keys(selections)) {
    if (!sectionIds.has(sid)) issues.push({ path: `selections.${sid}`, message: `Unknown pricing section '${sid}'` });
  }

  for (const section of pricing.sections) {
    const provided = Object.hasOwn(selections, section.id) ? selections[section.id] : undefined;
    const itemIds = new Set(section.items.map((i) => i.id));
    if (provided) {
      for (const id of provided) {
        if (!itemIds.has(id)) {
          issues.push({ path: `selections.${section.id}`, message: `Unknown item '${id}' in pricing section '${section.id}'` });
        }
      }
    }

    let chosen: Set<string>;
    if (section.mode === "fixed") {
      chosen = itemIds;
    } else if (section.mode === "optional") {
      chosen = provided ? new Set(provided.filter((id) => itemIds.has(id))) : new Set(section.items.filter((i) => i.selectedByDefault).map((i) => i.id));
    } else {
      if (provided) {
        const unique = new Set(provided);
        if (unique.size !== 1) {
          issues.push({
            path: `selections.${section.id}`,
            message: `Pick exactly one option in '${section.title || section.id}' (got ${unique.size})`,
          });
        }
        chosen = new Set([...unique].filter((id) => itemIds.has(id)).slice(0, 1));
      } else {
        const def = section.items.find((i) => i.selectedByDefault) ?? section.items[0];
        chosen = new Set(def ? [def.id] : []);
      }
    }
    out[section.id] = section.items.filter((i) => chosen.has(i.id)).map((i) => i.id);
  }
  return { selections: out, issues };
}

// ---------------------------------------------------------------------------
// Math
// ---------------------------------------------------------------------------

export function lineSubtotalCents(item: Pick<LineItem, "quantity" | "unitPriceCents">): number {
  return mulDivRoundHalfUp(toHundredths(item.quantity), item.unitPriceCents, 100);
}

function percentOf(amount: number, pct: number): number {
  return mulDivRoundHalfUp(amount, toHundredths(pct), 10_000);
}

function computeLine(item: LineItem, selected: boolean): LineResult {
  const subtotal = lineSubtotalCents(item);
  let discount: LineResult["discount"] = null;
  if (item.discount) {
    const d = item.discount;
    const amount = d.type === "percent" ? percentOf(subtotal, d.value) : Math.min(d.value, subtotal);
    discount = { discountId: d.id, label: d.label, type: d.type, value: d.value, amountCents: amount };
  }
  return {
    itemId: item.id,
    name: item.name,
    billing: item.billing,
    quantity: item.quantity,
    unitPriceCents: item.unitPriceCents,
    ...(item.unitLabel !== undefined ? { unitLabel: item.unitLabel } : {}),
    selected,
    subtotalCents: subtotal,
    discount,
    totalCents: subtotal - (discount?.amountCents ?? 0),
  };
}

/**
 * How much of `discount` comes off each cadence bucket. Never takes a bucket below 0.
 * Percent: applied to each targeted bucket. Amount: capped at the targeted total and
 * split in proportion to bucket size; the rounding remainder goes on the largest bucket
 * (ties → first in cadence order).
 */
export function splitDiscount(buckets: CadenceAmounts, discount: Pick<Discount, "type" | "value" | "appliesTo">): CadenceAmounts {
  const out = zeroCadences();
  const targets = targetsOf(discount.appliesTo);

  if (discount.type === "percent") {
    for (const c of targets) out[c] = percentOf(buckets[c], discount.value);
    return out;
  }

  const total = targets.reduce((s, c) => s + buckets[c], 0);
  const amount = Math.min(discount.value, total);
  if (amount === 0) return out;

  let largest = targets[0]!;
  for (const c of targets) if (buckets[c] > buckets[largest]) largest = c;

  let allocated = 0;
  for (const c of targets) {
    if (c === largest) continue;
    out[c] = mulDivRoundHalfUp(amount, buckets[c], total);
    allocated += out[c];
  }
  out[largest] = amount - allocated;

  // Half-up rounding on several small buckets can push the remainder outside
  // [0, largest bucket]. Move the stray cents to/from other buckets, in cadence order.
  if (out[largest] > buckets[largest]) {
    let excess = out[largest] - buckets[largest];
    out[largest] = buckets[largest];
    for (const c of targets) {
      if (excess === 0) break;
      const room = buckets[c] - out[c];
      const take = Math.min(room, excess);
      out[c] += take;
      excess -= take;
    }
  } else if (out[largest] < 0) {
    let deficit = -out[largest];
    out[largest] = 0;
    for (const c of targets) {
      if (deficit === 0) break;
      const give = Math.min(out[c], deficit);
      out[c] -= give;
      deficit -= give;
    }
  }
  return out;
}

function applyDiscounts(start: CadenceAmounts, discounts: Discount[]): { applied: AppliedDiscount[]; total: CadenceAmounts } {
  const running = { ...start };
  const applied: AppliedDiscount[] = [];
  for (const d of discounts) {
    const byCadence = splitDiscount(running, d);
    let amount = 0;
    for (const c of BILLING_CADENCES) {
      running[c] -= byCadence[c];
      amount += byCadence[c];
    }
    applied.push({ discountId: d.id, label: d.label, type: d.type, value: d.value, appliesTo: d.appliesTo, amountCents: amount, byCadence });
  }
  return { applied, total: running };
}

function computeSection(section: PricingSection, selectedIds: readonly string[]): SectionResult {
  const selected = new Set(selectedIds);
  const lines = section.items.map((item) => computeLine(item, selected.has(item.id)));
  const subtotal = zeroCadences();
  for (const line of lines) if (line.selected) subtotal[line.billing] += line.totalCents;
  const { applied, total } = applyDiscounts(subtotal, section.discounts);
  return { sectionId: section.id, title: section.title, mode: section.mode, lines, subtotal, discounts: applied, total };
}

/** Computes all totals. Throws PricingError on invalid selections. `pricing` must already be Zod-parsed. */
export function computePricing(pricing: Pricing, selections?: Selections): PricingResult {
  const resolved = resolveSelections(pricing, selections);
  if (resolved.issues.length > 0) throw new PricingError(resolved.issues);

  const sections = pricing.sections.map((s) => computeSection(s, resolved.selections[s.id] ?? []));
  const subtotal = zeroCadences();
  for (const s of sections) for (const c of BILLING_CADENCES) subtotal[c] += s.total[c];

  const { applied, total: totalBeforeTax } = applyDiscounts(subtotal, pricing.discounts);

  let tax: PricingResult["tax"] = null;
  const total = { ...totalBeforeTax };
  if (pricing.taxRatePct !== undefined && pricing.taxRatePct > 0) {
    const byCadence = zeroCadences();
    for (const c of BILLING_CADENCES) {
      byCadence[c] = percentOf(totalBeforeTax[c], pricing.taxRatePct);
      total[c] += byCadence[c];
    }
    tax = { ratePct: pricing.taxRatePct, byCadence };
  }

  return { currency: "USD", selections: resolved.selections, sections, subtotal, discounts: applied, totalBeforeTax, tax, total };
}

export type SafePricingResult = { ok: true; result: PricingResult } | { ok: false; issues: Issue[] };

export function tryComputePricing(pricing: Pricing, selections?: Selections): SafePricingResult {
  try {
    return { ok: true, result: computePricing(pricing, selections) };
  } catch (e) {
    if (e instanceof PricingError) return { ok: false, issues: e.issues };
    throw e;
  }
}
