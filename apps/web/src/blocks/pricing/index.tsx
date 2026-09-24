import { newSectionId } from "@bridger/shared";
import type { BlockUI } from "../types";
import { PricingBlockEditor, newPricingSection } from "./PricingEditor";
import { PricingTable } from "./PricingTable";

/**
 * Pricing table object. In the editor, each pricing object *owns* its sections (held in
 * the node's `aux`), so adding, editing, or deleting the table is one undoable change.
 * On save, owned sections are collected into the proposal's `pricing.sections` and the
 * block keeps only `pricingSectionIds` (SPEC §5.3). See editor/convert.ts.
 */
export const pricing: BlockUI<"pricing"> = {
  type: "pricing",
  menu: { description: "Line items, add-ons, packages, and discounts", icon: "💲", keywords: ["price", "cost", "quote", "investment", "packages", "fees"], group: "Sales" },
  Renderer: ({ props }) => <PricingTable sectionIds={props.pricingSectionIds} showTotals={props.showTotals} />,
  Editor: ({ props, aux, onUpdate }) => {
    const owned = new Set(aux.sections.map((s) => s.id));
    return (
      <PricingBlockEditor
        sections={aux.sections}
        showTotals={props.showTotals}
        foreignSectionIds={props.pricingSectionIds.filter((id) => !owned.has(id))}
        onShowTotalsChange={(showTotals) => onUpdate({ props: { ...props, showTotals }, aux })}
        onSectionsChange={(sections) => {
          const nextOwned = new Set(sections.map((s) => s.id));
          const ids = props.pricingSectionIds.filter((id) => !owned.has(id) || nextOwned.has(id));
          for (const s of sections) if (!ids.includes(s.id)) ids.push(s.id);
          onUpdate({ props: { ...props, pricingSectionIds: ids }, aux: { sections } });
        }}
      />
    );
  },
  create: () => {
    const section = newPricingSection();
    return { props: { pricingSectionIds: [section.id], showTotals: true }, aux: { sections: [section] } };
  },
  onDuplicate: ({ props, aux }) => {
    const remap = new Map(aux.sections.map((s) => [s.id, newSectionId()]));
    return {
      props: { ...props, pricingSectionIds: props.pricingSectionIds.map((id) => remap.get(id) ?? id) },
      aux: { sections: aux.sections.map((s) => ({ ...s, id: remap.get(s.id)! })) },
    };
  },
};
