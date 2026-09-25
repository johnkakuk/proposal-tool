import type { ClientDetail, ClientRow, ProposalDetail, ProposalSummary, TemplateDetail, TemplateSummary } from "@bridger/shared";
import { beforeAll, describe, expect, it } from "vitest";
import { adminDb, api, ownerToken } from "./helpers.js";

type Call = ReturnType<typeof api>;
let call: Call;
const run = Date.now().toString(36);

beforeAll(async () => {
  call = api(await ownerToken());
});

describe("auth", () => {
  it("rejects missing and forged tokens", async () => {
    expect((await api(null)("GET", "/proposals")).status).toBe(401);
    expect((await api("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.bad")("GET", "/proposals")).status).toBe(401);
  });
});

describe("clients", () => {
  it("CRUD with validation", async () => {
    const bad = await call<{ error: { code: string; message: string } }>("POST", "/clients", { name: "", email: "not-an-email" });
    expect(bad.status).toBe(422);
    expect(bad.body.error.message).toMatch(/Client name is required/);

    const created = await call<ClientRow>("POST", "/clients", { name: `Jane ${run}`, company: `Acme Roofing ${run}`, email: "jane@acme.test", website: "" });
    expect(created.status).toBe(201);
    expect(created.body.website).toBeNull();

    const updated = await call<ClientRow>("PATCH", `/clients/${created.body.id}`, { phone: "555-0100" });
    expect(updated.body.phone).toBe("555-0100");

    const list = await call<ClientRow[]>("GET", `/clients?q=${run}`);
    expect(list.body.map((c) => c.id)).toContain(created.body.id);

    expect((await call("DELETE", `/clients/${created.body.id}`)).status).toBe(204);
    expect((await call("GET", `/clients/${created.body.id}`)).status).toBe(404);
  });
});

describe("proposals", () => {
  let client: ClientRow;
  let template: TemplateSummary;

  beforeAll(async () => {
    client = (await call<ClientRow>("POST", "/clients", { name: `Sam ${run}`, company: `Peak Plumbing ${run}`, email: "sam@peak.test" })).body;
    template = (await call<TemplateSummary[]>("GET", "/templates")).body.find((t) => t.name === "Content War Chest")!;
  });

  it("creates a blank proposal with a cover and signature", async () => {
    const r = await call<ProposalDetail>("POST", "/proposals", { title: "Blank test", clientId: client.id });
    expect(r.status).toBe(201);
    expect(r.body.status).toBe("draft");
    expect(r.body.slug).toMatch(/^[A-Za-z0-9_-]{21}$/);
    expect(r.body.content.blocks.map((b) => b.type)).toEqual(["cover", "text", "signature"]);
    expect(r.body.content.blocks[0]!.props).toMatchObject({ title: "Blank test", clientName: `Peak Plumbing ${run}` });
  });

  it("inserts a Terms block pre-filled with the default terms unless terms are given", async () => {
    const p = (await call<ProposalDetail>("POST", "/proposals", { title: "Terms test", clientId: client.id })).body;
    const defaultTerms = (await call<{ defaultTermsMarkdown: string }>("GET", "/workspace/context")).body.defaultTermsMarkdown;
    const inserted = await call<{ proposal: ProposalDetail; blockId: string }>("POST", `/proposals/${p.id}/blocks`, { block: { type: "terms" } });
    expect(inserted.status).toBe(201);
    const block = inserted.body.proposal.content.blocks.find((b) => b.id === inserted.body.blockId)!;
    expect(block.props).toMatchObject({ title: "Terms & Conditions", markdown: defaultTerms });
    expect(defaultTerms.length).toBeGreaterThan(0);

    const custom = await call<{ proposal: ProposalDetail; blockId: string }>("POST", `/proposals/${p.id}/blocks`, { block: { type: "terms", props: { markdown: "Net 15." } } });
    expect(custom.body.proposal.content.blocks.find((b) => b.id === custom.body.blockId)!.props).toMatchObject({ markdown: "Net 15." });
  });

  it("creates from a template, filling in placeholders and computing totals", async () => {
    const r = await call<ProposalDetail>("POST", "/proposals", { title: "From template", clientId: client.id, templateId: template.id });
    expect(r.status).toBe(201);
    expect(r.body.created_via).toBe("template");
    const json = JSON.stringify(r.body.content);
    expect(json).not.toContain("{{");
    expect(json).toContain(`Peak Plumbing ${run}`);
    expect(json).toContain("Deposit"); // default terms from settings
    expect(r.body.total_one_time_cents).toBe(800_000);
    expect(r.body.totals?.total.one_time).toBe(800_000);
  });

  it("saves edits, recomputes totals server-side, and enforces optimistic concurrency", async () => {
    const p = (await call<ProposalDetail>("POST", "/proposals", { title: "Edit me", clientId: client.id, templateId: template.id })).body;
    const pricing = structuredClone(p.pricing);
    pricing.sections[0]!.items[0]!.selectedByDefault = true;
    pricing.sections[0]!.items[1]!.selectedByDefault = false;
    const saved = await call<ProposalDetail>("PATCH", `/proposals/${p.id}`, {
      title: "Edited",
      pricing,
      baseUpdatedAt: p.updated_at,
      // A client can't smuggle totals in; unknown keys are ignored.
      total_one_time_cents: 1,
    });
    expect(saved.status).toBe(200);
    expect(saved.body.title).toBe("Edited");
    expect(saved.body.total_one_time_cents).toBe(450_000);

    const stale = await call<{ error: { code: string } }>("PATCH", `/proposals/${p.id}`, { title: "Stale", baseUpdatedAt: p.updated_at });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("conflict");
  });

  it("returns model-readable errors for broken documents", async () => {
    const p = (await call<ProposalDetail>("POST", "/proposals", { title: "Broken", clientId: client.id, templateId: template.id })).body;
    const content = structuredClone(p.content);
    const idx = content.blocks.findIndex((b) => b.type === "pricing");
    (content.blocks[idx]!.props as { pricingSectionIds: string[] }).pricingSectionIds = ["sec_retainer"];
    const r = await call<{ error: { code: string; message: string } }>("PATCH", `/proposals/${p.id}`, { content });
    expect(r.status).toBe(422);
    expect(r.body.error.message).toContain(`Block ${idx + 1} (pricing) references unknown pricing section 'sec_retainer'`);
  });

  it("refuses to edit a signed proposal and offers a new revision", async () => {
    const p = (await call<ProposalDetail>("POST", "/proposals", { title: "Signed one", clientId: client.id })).body;
    const db = adminDb();
    await db.from("proposal_versions").insert({ owner_id: (await db.from("proposals").select("owner_id").eq("id", p.id).single()).data!.owner_id, proposal_id: p.id, version: 1, content: p.content, pricing: p.pricing, content_hash: "a".repeat(64), reason: "signed" });
    const { error } = await db.from("proposals").update({ status: "signed", signed_at: new Date().toISOString(), current_version: 1 }).eq("id", p.id);
    expect(error).toBeNull();

    const r = await call<{ error: { code: string } }>("PATCH", `/proposals/${p.id}`, { title: "Nope" });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("locked");

    const rev = await call<ProposalDetail>("POST", `/proposals/${p.id}/duplicate`, { asRevision: true });
    expect(rev.status).toBe(201);
    expect(rev.body).toMatchObject({ status: "draft", title: "Signed one", revision_of: p.id });
  });

  it("saves a proposal as a template", async () => {
    const p = (await call<ProposalDetail>("POST", "/proposals", { title: "Templatize", clientId: client.id, templateId: template.id })).body;
    const t = await call<TemplateDetail>("POST", `/proposals/${p.id}/save-as-template`, { name: `Saved ${run}`, category: "Test" });
    expect(t.status).toBe(201);
    expect(t.body.content.blocks.length).toBe(p.content.blocks.length);
    expect((await call("DELETE", `/templates/${t.body.id}`)).status).toBe(204);
  });

  it("lists proposals and a client's proposals; blocks deleting a client with proposals", async () => {
    const list = await call<ProposalSummary[]>("GET", `/proposals?q=${encodeURIComponent("From template")}`);
    expect(list.body[0]!.client?.company).toBeDefined();
    const detail = await call<ClientDetail>("GET", `/clients/${client.id}`);
    expect(detail.body.proposals.length).toBeGreaterThanOrEqual(5);
    const del = await call<{ error: { code: string } }>("DELETE", `/clients/${client.id}`);
    expect(del.status).toBe(409);
  });

  it("restores archived proposals to their natural status", async () => {
    const draft = (await call<ProposalDetail>("POST", "/proposals", { title: `Restore draft ${run}` })).body;
    await call("POST", `/proposals/${draft.id}/archive`);
    expect((await call<ProposalDetail>("POST", `/proposals/${draft.id}/restore`)).body.status).toBe("draft");

    const pub = (await call<ProposalDetail>("POST", "/proposals", { title: `Restore sent ${run}`, clientId: client.id, templateId: template.id })).body;
    await call("POST", `/proposals/${pub.id}/publish`);
    await call("POST", `/proposals/${pub.id}/archive`);
    const restored = (await call<ProposalDetail>("POST", `/proposals/${pub.id}/restore`)).body;
    expect(restored.status).toBe("sent");
    expect(restored.current_version).toBe(1);
  });

  it("permanently deletes archived, unsigned proposals only", async () => {
    const p = (await call<ProposalDetail>("POST", "/proposals", { title: `Purge ${run}`, clientId: client.id, templateId: template.id })).body;
    await call("POST", `/proposals/${p.id}/publish`);
    expect((await call<{ error: { code: string } }>("DELETE", `/proposals/${p.id}`)).body.error.code).toBe("not_archived");
    await call("POST", `/proposals/${p.id}/archive`);
    expect((await call("DELETE", `/proposals/${p.id}`)).status).toBe(204);
    expect((await call("GET", `/proposals/${p.id}`)).status).toBe(404);
    const { count } = await adminDb().from("audit_events").select("id", { count: "exact", head: true }).eq("proposal_id", p.id);
    expect(count).toBe(0);
  });

  it("archives, hiding it from the default list", async () => {
    const p = (await call<ProposalDetail>("POST", "/proposals", { title: `Archive me ${run}` })).body;
    expect((await call<ProposalDetail>("POST", `/proposals/${p.id}/archive`)).body.status).toBe("archived");
    expect((await call<ProposalSummary[]>("GET", `/proposals?q=${run}`)).body.map((x) => x.id)).not.toContain(p.id);
    expect((await call<ProposalSummary[]>("GET", `/proposals?status=archived&q=${run}`)).body.map((x) => x.id)).toContain(p.id);
  });
});

describe("templates", () => {
  it("create, update, duplicate, delete", async () => {
    const t = await call<TemplateDetail>("POST", "/templates", { name: `Tpl ${run}` });
    expect(t.status).toBe(201);
    const u = await call<TemplateDetail>("PATCH", `/templates/${t.body.id}`, { description: "Updated", baseUpdatedAt: t.body.updated_at });
    expect(u.body.description).toBe("Updated");
    const d = await call<TemplateDetail>("POST", `/templates/${t.body.id}/duplicate`);
    expect(d.body.name).toBe(`Tpl ${run} (copy)`);
    for (const id of [t.body.id, d.body.id]) expect((await call("DELETE", `/templates/${id}`)).status).toBe(204);
  });
});
