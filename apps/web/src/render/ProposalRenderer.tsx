import { resolveSelections, tryComputePricing, type Pricing, type ProposalContent, type Selections, type Theme } from "@bridger/shared";
import { useMemo, type ReactNode } from "react";
import { getBlockUI } from "../blocks";
import { RenderContext, type RenderContextValue, type RenderMode } from "./RenderContext";
import { ThemeScope } from "./ThemeScope";

/** Builds the render context for a proposal: resolved selections and computed totals. */
export function useRenderContextValue(
  pricing: Pricing,
  mode: RenderMode,
  opts: { selections?: Selections; onSelect?: RenderContextValue["onSelect"]; ownerSignatureName?: string; signing?: RenderContextValue["signing"] } = {},
): RenderContextValue {
  return useMemo(() => {
    const resolved = resolveSelections(pricing, opts.selections);
    const priced = tryComputePricing(pricing, resolved.issues.length ? undefined : resolved.selections);
    return {
      mode,
      pricing,
      result: priced.ok ? priced.result : null,
      selections: priced.ok ? priced.result.selections : resolved.selections,
      onSelect: opts.onSelect,
      ownerSignatureName: opts.ownerSignatureName,
      signing: opts.signing,
    };
  }, [pricing, mode, opts.selections, opts.onSelect, opts.ownerSignatureName, opts.signing]);
}

export function RenderProvider({ value, theme, overrides, children }: { value: RenderContextValue; theme?: Theme | null; overrides?: ProposalContent["theme"]; children: ReactNode }) {
  return (
    <RenderContext value={value}>
      {/* Print (PDF) waits for fonts itself via data-print-ready; a fade there could be captured mid-way. */}
      <ThemeScope theme={theme} overrides={overrides} gate={value.mode !== "print"}>
        {children}
      </ThemeScope>
    </RenderContext>
  );
}

/**
 * Renders a proposal as the client sees it (hidden blocks omitted). Used for the owner's
 * preview now, and the public viewer and print view in Phase 3.
 */
export function ProposalBlocks({ content }: { content: ProposalContent }) {
  return (
    <div className="@container space-y-8">
      {content.blocks
        .filter((b) => !b.hidden)
        .map((b) => {
          const ui = getBlockUI(b.type);
          return (
            <div key={b.id} data-block-id={b.id} data-block-type={b.type}>
              <ui.Renderer blockId={b.id} props={b.props as never} />
            </div>
          );
        })}
    </div>
  );
}
