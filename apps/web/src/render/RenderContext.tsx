import { emptyPricing, type Pricing, type PricingResult, type Selections } from "@bridger/shared";
import { createContext, useContext } from "react";

/**
 * What block Renderers need beyond their own props: the proposal's pricing and its
 * computed totals, and where they're being shown.
 *   editor  — inside the editor canvas (non-interactive preview)
 *   preview — the owner's read-only preview
 *   public  — the client-facing viewer (interactive pricing, Phase 3)
 *   print   — PDF render
 */
export type RenderMode = "editor" | "preview" | "public" | "print";

export interface RenderContextValue {
  mode: RenderMode;
  pricing: Pricing;
  result: PricingResult | null;
  selections: Selections;
  /** Present only when the client can change selections (public viewer). */
  onSelect?: (sectionId: string, itemIds: string[]) => void;
  ownerSignatureName?: string;
}

export const RenderContext = createContext<RenderContextValue>({ mode: "editor", pricing: emptyPricing(), result: null, selections: {} });
export const useRenderContext = () => useContext(RenderContext);
