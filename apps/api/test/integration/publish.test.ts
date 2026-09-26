import type { ClientRow, ProposalDetail, PublicProposal, PublicProposalMeta, TemplateSummary } from "@bridger/shared";
import { beforeAll, describe, expect, it } from "vitest";
import { adminDb, api, env, limiter, ownerToken, publicApi } from "./helpers.js";

type Call = ReturnType<typeof api>;
let call: Call;
let client: ClientRow;
let template: TemplateSummary;
const run = Date.now().toString(36);

beforeAll(async () => {
  call = api(await ownerToken());
  client = (await call<ClientRow>("POST", "/clients", { name: `Pat ${run}`, company: `Harbor Dental ${run}`, email: "pat@harbor.test" })).body;
  template = (await call<TemplateSummary[]>("GET", "/templates")).body.find((t) => t.name === "Content War Chest")!;
});

const fromTemplate = async (title: string, extra: Record<string, unknown> = {}) =>
  (await call<ProposalDetail>("POST", "/proposals", { title, clientId: client.id, templateId: template.id, ...extra })).body;

type PublishBody = { proposal: ProposalDetail; published: boolean; publicUrl: string };

describe("publishing", () => {
  it("drafts are never visible publicly", async () => {
    const p = await fromTemplate("Draft only");
    expect((await publicApi("GET", `/proposals/${p.slug}`)).status).toBe(404);
    expect((await publicApi("GET", `/proposals/${p.slug}/meta`)).status).toBe(404);
    expect((await publicApi("GET", "/proposals/not-a-real-slug")).status).toBe(404);
  });

  it("publishes version 1, then editing + republishing makes version 2 on the same link", async () => {
    const p = await fromTemplate(`Versioned ${run}`);
    expect(p.has_unpublished_changes).toBe(true);

    const first = await call<PublishBody>("POST", `/proposals/${p.id}/publish`);
    expect(first.status).toBe(200);
    expect(first.body.published).toBe(true);
    expect(first.body.publicUrl).toBe(`http://localhost:5173/p/${p.slug}`);
    expect(first.body.proposal).toMatchObject({ status: "sent", current_version: 1, has_unpublished_changes: false });
    // Default expiry: 30 days out
    const days = (Date.parse(first.body.proposal.expires_at!) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);

    const pub1 = await publicApi<PublicProposal>("GET", `/proposals/${p.slug}`);
    expect(pub1.status).toBe(200);
    expect(pub1.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    expect(pub1.body).toMatchObject({ state: "active", version: 1, title: `Versioned ${run}`, clientName: `Harbor Dental ${run}` });
    expect(pub1.body.document!.pricing.sections.length).toBeGreaterThan(0);

    // Edit the draft: the public link keeps showing version 1 until republished.
    const content = structuredClone(first.body.proposal.content);
    content.blocks.splice(1, 0, { id: "newtext001", type: "text", props: { markdown: "A brand new paragraph." } });
    const edited = await call<ProposalDetail>("PATCH", `/proposals/${p.id}`, { content });
    expect(edited.body.has_unpublished_changes).toBe(true);
    expect(JSON.stringify((await publicApi<PublicProposal>("GET", `/proposals/${p.slug}`)).body)).not.toContain("A brand new paragraph.");

    const second = await call<PublishBody>("POST", `/proposals/${p.id}/publish`);
    expect(second.body.proposal).toMatchObject({ current_version: 2, has_unpublished_changes: false, slug: p.slug });
    const pub2 = await publicApi<PublicProposal>("GET", `/proposals/${p.slug}`);
    expect(pub2.body.version).toBe(2);
    expect(JSON.stringify(pub2.body)).toContain("A brand new paragraph.");

    // Publishing again with no changes is a no-op.
    const third = await call<PublishBody>("POST", `/proposals/${p.id}/publish`);
    expect(third.body.published).toBe(false);
    expect(third.body.proposal.current_version).toBe(2);

    const { data } = await adminDb().from("proposal_versions").select("version, reason, content_hash").eq("proposal_id", p.id).order("version");
    expect(data!.map((v) => v.version)).toEqual([1, 2]);
    expect(data!.every((v) => v.reason === "published" && /^[0-9a-f]{64}$/.test(v.content_hash))).toBe(true);
    const events = await adminDb().from("audit_events").select("event_type").eq("proposal_id", p.id);
    expect(events.data!.filter((e) => e.event_type === "published")).toHaveLength(2);
  });

  it("refuses to publish an incomplete proposal, listing what's missing", async () => {
    const p = (await call<ProposalDetail>("POST", "/proposals", { title: "Incomplete" })).body;
    const r = await call<{ error: { code: string; issues: { message: string }[] } }>("POST", `/proposals/${p.id}/publish`);
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe("not_publishable");
    const messages = r.body.error.issues.map((i) => i.message);
    expect(messages).toContain("The proposal's client needs an email address");
    expect(messages).toContain("Add at least one pricing section");
    expect((await publicApi("GET", `/proposals/${p.slug}`)).status).toBe(404);
  });

  it("serves link-preview metadata", async () => {
    const p = await fromTemplate(`Meta ${run}`);
    await call("POST", `/proposals/${p.id}/publish`);
    const meta = await publicApi<PublicProposalMeta>("GET", `/proposals/${p.slug}/meta`);
    expect(meta.body).toEqual({ title: `Meta ${run}`, description: `Proposal for Harbor Dental ${run} from Bridger Digital`, imageUrl: null });
  });

  it("expired proposals hide the document, accept extension requests, and reopen when extended", async () => {
    const p = await fromTemplate(`Expiring ${run}`);
    await call("POST", `/proposals/${p.id}/publish`);
    await adminDb().from("proposals").update({ expires_at: new Date(Date.now() - 60_000).toISOString() }).eq("id", p.id);

    const expired = await publicApi<PublicProposal>("GET", `/proposals/${p.slug}`);
    expect(expired.body.state).toBe("expired");
    expect(expired.body.document).toBeNull();

    const e = env();
    expect((await publicApi("POST", `/proposals/${p.slug}/extension-request`, { message: "Still interested!" }, e)).status).toBe(200);
    const events = await adminDb().from("audit_events").select("event_type, actor, metadata").eq("proposal_id", p.id).eq("event_type", "extension_requested");
    expect(events.data![0]).toMatchObject({ actor: "client", metadata: { message: "Still interested!" } });
    // Rate limited per IP (the Workers Rate Limiting binding; here a stand-in that says no)
    expect((await publicApi("POST", `/proposals/${p.slug}/extension-request`, {}, { ...e, RL_PUBLIC: limiter("deny") })).status).toBe(429);

    // Marked expired (as the Phase 5 cron will do), then extended by moving the date.
    await adminDb().from("proposals").update({ status: "expired" }).eq("id", p.id);
    const later = new Date(Date.now() + 7 * 86_400_000).toISOString();
    const extended = await call<ProposalDetail>("PATCH", `/proposals/${p.id}`, { expiresAt: later });
    expect(extended.body.status).toBe("sent");
    expect((await publicApi<PublicProposal>("GET", `/proposals/${p.slug}`)).body.state).toBe("active");
  });

  it("archived proposals disappear from the public link; active ones can't request extensions", async () => {
    const p = await fromTemplate(`Archive ${run}`);
    await call("POST", `/proposals/${p.id}/publish`);
    expect((await publicApi("POST", `/proposals/${p.slug}/extension-request`, {})).status).toBe(409);
    await call("POST", `/proposals/${p.id}/archive`);
    expect((await publicApi("GET", `/proposals/${p.slug}`)).status).toBe(404);
    expect((await call("POST", `/proposals/${p.id}/publish`)).status).toBe(409);
  });

  it("freezes the owner's signature into the version when the signature block asks for it", async () => {
    const db = adminDb();
    const { data: s } = await db.from("settings").select("owner_id, owner_signature").limit(1).single();
    await db.from("settings").update({ owner_signature: { name: "John Bridger", title: "Founder", type: "typed", text: "John Bridger" } }).eq("owner_id", s!.owner_id);
    try {
      const p = await fromTemplate(`Owner sig ${run}`);
      await call("POST", `/proposals/${p.id}/publish`);
      await db.from("settings").update({ owner_signature: { name: "Someone Else", title: "X", type: "typed", text: "Someone Else" } }).eq("owner_id", s!.owner_id);
      const pub = await publicApi<PublicProposal>("GET", `/proposals/${p.slug}`);
      expect(pub.body.document!.ownerSignature).toMatchObject({ name: "John Bridger" });
    } finally {
      await db.from("settings").update({ owner_signature: s!.owner_signature }).eq("owner_id", s!.owner_id);
    }
  });

  it("records link copies in the audit log", async () => {
    const p = await fromTemplate("Copy link");
    expect((await call("POST", `/proposals/${p.id}/events`, { type: "link_copied" })).status).toBe(204);
    const { data } = await adminDb().from("audit_events").select("event_type").eq("proposal_id", p.id).eq("event_type", "link_copied");
    expect(data).toHaveLength(1);
  });
});
