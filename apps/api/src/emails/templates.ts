import { formatCents, type Billing, type Brand, type CadenceAmounts, type PricingResult } from "@bridger/shared";
import { e, layout, p, table, type EmailContent } from "./layout.js";

/**
 * Every email in SPEC §9. Each returns subject + HTML + plain text. User-supplied
 * strings are escaped by `e()`/`table()`.
 */

const SUFFIX: Record<Billing, string> = { one_time: "", monthly: "/month", quarterly: "/quarter", yearly: "/year" };
const CADENCE: Billing[] = ["one_time", "monthly", "quarterly", "yearly"];
const money = (cents: number, c: Billing = "one_time") => `${formatCents(cents)}${SUFFIX[c]}`;
const totalLines = (t: CadenceAmounts) => {
  const parts = CADENCE.filter((c) => t[c] > 0).map((c) => money(t[c], c));
  return parts.length ? parts.join(" + ") : formatCents(0);
};
const date = (iso: string, tz = "America/Los_Angeles") => new Date(iso).toLocaleDateString("en-US", { dateStyle: "long", timeZone: tz });

interface Common {
  brand: Brand | null;
  title: string;
  client: string;
}

// ---------------------------------------------------------------------------
// To John
// ---------------------------------------------------------------------------

export function firstView(x: Common & { editorUrl: string; where?: string; device?: string }): EmailContent {
  const detail = [x.device, x.where].filter(Boolean).join(", ");
  return {
    subject: `👀 ${x.client} opened “${x.title}”`,
    ...layout({
      brand: x.brand,
      preheader: `${x.client} is reading your proposal now.`,
      heading: `${x.client} opened your proposal`,
      bodyHtml: p(`<strong>${e(x.title)}</strong> was just opened for the first time${detail ? ` (${e(detail)})` : ""}.`),
      bodyText: `"${x.title}" was just opened for the first time${detail ? ` (${detail})` : ""}.`,
      cta: { label: "See activity", url: x.editorUrl },
    }),
  };
}

export function returnVisit(x: Common & { editorUrl: string; gapHours: number; visits: number }): EmailContent {
  const gap = x.gapHours >= 48 ? `${Math.round(x.gapHours / 24)} days` : `${Math.round(x.gapHours)} hours`;
  return {
    subject: `🔁 ${x.client} is back on “${x.title}”`,
    ...layout({
      brand: x.brand,
      preheader: `First visit in ${gap}.`,
      heading: `${x.client} came back to your proposal`,
      bodyHtml: p(`They're looking at <strong>${e(x.title)}</strong> again, their first visit in ${e(gap)} (visit #${x.visits}). A good moment to follow up.`),
      bodyText: `They're looking at "${x.title}" again, their first visit in ${gap} (visit #${x.visits}). A good moment to follow up.`,
      cta: { label: "See activity", url: x.editorUrl },
    }),
  };
}

export interface SignedEmailInput extends Common {
  signer: { name: string; title: string | null; email: string; company: string | null };
  totals: PricingResult;
  sectionTitles: Record<string, string>;
  pdfUrl: string;
  certificateUrl: string;
  certificateId: string;
  editorUrl: string;
}

export function ownerSigned(x: SignedEmailInput): EmailContent {
  const selected = x.totals.sections.flatMap((s) => s.lines.filter((l) => l.selected).map((l) => ({ section: x.sectionTitles[s.sectionId] ?? s.title, line: l })));
  const itemRows: [string, string][] = selected.map(({ section, line }) => [`${line.name} (${section})`, money(line.totalCents, line.billing)]);
  const discounts: [string, string][] = [
    ...x.totals.sections.flatMap((s) => s.discounts.filter((d) => d.amountCents > 0).map((d): [string, string] => [d.label, `−${formatCents(d.amountCents)}`])),
    ...x.totals.sections.flatMap((s) => s.lines.filter((l) => l.selected && l.discount && l.discount.amountCents > 0).map((l): [string, string] => [`${l.discount!.label} (${l.name})`, `−${formatCents(l.discount!.amountCents)}`])),
    ...x.totals.discounts.filter((d) => d.amountCents > 0).map((d): [string, string] => [d.label, `−${formatCents(d.amountCents)}`]),
  ];
  const totalsRows: [string, string][] = CADENCE.filter((c) => x.totals.total[c] > 0).map((c) => [c === "one_time" ? "One-time total" : `${c[0]!.toUpperCase()}${c.slice(1)} total`, money(x.totals.total[c], c)]);
  if (x.totals.tax) totalsRows.push([`Includes tax (${x.totals.tax.ratePct}%)`, totalLines(x.totals.tax.byCadence)]);

  // The QuickBooks checklist replaces any in-app invoice reminder (SPEC §9).
  const checklist: string[] = [];
  if (x.totals.total.one_time > 0) checklist.push(`Create invoice in QuickBooks: ${money(x.totals.total.one_time)} one-time (${x.client})`);
  for (const c of ["monthly", "quarterly", "yearly"] as const) {
    if (x.totals.total[c] > 0) checklist.push(`Set up a recurring invoice in QuickBooks: ${money(x.totals.total[c], c)} (${x.client})`);
  }
  if (checklist.length === 0) checklist.push(`Create invoice in QuickBooks for ${x.client}`);

  const signerLine = `${x.signer.name}${x.signer.title ? `, ${x.signer.title}` : ""}${x.signer.company ? ` · ${x.signer.company}` : ""} (${x.signer.email})`;
  const html = [
    p(`<strong>${e(x.title)}</strong> was signed by ${e(signerLine)}.`),
    `<h2 style="margin:24px 0 8px;font:700 16px Arial,sans-serif">Selected items</h2>`,
    table(itemRows.length ? itemRows : [["(no line items)", ""]]),
    discounts.length ? `<h2 style="margin:24px 0 8px;font:700 16px Arial,sans-serif">Discounts</h2>${table(discounts)}` : "",
    `<h2 style="margin:24px 0 8px;font:700 16px Arial,sans-serif">Totals</h2>`,
    table(totalsRows.length ? totalsRows : [["Total", formatCents(0)]], { bold: true }),
    `<h2 style="margin:24px 0 8px;font:700 16px Arial,sans-serif">Next step</h2>`,
    `<ul style="margin:0 0 16px;padding-left:0;list-style:none">${checklist.map((c) => `<li style="margin:0 0 6px">☐ ${e(c)}</li>`).join("")}</ul>`,
    p(`<a href="${e(x.pdfUrl)}">Signed PDF</a> · <a href="${e(x.certificateUrl)}">Certificate ${e(x.certificateId)}</a>`),
  ].join("\n");
  const text = [
    `"${x.title}" was signed by ${signerLine}.`,
    "",
    "Selected items:",
    ...itemRows.map(([k, v]) => `  ${k}: ${v}`),
    ...(discounts.length ? ["", "Discounts:", ...discounts.map(([k, v]) => `  ${k}: ${v}`)] : []),
    "",
    "Totals:",
    ...totalsRows.map(([k, v]) => `  ${k}: ${v}`),
    "",
    "Next step:",
    ...checklist.map((c) => `  [ ] ${c}`),
    "",
    `Signed PDF: ${x.pdfUrl}`,
    `Certificate ${x.certificateId}: ${x.certificateUrl}`,
  ].join("\n");
  return { subject: `✅ Signed: ${x.title} — ${x.client}`, ...layout({ brand: x.brand, preheader: `${totalLines(x.totals.total)} · ${x.signer.name}`, heading: "Signed!", bodyHtml: html, bodyText: text, cta: { label: "Open proposal", url: x.editorUrl } }) };
}

export function ownerDeclined(x: Common & { reason: string | null; editorUrl: string }): EmailContent {
  return {
    subject: `Declined: ${x.title} — ${x.client}`,
    ...layout({
      brand: x.brand,
      preheader: x.reason ?? "No reason given.",
      heading: `${x.client} declined your proposal`,
      bodyHtml: p(`<strong>${e(x.title)}</strong> was declined.`) + p(x.reason ? `Their reason: “${e(x.reason)}”` : "They didn't give a reason."),
      bodyText: `"${x.title}" was declined.\n${x.reason ? `Their reason: "${x.reason}"` : "They didn't give a reason."}`,
      cta: { label: "Open proposal", url: x.editorUrl },
    }),
  };
}

export function expiringSoon(x: Common & { expiresAt: string; editorUrl: string; timezone: string }): EmailContent {
  return {
    subject: `⏳ Expires ${date(x.expiresAt, x.timezone)}: ${x.title}`,
    ...layout({
      brand: x.brand,
      preheader: `${x.client} hasn't signed yet.`,
      heading: "A proposal expires in 3 days",
      bodyHtml: p(`<strong>${e(x.title)}</strong> for ${e(x.client)} expires on ${e(date(x.expiresAt, x.timezone))} and hasn't been signed. You can follow up, or extend it from the editor.`),
      bodyText: `"${x.title}" for ${x.client} expires on ${date(x.expiresAt, x.timezone)} and hasn't been signed. You can follow up, or extend it from the editor.`,
      cta: { label: "Open proposal", url: x.editorUrl },
    }),
  };
}

export function expired(x: Common & { editorUrl: string }): EmailContent {
  return {
    subject: `Expired: ${x.title} — ${x.client}`,
    ...layout({
      brand: x.brand,
      preheader: "The client can no longer sign it.",
      heading: "A proposal expired",
      bodyHtml: p(`<strong>${e(x.title)}</strong> for ${e(x.client)} has expired. The client can request an extension, or you can set a new date to reopen it.`),
      bodyText: `"${x.title}" for ${x.client} has expired. The client can request an extension, or you can set a new date to reopen it.`,
      cta: { label: "Extend it", url: x.editorUrl },
    }),
  };
}

export function extensionRequested(x: Common & { message: string | null; editorUrl: string }): EmailContent {
  return {
    subject: `🙋 Extension requested: ${x.title}`,
    ...layout({
      brand: x.brand,
      preheader: x.message ?? `${x.client} would like more time.`,
      heading: `${x.client} asked for more time`,
      bodyHtml: p(`They'd like an extension on <strong>${e(x.title)}</strong>.`) + (x.message ? p(`Their message: “${e(x.message)}”`) : "") + p("Set a new expiry date in the editor to reopen it."),
      bodyText: `They'd like an extension on "${x.title}".${x.message ? `\nTheir message: "${x.message}"` : ""}\nSet a new expiry date in the editor to reopen it.`,
      cta: { label: "Extend it", url: x.editorUrl },
    }),
  };
}

export function aiDraftCreated(x: Common & { aiClient: string; editorUrl: string }): EmailContent {
  return {
    subject: `🤖 ${x.aiClient} drafted “${x.title}”`,
    ...layout({
      brand: x.brand,
      preheader: "Review it before it goes out.",
      heading: `${x.aiClient} drafted a proposal`,
      bodyHtml: p(`<strong>${e(x.title)}</strong> for ${e(x.client)} is ready for your review.`),
      bodyText: `"${x.title}" for ${x.client} is ready for your review.`,
      cta: { label: "Review draft", url: x.editorUrl },
    }),
  };
}

export function aiPublished(x: Common & { aiClient: string; publicUrl: string; editorUrl: string }): EmailContent {
  return {
    subject: `🤖 ${x.aiClient} published “${x.title}”`,
    ...layout({
      brand: x.brand,
      preheader: x.publicUrl,
      heading: `${x.aiClient} published a proposal`,
      bodyHtml: p(`<strong>${e(x.title)}</strong> for ${e(x.client)} is live at <a href="${e(x.publicUrl)}">${e(x.publicUrl)}</a>.`),
      bodyText: `"${x.title}" for ${x.client} is live at ${x.publicUrl}`,
      cta: { label: "Open in editor", url: x.editorUrl },
    }),
  };
}

export function pdfFailed(x: Common & { editorUrl: string }): EmailContent {
  return {
    subject: `⚠️ Signed PDF failed: ${x.title}`,
    ...layout({
      brand: x.brand,
      preheader: "The signature is recorded; only the PDF is missing.",
      heading: "We couldn't generate a signed PDF",
      bodyHtml: p(`<strong>${e(x.title)}</strong> was signed and the signature is safely recorded, but the signed PDF failed after 3 attempts. The certificate page still verifies it. Check Browser Rendering limits in Cloudflare.`),
      bodyText: `"${x.title}" was signed and the signature is safely recorded, but the signed PDF failed after 3 attempts. The certificate page still verifies it. Check Browser Rendering limits in Cloudflare.`,
      cta: { label: "Open proposal", url: x.editorUrl },
    }),
  };
}

export interface DigestInput {
  brand: Brand | null;
  dateLabel: string;
  views: { title: string; client: string; visits: number; editorUrl: string }[];
  signings: { title: string; client: string; total: string; editorUrl: string }[];
  expiring: { title: string; client: string; expiresOn: string; editorUrl: string }[];
}

export function dailyDigest(x: DigestInput): EmailContent {
  const section = (heading: string, items: string[], textItems: string[]) =>
    items.length ? { html: `<h2 style="margin:24px 0 8px;font:700 16px Arial,sans-serif">${e(heading)}</h2><ul style="margin:0 0 12px;padding-left:18px">${items.join("")}</ul>`, text: [heading, ...textItems].join("\n") } : null;
  const parts = [
    section(
      "Signed",
      x.signings.map((s) => `<li><a href="${e(s.editorUrl)}">${e(s.title)}</a> — ${e(s.client)} (${e(s.total)})</li>`),
      x.signings.map((s) => `  • ${s.title} — ${s.client} (${s.total})`),
    ),
    section(
      "Viewed",
      x.views.map((v) => `<li><a href="${e(v.editorUrl)}">${e(v.title)}</a> — ${e(v.client)}, ${v.visits} visit${v.visits === 1 ? "" : "s"}</li>`),
      x.views.map((v) => `  • ${v.title} — ${v.client}, ${v.visits} visit${v.visits === 1 ? "" : "s"}`),
    ),
    section(
      "Expiring soon",
      x.expiring.map((v) => `<li><a href="${e(v.editorUrl)}">${e(v.title)}</a> — ${e(v.client)}, expires ${e(v.expiresOn)}</li>`),
      x.expiring.map((v) => `  • ${v.title} — ${v.client}, expires ${v.expiresOn}`),
    ),
  ].filter((s): s is { html: string; text: string } => s !== null);
  return {
    subject: `Your proposals: ${x.dateLabel}`,
    ...layout({
      brand: x.brand,
      preheader: `${x.signings.length} signed · ${x.views.length} viewed · ${x.expiring.length} expiring`,
      heading: `Daily digest · ${x.dateLabel}`,
      bodyHtml: parts.length ? parts.map((s) => s.html).join("") : p("Quiet day: no views, signatures, or upcoming expirations."),
      bodyText: parts.length ? parts.map((s) => s.text).join("\n\n") : "Quiet day: no views, signatures, or upcoming expirations.",
    }),
  };
}

// ---------------------------------------------------------------------------
// To the client
// ---------------------------------------------------------------------------

export function proposalSent(x: Common & { message: string | null; publicUrl: string; expiresAt: string | null; senderName: string; timezone: string }): EmailContent {
  const company = x.brand?.company.name ?? "Bridger Digital";
  const note = x.message
    ? x.message
        .split(/\n{2,}/)
        .map((para) => p(e(para).replace(/\n/g, "<br>")))
        .join("")
    : p(`${e(x.senderName)} from ${e(company)} sent you a proposal: <strong>${e(x.title)}</strong>.`);
  return {
    subject: `Proposal: ${x.title}`,
    ...layout({
      brand: x.brand,
      preheader: `From ${company}`,
      heading: x.title,
      bodyHtml: note + (x.expiresAt ? p(`<span style="color:#6b7280">This proposal is valid until ${e(date(x.expiresAt, x.timezone))}.</span>`) : ""),
      bodyText: `${x.message ?? `${x.senderName} from ${company} sent you a proposal: "${x.title}".`}${x.expiresAt ? `\n\nValid until ${date(x.expiresAt, x.timezone)}.` : ""}`,
      cta: { label: "View proposal", url: x.publicUrl },
    }),
  };
}

export function otpCode(x: { brand: Brand | null; title: string; code: string }): EmailContent {
  return {
    subject: `${x.code} is your code to sign “${x.title}”`,
    ...layout({
      brand: x.brand,
      preheader: "It expires in 10 minutes.",
      heading: "Your verification code",
      bodyHtml:
        p(`Enter this code to sign <strong>${e(x.title)}</strong>:`) +
        `<p style="margin:8px 0 20px;font:700 32px/1 'Courier New',monospace;letter-spacing:8px">${e(x.code)}</p>` +
        p(`<span style="color:#6b7280">It expires in 10 minutes. If you didn't request this, you can ignore this email.</span>`),
      bodyText: `Your verification code for signing "${x.title}" is ${x.code}.\nIt expires in 10 minutes. If you didn't request this, you can ignore this email.`,
    }),
  };
}

export function signedCopy(x: { brand: Brand | null; title: string; certificateId: string; certificateUrl: string; publicUrl: string; attached: boolean }): EmailContent {
  return {
    subject: `Your signed copy: ${x.title}`,
    ...layout({
      brand: x.brand,
      preheader: `Certificate ${x.certificateId}`,
      heading: "Thanks for signing!",
      bodyHtml:
        p(`Here's your signed copy of <strong>${e(x.title)}</strong>. ${x.attached ? "It's attached to this email." : "You can download it any time from the proposal page."}`) +
        p(`Certificate <a href="${e(x.certificateUrl)}">${e(x.certificateId)}</a> lets anyone verify the signed document hasn't changed.`),
      bodyText: `Here's your signed copy of "${x.title}". ${x.attached ? "It's attached to this email." : `Download it here: ${x.publicUrl}`}\nCertificate ${x.certificateId}: ${x.certificateUrl}`,
      cta: { label: "View signed proposal", url: x.publicUrl },
      footerNote: "You're receiving this because you signed a proposal.",
    }),
  };
}
