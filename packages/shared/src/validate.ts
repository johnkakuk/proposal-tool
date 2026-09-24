import { z } from "zod";
import { blockRegistry, type Block } from "./blocks/registry.js";
import type { ProposalContent } from "./schemas/content.js";
import type { Pricing } from "./schemas/pricing.js";

/**
 * Human- and model-readable validation issues. Messages name the block by
 * position and type so an AI author can fix its own mistakes, e.g.
 * "Block 3 (pricing) references unknown pricing section 'sec_retainer'".
 */
export interface Issue {
  path: string;
  message: string;
}

/** Converts Zod errors into Issues, naming blocks by position and type where possible. */
export function zodIssues(error: z.ZodError, root?: unknown): Issue[] {
  return error.issues.map((i) => {
    const path = i.path.map(String).join(".");
    let prefix = "";
    if (i.path[0] === "blocks" && typeof i.path[1] === "number" && root && typeof root === "object") {
      const blocks = (root as { blocks?: unknown[] }).blocks;
      const b = blocks?.[i.path[1]] as { type?: unknown } | undefined;
      prefix = `Block ${i.path[1] + 1}${typeof b?.type === "string" ? ` (${b.type})` : ""}: `;
    }
    return { path, message: `${prefix}${i.message}${path ? ` [at ${path}]` : ""}` };
  });
}

const label = (b: Block, i: number) => `Block ${i + 1} (${b.type})`;

/** Cross-checks between content and pricing that hold for drafts too (references only). */
export function checkReferences(content: ProposalContent, pricing: Pricing): Issue[] {
  const issues: Issue[] = [];
  const sectionIds = new Set(pricing.sections.map((s) => s.id));
  content.blocks.forEach((b, i) => {
    if (b.type !== "pricing") return;
    b.props.pricingSectionIds.forEach((sid, j) => {
      if (!sectionIds.has(sid)) {
        issues.push({
          path: `blocks.${i}.props.pricingSectionIds.${j}`,
          message: `${label(b, i)} references unknown pricing section '${sid}'. Known sections: ${[...sectionIds].map((s) => `'${s}'`).join(", ") || "(none)"}`,
        });
      }
    });
  });
  return issues;
}

const VIDEO_HOSTS = /^https?:\/\/(www\.)?(youtube\.com|youtu\.be|vimeo\.com|player\.vimeo\.com|loom\.com)\//i;

export interface PublishCheckOptions {
  /** Whether the proposal's client has an email address (checked by the service layer). */
  clientHasEmail: boolean;
}

/** Pre-publish validation (§7.2). Returns [] when the proposal can be published. */
export function checkPublishable(content: ProposalContent, pricing: Pricing, opts: PublishCheckOptions): Issue[] {
  const issues = checkReferences(content, pricing);
  const visible = content.blocks.map((b, i) => ({ b, i })).filter(({ b }) => !b.hidden);

  const signatures = visible.filter(({ b }) => b.type === "signature");
  if (signatures.length !== 1) {
    issues.push({
      path: "blocks",
      message: `A proposal needs exactly one visible signature block; found ${signatures.length}`,
    });
  } else {
    const lastNonDivider = [...visible].reverse().find(({ b }) => b.type !== "divider");
    if (lastNonDivider && lastNonDivider.b.type !== "signature") {
      const s = signatures[0]!;
      issues.push({
        path: `blocks.${s.i}`,
        message: `${label(s.b, s.i)} must be the last block (only dividers may follow it); ${label(lastNonDivider.b, lastNonDivider.i)} comes after it`,
      });
    }
  }

  if (!opts.clientHasEmail) issues.push({ path: "client", message: "The proposal's client needs an email address" });
  if (pricing.sections.length === 0) issues.push({ path: "pricing.sections", message: "Add at least one pricing section" });

  for (const { b, i } of visible) {
    const props = b.props as Record<string, unknown>;
    for (const key of blockRegistry[b.type].requiredProps) {
      const v = props[key];
      if (v === undefined || v === null || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.length === 0)) {
        issues.push({ path: `blocks.${i}.props.${key}`, message: `${label(b, i)} is missing required '${key}'` });
      }
    }
    if (b.type === "video" && b.props.url && !VIDEO_HOSTS.test(b.props.url)) {
      issues.push({ path: `blocks.${i}.props.url`, message: `${label(b, i)} URL must be YouTube, Vimeo, or Loom` });
    }
  }
  return issues;
}
