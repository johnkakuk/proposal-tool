import { newBlockId } from "./ids.js";
import type { ProposalContent } from "./schemas/content.js";

/**
 * Template placeholders, substituted when a proposal is created from a template.
 * `{{client_name}}` → client's company (or name); `{{default_terms}}` → Settings default terms.
 */
export interface TemplateVars {
  client_name: string;
  default_terms: string;
}

export function applyTemplateVars<T>(value: T, vars: TemplateVars): T {
  const replace = (s: string) => s.replace(/\{\{\s*(client_name|default_terms)\s*\}\}/g, (_, k: keyof TemplateVars) => vars[k]);
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return replace(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(value) as T;
}

/** Starting document for "Blank": a cover, an empty paragraph, and the signature block. */
export function blankContent(title: string, clientName: string, preparedBy: string): ProposalContent {
  return {
    schemaVersion: 1,
    blocks: [
      { id: newBlockId(), type: "cover", props: { title, subtitle: "", clientName, preparedBy, date: "" } },
      { id: newBlockId(), type: "text", props: { markdown: "" } },
      { id: newBlockId(), type: "signature", props: { intro: "By signing, you accept this proposal and the terms above.", showOwnerSignature: true } },
    ],
  };
}
