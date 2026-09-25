import { blockRegistry, formatCents, tryComputePricing, type Block, type Pricing, type ProposalContent } from "@bridger/shared";

/** Block- and price-level comparison of two versions (SPEC §7.3 "Versions", side-by-side diff). */
export interface VersionDiff {
  blocks: { kind: "added" | "removed" | "changed" | "moved"; label: string }[];
  pricing: { kind: "added" | "removed" | "changed"; label: string; detail?: string }[];
  totals: { before: string; after: string } | null;
}

const blockName = (b: Block) => {
  const p = b.props as Record<string, unknown>;
  const text = (p.text ?? p.title ?? p.heading ?? (typeof p.markdown === "string" ? p.markdown.slice(0, 40) : "")) as string;
  return `${blockRegistry[b.type].label}${text ? `: ${text.replace(/[#*_>]/g, "").trim()}` : ""}`;
};

const totalText = (p: Pricing) => {
  const r = tryComputePricing(p);
  if (!r.ok) return "—";
  const t = r.result.total;
  return [t.one_time ? formatCents(t.one_time) : "", t.monthly ? `${formatCents(t.monthly)}/mo` : "", t.quarterly ? `${formatCents(t.quarterly)}/qtr` : "", t.yearly ? `${formatCents(t.yearly)}/yr` : ""]
    .filter(Boolean)
    .join(" + ") || formatCents(0);
};

export function diffVersions(a: { content: ProposalContent; pricing: Pricing }, b: { content: ProposalContent; pricing: Pricing }): VersionDiff {
  const aBlocks = new Map(a.content.blocks.map((x, i) => [x.id, { x, i }]));
  const bBlocks = new Map(b.content.blocks.map((x, i) => [x.id, { x, i }]));
  const blocks: VersionDiff["blocks"] = [];
  for (const [id, { x }] of bBlocks) if (!aBlocks.has(id)) blocks.push({ kind: "added", label: blockName(x) });
  for (const [id, { x }] of aBlocks) if (!bBlocks.has(id)) blocks.push({ kind: "removed", label: blockName(x) });
  const common = a.content.blocks.filter((x) => bBlocks.has(x.id)).map((x) => x.id);
  const commonAfter = b.content.blocks.filter((x) => aBlocks.has(x.id)).map((x) => x.id);
  for (const id of common) {
    const before = aBlocks.get(id)!.x;
    const after = bBlocks.get(id)!.x;
    if (JSON.stringify(before.props) !== JSON.stringify(after.props) || Boolean(before.hidden) !== Boolean(after.hidden)) blocks.push({ kind: "changed", label: blockName(after) });
    else if (common.indexOf(id) !== commonAfter.indexOf(id)) blocks.push({ kind: "moved", label: blockName(after) });
  }

  const items = (p: Pricing) => new Map(p.sections.flatMap((s) => s.items.map((i) => [`${s.id}/${i.id}`, { s, i }] as const)));
  const aItems = items(a.pricing);
  const bItems = items(b.pricing);
  const pricing: VersionDiff["pricing"] = [];
  for (const [k, { s, i }] of bItems) if (!aItems.has(k)) pricing.push({ kind: "added", label: `${i.name} (${s.title})`, detail: formatCents(i.unitPriceCents) });
  for (const [k, { s, i }] of aItems) if (!bItems.has(k)) pricing.push({ kind: "removed", label: `${i.name} (${s.title})` });
  for (const [k, { i: before }] of aItems) {
    const after = bItems.get(k)?.i;
    if (!after) continue;
    const changes: string[] = [];
    if (before.unitPriceCents !== after.unitPriceCents) changes.push(`${formatCents(before.unitPriceCents)} → ${formatCents(after.unitPriceCents)}`);
    if (before.quantity !== after.quantity) changes.push(`qty ${before.quantity} → ${after.quantity}`);
    if (before.billing !== after.billing) changes.push(`${before.billing} → ${after.billing}`);
    if (JSON.stringify(before.discount ?? null) !== JSON.stringify(after.discount ?? null)) changes.push("discount changed");
    if (before.name !== after.name) changes.push(`renamed from “${before.name}”`);
    if (changes.length) pricing.push({ kind: "changed", label: after.name, detail: changes.join(", ") });
  }
  if (JSON.stringify(a.pricing.discounts) !== JSON.stringify(b.pricing.discounts)) pricing.push({ kind: "changed", label: "Proposal discounts" });
  const before = totalText(a.pricing);
  const after = totalText(b.pricing);
  return { blocks, pricing, totals: before !== after ? { before, after } : null };
}
