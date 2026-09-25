import { pickLogo, readableOn, textOn, type Brand } from "@bridger/shared";
import { escapeHtml } from "../lib/email.js";

/**
 * Branded, email-client-safe layout (tables + inline styles). Every email has an HTML
 * and a plain-text version (SPEC §9).
 */
export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

export interface LayoutInput {
  brand: Brand | null;
  preheader: string;
  heading: string;
  /** Already-escaped HTML paragraphs/blocks. */
  bodyHtml: string;
  bodyText: string;
  cta?: { label: string; url: string };
  footerNote?: string;
}

const FALLBACK = { primary: "#0F2A44", accent: "#E07A1F", text: "#1B1F24" };

export function layout(input: LayoutInput): { html: string; text: string } {
  const c = input.brand?.theme.colors ?? FALLBACK;
  const company = input.brand?.company.name ?? "Bridger Digital";
  // The header is a primary-color band, so pick the logo version that reads on it.
  const logo = pickLogo(input.brand?.theme, c.primary);
  const logoImg = logo && `<img src="${escapeHtml(logo.url)}" alt="${escapeHtml(company)}" height="32" style="display:block;height:32px">`;
  const button = input.cta
    ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:28px 0 8px"><tr><td style="border-radius:6px;background:${c.accent}"><a href="${escapeHtml(input.cta.url)}" style="display:inline-block;padding:12px 22px;font-weight:600;color:${textOn(c.accent)};text-decoration:none;font-family:Arial,sans-serif">${escapeHtml(input.cta.label)}</a></td></tr></table>`
    : "";
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(input.heading)}</title></head>
<body style="margin:0;padding:0;background:#f4f5f7">
<span style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(input.preheader)}</span>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f5f7"><tr><td align="center" style="padding:32px 12px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden">
<tr><td style="background:${c.primary};padding:20px 32px">${
    logo
      ? logo.plate
        ? `<table role="presentation" cellspacing="0" cellpadding="0"><tr><td style="background:${logo.plate};border-radius:6px;padding:6px 10px">${logoImg}</td></tr></table>`
        : logoImg
      : `<span style="color:${textOn(c.primary)};font:700 18px Georgia,serif">${escapeHtml(company)}</span>`
  }</td></tr>
<tr><td style="padding:32px;font:15px/1.6 Arial,Helvetica,sans-serif;color:${readableOn(c.text, "#FFFFFF")}">
<h1 style="margin:0 0 16px;font:700 22px/1.3 Georgia,serif;color:${readableOn(c.primary, "#FFFFFF")}">${escapeHtml(input.heading)}</h1>
${input.bodyHtml}
${button}
</td></tr>
<tr><td style="padding:16px 32px 28px;font:12px/1.5 Arial,sans-serif;color:#6b7280;border-top:1px solid #eef0f3">${input.footerNote ? `${escapeHtml(input.footerNote)}<br>` : ""}${escapeHtml(company)}${
    input.brand?.company.website ? ` · <a href="${escapeHtml(input.brand.company.website)}" style="color:#6b7280">${escapeHtml(input.brand.company.website.replace(/^https?:\/\//, ""))}</a>` : ""
  }</td></tr>
</table></td></tr></table></body></html>`;
  const text = [input.heading, "", input.bodyText, input.cta ? `\n${input.cta.label}: ${input.cta.url}` : "", "", "—", company].join("\n");
  return { html, text };
}

export const p = (html: string) => `<p style="margin:0 0 14px">${html}</p>`;
export const e = escapeHtml;

/** Two-column key/value table (totals, details). Values are escaped. */
export function table(rows: [string, string][], opts: { bold?: boolean } = {}): string {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 16px;border-collapse:collapse">${rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:6px 0;border-bottom:1px solid #eef0f3;color:#4b5563">${e(k)}</td><td align="right" style="padding:6px 0;border-bottom:1px solid #eef0f3;${opts.bold ? "font-weight:700" : ""}">${e(v)}</td></tr>`,
    )
    .join("")}</table>`;
}
