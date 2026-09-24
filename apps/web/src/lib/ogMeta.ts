import type { PublicProposalMeta } from "@bridger/shared";

/**
 * Builds the <head> tags for a proposal's link preview (SPEC §8.1). Shared by the
 * Pages Function; kept pure so it can be unit-tested. Everything is HTML-escaped:
 * titles come from user content.
 */
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function ogTags(meta: PublicProposalMeta, pageUrl: string): string {
  const tags: [string, string][] = [
    ["og:type", "website"],
    ["og:title", meta.title],
    ["og:description", meta.description],
    ["og:url", pageUrl],
    ["twitter:card", meta.imageUrl ? "summary_large_image" : "summary"],
    ["twitter:title", meta.title],
    ["twitter:description", meta.description],
  ];
  if (meta.imageUrl) tags.push(["og:image", meta.imageUrl], ["twitter:image", meta.imageUrl]);
  return [
    `<meta name="description" content="${escapeHtml(meta.description)}">`,
    ...tags.map(([k, v]) => `<meta ${k.startsWith("og:") ? "property" : "name"}="${k}" content="${escapeHtml(v)}">`),
  ].join("\n");
}

/** Headers every /p/* response carries, with or without the function. */
export const PUBLIC_PAGE_HEADERS: Record<string, string> = {
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "same-origin",
};
