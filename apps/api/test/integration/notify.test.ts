import type { ClientRow, ProposalDetail, PublicProposal, TemplateSummary } from "@bridger/shared";
import { beforeAll, describe, expect, it } from "vitest";
import { memoryOutbox } from "../../src/lib/email.js";
import { afterSigning, sendSignedEmails } from "../../src/services/afterSigning.js";
import { expireProposals, localTime, onViewActivity, remindExpiringSoon, sendDailyDigests } from "../../src/services/notify.js";
import { adminDb, api, background, env, ownerToken, publicApi } from "./helpers.js";

type Call = ReturnType<typeof api>;
let call: Call;
let client: ClientRow;
let template: TemplateSummary;
let ownerId: string;
const run = Date.now().toString(36);
const E = env();
const outboxFor = (proposalId: string, template?: string) => memoryOutbox.filter((m) => m.proposalId === proposalId && (!template || m.template === template));
const flush = async () => {
  await Promise.all(background.splice(0));
};

async function setPrefs(prefs: Record<string, boolean>) {
  const db = adminDb();
  const { data } = await db.from("settings").select("notification_prefs").eq("owner_id", ownerId).single();
  await db.from("settings").update({ notification_prefs: { ...(data!.notification_prefs as object), ...prefs } }).eq("owner_id", ownerId);
}

beforeAll(async () => {
  call = api(await ownerToken());
  client = (await call<ClientRow>("POST", "/clients", { name: `Avery ${run}`, company: `Birchwood ${run}`, email: `avery.${run}@birchwood.test` })).body;
  template = (await call<TemplateSummary[]>("GET", "/templates")).body.find((t) => t.name === "Content War Chest")!;
  ownerId = (await adminDb().from("settings").select("owner_id").limit(1).single()).data!.owner_id as string;
  await setPrefs({ first_view: true, return_visit: true, signed: true, declined: true, expiring_soon: true, expired: true, extension_requested: true, daily_digest: false });
});

async function published(title: string, extra: Record<string, unknown> = {}) {
  const p = (await call<ProposalDetail>("POST", "/proposals", { title, clientId: client.id, templateId: template.id, ...extra })).body;
  await call("POST", `/proposals/${p.id}/publish`);
  return (await call<ProposalDetail>("GET", `/proposals/${p.id}`)).body;
}

describe("send email to client", () => {
  it("emails the link with a personal message, and audits it", async () => {
    const p = await published(`Send ${run}`);
    const r = await call<{ to: string }>("POST", `/proposals/${p.id}/send-email`, { message: "Hi Avery,\n\nHere's the proposal we discussed. <b>Excited!</b>" });
    expect(r.status).toBe(200);
    expect(r.body.to).toBe(client.email);
    const [mail] = outboxFor(p.id, "proposal_sent");
    expect(mail).toMatchObject({ to: client.email, replyTo: E.OWNER_EMAIL, subject: `Proposal: Send ${run}` });
    expect(mail!.html).toContain(`/p/${p.slug}`);
    expect(mail!.html).toContain("Here&#39;s the proposal we discussed.");
    expect(mail!.html).not.toContain("<b>Excited!</b>"); // escaped
    expect(mail!.text).toContain("Here's the proposal we discussed.");
    const { data } = await adminDb().from("audit_events").select("metadata").eq("proposal_id", p.id).eq("event_type", "emailed");
    expect(data![0]!.metadata).toMatchObject({ to: client.email, version: 1 });
  });

  it("refuses drafts and clients without email", async () => {
    const draft = (await call<ProposalDetail>("POST", "/proposals", { title: "Unsent", clientId: client.id, templateId: template.id })).body;
    expect((await call("POST", `/proposals/${draft.id}/send-email`, {})).status).toBe(409);
    const noEmail = (await call<ClientRow>("POST", "/clients", { name: `No Email ${run}` })).body;
    const p = await published(`No email ${run}`);
    await call("PATCH", `/proposals/${p.id}`, { clientId: noEmail.id });
    const r = await call<{ error: { code: string } }>("POST", `/proposals/${p.id}/send-email`, {});
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe("no_client_email");
  });
});

describe("signed", () => {
  it("emails the signer and John once; John's email lists what to invoice", async () => {
    await adminDb().from("settings").update({ require_signer_email_otp: false }).eq("owner_id", ownerId);
    try {
      const p = await published(`Signed ${run}`, {
        templateId: null,
        content: {
          schemaVersion: 1,
          blocks: [
            { id: "cover0001", type: "cover", props: { title: "Signed", clientName: "Birchwood", preparedBy: "John", date: "" } },
            { id: "price0001", type: "pricing", props: { pricingSectionIds: ["sec_pkg", "sec_add"], showTotals: true } },
            { id: "sign00001", type: "signature", props: { intro: "Sign below.", showOwnerSignature: false } },
          ],
        },
        pricing: {
          sections: [
            { id: "sec_pkg", title: "Package", mode: "choose_one", items: [{ id: "a", name: "Half Chest", quantity: 1, unitPriceCents: 450_000, billing: "one_time", selectedByDefault: true }] },
            {
              id: "sec_add",
              title: "Add-ons",
              mode: "optional",
              items: [{ id: "m", name: "Posting management", quantity: 1, unitPriceCents: 125_000, billing: "monthly" }],
            },
          ],
          discounts: [{ id: "d", label: "Returning client discount", type: "amount", value: 50_000, appliesTo: "one_time" }],
        },
      });
      const pub = (await publicApi<PublicProposal>("GET", `/proposals/${p.slug}`)).body;
      expect(pub.state).toBe("active");
      const signed = await publicApi<{ signatureId: string }>("POST", `/proposals/${p.slug}/sign`, {
        version: 1,
        selections: { sec_pkg: ["a"], sec_add: ["m"] },
        signer: { name: "Avery Kim", email: `avery.${run}@birchwood.test`, title: "Founder", company: `Birchwood ${run}` },
        signature: { type: "typed", text: "Avery Kim" },
        consent: true,
        timezoneOffsetMinutes: 0,
      });
      expect(signed.status).toBe(200);
      await flush(); // PDF render fails in tests (no browser); emails wait for the PDF

      await sendSignedEmails(E, adminDb(), signed.body.signatureId);
      await sendSignedEmails(E, adminDb(), signed.body.signatureId); // deduped

      const copy = outboxFor(p.id, "signed_copy");
      expect(copy).toHaveLength(1);
      expect(copy[0]!.to).toBe(`avery.${run}@birchwood.test`);

      const owner = outboxFor(p.id, "signed");
      expect(owner).toHaveLength(1);
      expect(owner[0]!.subject).toBe(`✅ Signed: Signed ${run} — Birchwood ${run}`);
      expect(owner[0]!.text).toContain("Avery Kim, Founder · Birchwood");
      expect(owner[0]!.text).toContain("Half Chest (Package): $4,500.00");
      expect(owner[0]!.text).toContain("Returning client discount: −$500.00");
      expect(owner[0]!.text).toContain("One-time total: $4,000.00");
      expect(owner[0]!.text).toContain("Monthly total: $1,250.00/month");
      expect(owner[0]!.text).toContain(`- Create invoice: $4,000.00 one-time (Birchwood ${run})`);
      expect(owner[0]!.text).toContain(`- Set up a recurring invoice: $1,250.00/month (Birchwood ${run})`);
      expect(owner[0]!.html).toContain("<li style=\"margin:0 0 6px\">Create invoice: ");
      expect(owner[0]!.html).not.toContain("☐");
      expect(owner[0]!.text).not.toContain("QuickBooks");
    } finally {
      await adminDb().from("settings").update({ require_signer_email_otp: true }).eq("owner_id", ownerId);
    }
  });

  it("tells John when the signed PDF fails 3 times", async () => {
    await adminDb().from("settings").update({ require_signer_email_otp: false }).eq("owner_id", ownerId);
    try {
      const p = await published(`PDF fail ${run}`);
      const e = env(); // fresh KV for attempt counting
      const signed = await publicApi<{ signatureId: string }>("POST", `/proposals/${p.slug}/sign`, {
        version: 1,
        selections: {},
        signer: { name: "Avery Kim", email: `pdf.${run}@birchwood.test`, title: "Founder", company: "Birchwood" },
        signature: { type: "typed", text: "Avery Kim" },
        consent: true,
        timezoneOffsetMinutes: 0,
      }, e);
      await flush(); // attempt 1 (fails: no browser in tests)
      await afterSigning(e, adminDb(), signed.body.signatureId); // attempt 2
      expect(outboxFor(p.id, "pdf_failed")).toHaveLength(0);
      await afterSigning(e, adminDb(), signed.body.signatureId); // attempt 3 → notify
      await afterSigning(e, adminDb(), signed.body.signatureId); // no more attempts, no duplicate
      expect(outboxFor(p.id, "pdf_failed")).toHaveLength(1);
      expect(outboxFor(p.id, "signed_copy")).toHaveLength(0);
    } finally {
      await adminDb().from("settings").update({ require_signer_email_otp: true }).eq("owner_id", ownerId);
    }
  });
});

describe("declined and extension requests", () => {
  it("declined: one email with the reason", async () => {
    const p = await published(`Decline ${run}`);
    await publicApi("POST", `/proposals/${p.slug}/decline`, { reason: "Timing isn't right" });
    await flush();
    const mails = outboxFor(p.id, "declined");
    expect(mails).toHaveLength(1);
    expect(mails[0]!.text).toContain('Their reason: "Timing isn\'t right"');
  });

  it("extension requests: at most one email per proposal per day", async () => {
    const p = await published(`Extension ${run}`);
    await adminDb().from("proposals").update({ expires_at: new Date(Date.now() - 60_000).toISOString() }).eq("id", p.id);
    await publicApi("POST", `/proposals/${p.slug}/extension-request`, { message: "Two more weeks?" });
    await publicApi("POST", `/proposals/${p.slug}/extension-request`, { message: "Hello?" });
    await flush();
    const mails = outboxFor(p.id, "extension_requested");
    expect(mails).toHaveLength(1);
    expect(mails[0]!.text).toContain("Two more weeks?");
  });
});

describe("scheduled jobs", () => {
  it("expires proposals past their date once: status, audit, one email", async () => {
    const p = await published(`Expire ${run}`);
    await adminDb().from("proposals").update({ expires_at: new Date(Date.now() - 60_000).toISOString() }).eq("id", p.id);
    const ids = await expireProposals(E, adminDb());
    expect(ids).toContain(p.id);
    expect(await expireProposals(E, adminDb())).not.toContain(p.id);
    expect((await call<ProposalDetail>("GET", `/proposals/${p.id}`)).body.status).toBe("expired");
    expect(outboxFor(p.id, "expired")).toHaveLength(1);
    const { data } = await adminDb().from("audit_events").select("actor").eq("proposal_id", p.id).eq("event_type", "expired");
    expect(data).toEqual([{ actor: "system" }]);
  });

  it("expiring soon: once per expiry date, re-armed by extending, skipped when switched off", async () => {
    const soon = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const p = await published(`Expiring ${run}`, { expiresAt: soon });
    await remindExpiringSoon(E, adminDb());
    await remindExpiringSoon(E, adminDb());
    expect(outboxFor(p.id, "expiring_soon")).toHaveLength(1);
    expect(outboxFor(p.id, "expiring_soon")[0]!.text).toContain("hasn't been signed");

    await call("PATCH", `/proposals/${p.id}`, { expiresAt: new Date(Date.now() + 2.5 * 86_400_000).toISOString() });
    await remindExpiringSoon(E, adminDb());
    expect(outboxFor(p.id, "expiring_soon")).toHaveLength(2);

    await setPrefs({ expiring_soon: false });
    try {
      await call("PATCH", `/proposals/${p.id}`, { expiresAt: new Date(Date.now() + 1.5 * 86_400_000).toISOString() });
      await remindExpiringSoon(E, adminDb());
      expect(outboxFor(p.id, "expiring_soon")).toHaveLength(2);
    } finally {
      await setPrefs({ expiring_soon: true });
    }
  });

  it("daily digest: off by default; when on, 07:00 local only, once per day", async () => {
    const at = new Date("2026-06-15T14:00:00Z"); // 07:00 in Los Angeles (PDT)
    expect(localTime(at, "America/Los_Angeles")).toEqual({ hour: 7, date: "2026-06-15" });
    expect(await sendDailyDigests(E, adminDb(), at)).toBe(0); // off by default

    await setPrefs({ daily_digest: true });
    try {
      await adminDb().from("email_log").delete().eq("dedupe_key", `daily_digest:${ownerId}:2026-06-15`);
      expect(await sendDailyDigests(E, adminDb(), new Date("2026-06-15T15:00:00Z"))).toBe(0); // 08:00 local
      expect(await sendDailyDigests(E, adminDb(), at)).toBe(1);
      expect(await sendDailyDigests(E, adminDb(), at)).toBe(0);
      expect(memoryOutbox.at(-1)!.subject).toMatch(/^Your proposals: /);
    } finally {
      await setPrefs({ daily_digest: false });
    }
  });
});

describe("view notifications (wired to tracking in Phase 6)", () => {
  it("first view fires once, only after 5 s of active time", async () => {
    const p = await published(`First view ${run}`);
    const now = new Date().toISOString();
    await onViewActivity(E, adminDb(), { proposalId: p.id, activeMs: 3_000, sessionStart: now, previousSessionEnd: null, visitNumber: 1 });
    expect(outboxFor(p.id, "first_view")).toHaveLength(0);
    await onViewActivity(E, adminDb(), { proposalId: p.id, activeMs: 6_000, sessionStart: now, previousSessionEnd: null, visitNumber: 1, device: "mobile", where: "Seattle, WA" });
    await onViewActivity(E, adminDb(), { proposalId: p.id, activeMs: 9_000, sessionStart: now, previousSessionEnd: null, visitNumber: 2 });
    const mails = outboxFor(p.id, "first_view");
    expect(mails).toHaveLength(1);
    expect(mails[0]!.text).toContain("(mobile, Seattle, WA)");
  });

  it("return visit needs a 12 h gap and sends at most one per 12 h", async () => {
    const p = await published(`Return ${run}`);
    const now = Date.now();
    const iso = (ms: number) => new Date(ms).toISOString();
    await onViewActivity(E, adminDb(), { proposalId: p.id, activeMs: 0, sessionStart: iso(now), previousSessionEnd: iso(now - 5 * 3_600_000), visitNumber: 2 });
    expect(outboxFor(p.id, "return_visit")).toHaveLength(0);
    await onViewActivity(E, adminDb(), { proposalId: p.id, activeMs: 0, sessionStart: iso(now), previousSessionEnd: iso(now - 13 * 3_600_000), visitNumber: 3 });
    await onViewActivity(E, adminDb(), { proposalId: p.id, activeMs: 0, sessionStart: iso(now + 60_000), previousSessionEnd: iso(now - 20 * 3_600_000), visitNumber: 4 });
    expect(outboxFor(p.id, "return_visit")).toHaveLength(1);
  });
});
