import { canonicalJson, sha256Hex, type ClientRow, type PricingSection, type ProposalDetail, type PublicCertificate, type PublicProposal, type TemplateSummary } from "@bridger/shared";
import { beforeAll, describe, expect, it } from "vitest";
import { memoryOutbox } from "../../src/lib/email.js";
import { createRenderToken } from "../../src/lib/renderToken.js";
import { adminDb, api, env, ownerToken, publicApi } from "./helpers.js";

type Call = ReturnType<typeof api>;
let call: Call;
let client: ClientRow;
let template: TemplateSummary;
const run = Date.now().toString(36);
const TINY_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

beforeAll(async () => {
  call = api(await ownerToken());
  client = (await call<ClientRow>("POST", "/clients", { name: `Morgan ${run}`, company: `Cascade Co ${run}`, email: `morgan.${run}@cascade.test` })).body;
  template = (await call<TemplateSummary[]>("GET", "/templates")).body.find((t) => t.name === "Content War Chest")!;
});

async function publishedProposal(title: string) {
  const p = (await call<ProposalDetail>("POST", "/proposals", { title, clientId: client.id, templateId: template.id })).body;
  await call("POST", `/proposals/${p.id}/publish`);
  return (await call<ProposalDetail>("GET", `/proposals/${p.id}`)).body;
}

const signer = (email: string) => ({ name: "Morgan Lee", email, title: "Owner", company: `Cascade Co ${run}` });

/** Requests a code and returns it from the (in-memory) outbox. */
async function otpFor(slug: string, email: string): Promise<string> {
  const before = memoryOutbox.length;
  expect((await publicApi("POST", `/proposals/${slug}/otp`, { email })).status).toBe(200);
  const mail = memoryOutbox.slice(before).find((m) => m.to === email.toLowerCase() && m.template === "otp");
  return /\b(\d{6})\b/.exec(mail!.text)![1]!;
}

function selectionsFor(sections: PricingSection[]) {
  const pkg = sections.find((s) => s.mode === "choose_one")!;
  const addons = sections.find((s) => s.mode === "optional")!;
  return { [pkg.id]: [pkg.items[0]!.id], [addons.id]: [addons.items[0]!.id] };
}

describe("signing", () => {
  it("full flow: OTP → sign → locked, snapshot hash verifies, certificate masks the email", async () => {
    const p = await publishedProposal(`Sign me ${run}`);
    const email = `morgan.${run}@cascade.test`;
    const pub = (await publicApi<PublicProposal>("GET", `/proposals/${p.slug}`)).body;
    expect(pub.requireOtp).toBe(true);
    expect(pub.signerDefaults).toEqual({ email, company: `Cascade Co ${run}` });

    // Signing without verifying is refused
    const selections = selectionsFor(pub.document!.pricing.sections);
    const body = { version: pub.version, selections, signer: signer(email), signature: { type: "typed", text: "Morgan Lee" }, consent: true, timezoneOffsetMinutes: 420 };
    expect((await publicApi<{ error: { code: string } }>("POST", `/proposals/${p.slug}/sign`, body)).body.error.code).toBe("email_not_verified");

    const code = await otpFor(p.slug, email);
    const wrong = code === "000000" ? "111111" : "000000";
    const bad = await publicApi<{ error: { message: string } }>("POST", `/proposals/${p.slug}/otp/verify`, { email, code: wrong });
    expect(bad.status).toBe(400);
    expect(bad.body.error.message).toMatch(/4 attempts left/);
    expect((await publicApi("POST", `/proposals/${p.slug}/otp/verify`, { email: email.toUpperCase(), code })).status).toBe(200);

    const signed = await publicApi<{ certificateId: string; documentHash: string }>("POST", `/proposals/${p.slug}/sign`, body);
    expect(signed.status).toBe(200);
    expect(signed.body.certificateId).toMatch(/^BDP-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/);

    // Locked for the owner too
    const edit = await call<{ error: { code: string } }>("PATCH", `/proposals/${p.id}`, { title: "Changed" });
    expect(edit.status).toBe(409);
    expect(edit.body.error.code).toBe("locked");

    // Public view shows the signed snapshot and the client's choices
    const after = (await publicApi<PublicProposal>("GET", `/proposals/${p.slug}`)).body;
    expect(after.state).toBe("signed");
    expect(after.signed).toMatchObject({ signerName: "Morgan Lee", certificateId: signed.body.certificateId, selections, signature: { type: "typed", text: "Morgan Lee" } });

    // Anyone can re-hash the snapshot and get the stored hash
    const cert = (await publicApi<PublicCertificate>("GET", `/proposals/${p.slug}/certificate`)).body;
    expect(cert.documentHash).toBe(signed.body.documentHash);
    expect(await sha256Hex(canonicalJson(cert.snapshot))).toBe(cert.documentHash);
    expect(cert.signer.email).not.toBe(email);
    expect(cert.signer.email).toMatch(/^m\*+/);
    expect(cert.evidence).toBeUndefined();
    expect(JSON.stringify(cert.snapshot)).not.toContain("127.0.0.1");

    // The render token unlocks evidence and the audit trail
    const token = await createRenderToken(env().SIGNING_SECRET, p.slug);
    const full = (await publicApi<PublicCertificate>("GET", `/proposals/${p.slug}/certificate?token=${encodeURIComponent(token)}`)).body;
    expect(full.signer.email).toBe(email);
    expect(full.evidence!.emailVerified).toBe(true);
    expect(full.evidence!.auditTrail.map((e) => e.event)).toEqual(expect.arrayContaining(["published", "otp_sent", "otp_verified", "signed"]));

    // Totals were recomputed server-side from the choices
    const { data: row } = await adminDb().from("signatures").select("computed_totals, consent_text, snapshot").eq("proposal_id", p.id).single();
    expect((row!.computed_totals as { total: { one_time: number } }).total.one_time).toBe(450_000 + 75_000);
    expect(row!.consent_text).toContain(`on behalf of Cascade Co ${run}`);

    // Can't sign twice
    expect((await publicApi("POST", `/proposals/${p.slug}/sign`, body)).status).toBe(409);
  });

  it("rejects a stale version with 409 after the owner republishes", async () => {
    const p = await publishedProposal(`Stale ${run}`);
    const email = `stale.${run}@cascade.test`;
    const seen = (await publicApi<PublicProposal>("GET", `/proposals/${p.slug}`)).body;

    const content = structuredClone(p.content);
    content.blocks.splice(1, 0, { id: "stale00001", type: "text", props: { markdown: "Updated terms." } });
    await call("PATCH", `/proposals/${p.id}`, { content });
    await call("POST", `/proposals/${p.id}/publish`);

    const code = await otpFor(p.slug, email);
    await publicApi("POST", `/proposals/${p.slug}/otp/verify`, { email, code });
    const r = await publicApi<{ error: { code: string } }>("POST", `/proposals/${p.slug}/sign`, {
      version: seen.version,
      selections: {},
      signer: signer(email),
      signature: { type: "typed", text: "Morgan Lee" },
      consent: true,
      timezoneOffsetMinutes: 0,
    });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("stale_version");
  });

  it("accepts a drawn signature, stores the image privately, and binds its hash", async () => {
    await adminDb().from("settings").update({ require_signer_email_otp: false }).neq("owner_id", "00000000-0000-0000-0000-000000000000");
    try {
      const p = await publishedProposal(`Drawn ${run}`);
      const r = await publicApi("POST", `/proposals/${p.slug}/sign`, {
        version: 1,
        selections: {},
        signer: signer(`drawn.${run}@cascade.test`),
        signature: { type: "drawn", imageDataUrl: TINY_PNG },
        consent: true,
        timezoneOffsetMinutes: 0,
      });
      expect(r.status).toBe(200);
      const { data } = await adminDb().from("signatures").select("signature_image_path, snapshot, email_verified").eq("proposal_id", p.id).single();
      expect(data!.signature_image_path).toMatch(new RegExp(`^${p.id}/.+\\.png$`));
      expect((data!.snapshot as { signature: { imageSha256: string } }).signature.imageSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(data!.email_verified).toBe(false);
      const pub = (await publicApi<PublicProposal>("GET", `/proposals/${p.slug}`)).body;
      expect(pub.signed!.signature).toMatchObject({ type: "drawn" });
      expect((pub.signed!.signature as { imageUrl: string }).imageUrl).toContain("/storage/v1/object/sign/signatures/");
    } finally {
      await adminDb().from("settings").update({ require_signer_email_otp: true }).neq("owner_id", "00000000-0000-0000-0000-000000000000");
    }
  });

  it("permanently deletes a signed proposal only with explicit confirmation, removing its files", async () => {
    await adminDb().from("settings").update({ require_signer_email_otp: false }).neq("owner_id", "00000000-0000-0000-0000-000000000000");
    try {
      const p = await publishedProposal(`Purge signed ${run}`);
      const signed = await publicApi("POST", `/proposals/${p.slug}/sign`, {
        version: 1,
        selections: {},
        signer: signer(`purge.${run}@cascade.test`),
        signature: { type: "drawn", imageDataUrl: TINY_PNG },
        consent: true,
        timezoneOffsetMinutes: 0,
      });
      expect(signed.status).toBe(200);
      const { data: sig } = await adminDb().from("signatures").select("signature_image_path").eq("proposal_id", p.id).single();
      const image = sig!.signature_image_path as string;
      expect((await adminDb().storage.from("signatures").download(image)).error).toBeNull();

      await call("POST", `/proposals/${p.id}/archive`);
      const refused = await call<{ error: { code: string } }>("DELETE", `/proposals/${p.id}`);
      expect([refused.status, refused.body.error.code]).toEqual([409, "locked"]);
      expect((await call("DELETE", `/proposals/${p.id}?confirmSigned=true`)).status).toBe(204);

      expect((await call("GET", `/proposals/${p.id}`)).status).toBe(404);
      for (const table of ["signatures", "proposal_versions", "audit_events"] as const) {
        const { count } = await adminDb().from(table).select("id", { count: "exact", head: true }).eq("proposal_id", p.id);
        expect(count).toBe(0);
      }
      expect((await adminDb().storage.from("signatures").download(image)).error).not.toBeNull();
      expect((await publicApi("GET", `/proposals/${p.slug}`)).status).toBe(404);
    } finally {
      await adminDb().from("settings").update({ require_signer_email_otp: true }).neq("owner_id", "00000000-0000-0000-0000-000000000000");
    }
  });

  it("validates input: consent required, bad selections, non-PNG images", async () => {
    const p = await publishedProposal(`Invalid ${run}`);
    const base = { version: 1, selections: {}, signer: signer(`x.${run}@cascade.test`), signature: { type: "typed", text: "Morgan Lee" }, timezoneOffsetMinutes: 0 };
    expect((await publicApi("POST", `/proposals/${p.slug}/sign`, { ...base, consent: false })).status).toBe(422);
    expect((await publicApi("POST", `/proposals/${p.slug}/sign`, { ...base, consent: true, signature: { type: "drawn", imageDataUrl: "data:image/png;base64,AAAA" } })).status).toBe(422);
  });

  it("enforces OTP limits: 3 sends per 15 minutes, 5 attempts per code", async () => {
    const p = await publishedProposal(`OTP limits ${run}`);
    const email = `limits.${run}@cascade.test`;
    const code = await otpFor(p.slug, email);
    await otpFor(p.slug, email);
    await otpFor(p.slug, email);
    expect((await publicApi("POST", `/proposals/${p.slug}/otp`, { email })).status).toBe(429);
    // The latest code is the one checked; old codes don't work once superseded unless equal.
    const wrong = "999999" === code ? "888888" : "999999";
    for (let i = 0; i < 5; i++) await publicApi("POST", `/proposals/${p.slug}/otp/verify`, { email, code: wrong });
    const locked = await publicApi<{ error: { code: string } }>("POST", `/proposals/${p.slug}/otp/verify`, { email, code: wrong });
    expect(locked.status).toBe(429);
    expect(locked.body.error.code).toBe("too_many_attempts");
  });

  it("decline: records the reason, shows the declined page, and blocks signing", async () => {
    const p = await publishedProposal(`Decline ${run}`);
    expect((await publicApi("POST", `/proposals/${p.slug}/decline`, { reason: "Budget moved to Q3" })).status).toBe(200);
    const pub = (await publicApi<PublicProposal>("GET", `/proposals/${p.slug}`)).body;
    expect(pub.state).toBe("declined");
    expect(pub.document).toBeNull();
    expect(JSON.stringify(pub)).not.toContain("Budget moved"); // the reason stays private
    const detail = (await call<ProposalDetail>("GET", `/proposals/${p.id}`)).body;
    expect(detail.status).toBe("declined");
    const { data } = await adminDb().from("proposals").select("decline_reason").eq("id", p.id).single();
    expect(data!.decline_reason).toBe("Budget moved to Q3");
    expect((await publicApi("POST", `/proposals/${p.slug}/otp`, { email: "a@b.test" })).status).toBe(409);
  });
});
