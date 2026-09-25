import type { ClientRow, ProposalDetail, TemplateSummary } from "@bridger/shared";
import { beforeAll, describe, expect, it } from "vitest";
import { memoryOutbox } from "../../src/lib/email.js";
import { ownerCookieValue } from "../../src/lib/ownerCookie.js";
import { adminDb, api, background, env, ownerToken, trackApi } from "./helpers.js";

type Call = ReturnType<typeof api>;
let call: Call;
let client: ClientRow;
let template: TemplateSummary;
const run = Date.now().toString(36);
const E = env();
const flush = async () => void (await Promise.all(background.splice(0)));

beforeAll(async () => {
  call = api(await ownerToken());
  client = (await call<ClientRow>("POST", "/clients", { name: `Jordan ${run}`, company: `Maple ${run}`, email: `jordan.${run}@maple.test` })).body;
  template = (await call<TemplateSummary[]>("GET", "/templates")).body.find((t) => t.name === "Content War Chest")!;
});

async function published(title: string) {
  const p = (await call<ProposalDetail>("POST", "/proposals", { title, clientId: client.id, templateId: template.id })).body;
  await call("POST", `/proposals/${p.id}/publish`);
  return (await call<ProposalDetail>("GET", `/proposals/${p.id}`)).body;
}

const start = (slug: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
  trackApi<{ sessionId: string; tracking: boolean }>("/session", { slug, version: 1, visitorId: `visitor_${run}`, device: "desktop", viewportW: 1440, viewportH: 900, referrer: "https://mail.google.com/mail/u/0/#inbox?secret=1", ...extra }, headers, E);

const events = (sessionId: string, patch: Record<string, unknown> = {}) =>
  trackApi("/events", { sessionId, blockStats: [], points: [], pricing: [], activeMsDelta: 0, maxScrollPct: 0, ...patch }, {}, E);

describe("tracking ingest", () => {
  it("a real visit starts a session, marks the proposal viewed, and audits it", async () => {
    const p = await published(`Viewed ${run}`);
    const r = await start(p.slug);
    expect(r.status).toBe(200);
    expect(r.body.tracking).toBe(true);
    await flush();
    const detail = (await call<ProposalDetail>("GET", `/proposals/${p.id}`)).body;
    expect(detail.status).toBe("viewed");
    expect(detail.last_viewed_at).not.toBeNull();
    const { data } = await adminDb().from("view_sessions").select("referrer, browser, os, ip_hash, is_owner, is_bot").eq("id", r.body.sessionId).single();
    expect(data).toMatchObject({ referrer: "mail.google.com", browser: "Safari", os: "macOS", is_owner: false, is_bot: false });
    expect(data!.ip_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(data)).not.toContain("198.51.100.7");
    const audit = await adminDb().from("audit_events").select("event_type").eq("proposal_id", p.id).eq("event_type", "viewed");
    expect(audit.data).toHaveLength(1);
  });

  it("bots, owner hints, the owner cookie, and excluded IPs never count", async () => {
    const p = await published(`Not counted ${run}`);
    const bot = await start(p.slug, {}, { "User-Agent": "Mozilla/5.0 (compatible; Microsoft Office/16.0; Windows NT 10.0)" });
    const hinted = await start(p.slug, { ownerHint: true });
    const cookie = await start(p.slug, {}, { Cookie: `other=1; bdp_owner=${await ownerCookieValue(E.SIGNING_SECRET)}` });
    const forged = await start(p.slug, {}, { Cookie: "bdp_owner=0000" });
    const db = adminDb();
    const { data: s } = await db.from("settings").select("owner_id, excluded_ips").limit(1).single();
    await db.from("settings").update({ excluded_ips: ["203.0.113.50"] }).eq("owner_id", s!.owner_id);
    try {
      const excluded = await start(p.slug, {}, { "CF-Connecting-IP": "203.0.113.50" });
      expect([bot, hinted, cookie, excluded].map((r) => r.body.tracking)).toEqual([false, false, false, false]);
    } finally {
      await db.from("settings").update({ excluded_ips: s!.excluded_ips }).eq("owner_id", s!.owner_id);
    }
    expect(forged.body.tracking).toBe(true);
    await flush();

    // Owner/bot sessions store no events and don't change the proposal
    await events(bot.body.sessionId, { blockStats: [{ blockId: "cwcCover01", visibleMsDelta: 5000, entered: true }], activeMsDelta: 9000 });
    const { count } = await db.from("session_block_stats").select("id", { count: "exact", head: true }).eq("session_id", bot.body.sessionId);
    expect(count).toBe(0);

    const a = (await call<{ overview: { views: number } }>("GET", `/proposals/${p.id}/analytics`)).body;
    expect(a.overview.views).toBe(1); // only the forged-cookie (real) visitor
  });

  it("drafts can't be tracked; oversized payloads are rejected", async () => {
    const draft = (await call<ProposalDetail>("POST", "/proposals", { title: `Draft ${run}`, clientId: client.id, templateId: template.id })).body;
    expect((await start(draft.slug)).status).toBe(404);
    const p = await published(`Big ${run}`);
    const r = await start(p.slug);
    const huge = JSON.stringify({ sessionId: r.body.sessionId, blockStats: [], points: [], pricing: [], activeMsDelta: 0, maxScrollPct: 0, pad: "x".repeat(70_000) });
    expect((await trackApi("/events", huge, {}, E)).status).toBe(413);
  });

  it("first view emails John once, after 5 s of active reading", async () => {
    const p = await published(`First view ${run}`);
    const r = await start(p.slug);
    await events(r.body.sessionId, { activeMsDelta: 3000 });
    await flush();
    expect(memoryOutbox.filter((m) => m.proposalId === p.id && m.template === "first_view")).toHaveLength(0);
    await events(r.body.sessionId, { activeMsDelta: 3000 });
    await events(r.body.sessionId, { activeMsDelta: 3000 });
    await flush();
    expect(memoryOutbox.filter((m) => m.proposalId === p.id && m.template === "first_view")).toHaveLength(1);
  });

  it("a visit 12+ hours after the last one emails a return-visit notice", async () => {
    const p = await published(`Return ${run}`);
    const first = await start(p.slug);
    await flush();
    await adminDb().from("view_sessions").update({ last_seen_at: new Date(Date.now() - 13 * 3_600_000).toISOString() }).eq("id", first.body.sessionId);
    await start(p.slug);
    await flush();
    const mails = memoryOutbox.filter((m) => m.proposalId === p.id && m.template === "return_visit");
    expect(mails).toHaveLength(1);
    expect(mails[0]!.text).toContain("visit #2");
  });
});

describe("analytics", () => {
  it("aggregates sections, pricing choices, sessions, and heatmaps", async () => {
    const p = await published(`Analytics ${run}`);
    const version = (await call<{ content: { blocks: { id: string; type: string }[] }; pricing: { sections: { id: string; mode: string; items: { id: string }[] }[] } }>("GET", `/proposals/${p.id}/versions/1`)).body;
    const cover = version.content.blocks.find((b) => b.type === "cover")!.id;
    const pkg = version.pricing.sections.find((s) => s.mode === "choose_one")!;

    const a = await start(p.slug);
    const b = await start(p.slug, { device: "mobile", visitorId: `other_${run}` });
    await events(a.body.sessionId, {
      blockStats: [{ blockId: cover, visibleMsDelta: 4000, entered: true }],
      points: [
        { blockId: cover, kind: "click", x: 0.25, y: 0.5 },
        { blockId: cover, kind: "move", x: 0.9, y: 0.1 },
      ],
      pricing: [
        { sectionId: pkg.id, itemId: pkg.items[0]!.id, action: "selected" },
        { sectionId: pkg.id, itemId: pkg.items[1]!.id, action: "selected" },
      ],
      activeMsDelta: 6000,
      maxScrollPct: 80,
    });
    await events(a.body.sessionId, { blockStats: [{ blockId: cover, visibleMsDelta: 1000, entered: true }], activeMsDelta: 1000, maxScrollPct: 60 });
    await events(b.body.sessionId, { blockStats: [{ blockId: cover, visibleMsDelta: 2000, entered: true }], points: [{ blockId: cover, kind: "tap", x: 0.5, y: 0.5 }], activeMsDelta: 2000, maxScrollPct: 30 });
    await flush();

    type A = {
      overview: { views: number; uniqueViewers: number; totalActiveMs: number; maxScrollPct: number; devices: Record<string, number> };
      sections: { blockId: string; label: string; avgVisibleMs: number; reReadSessions: number }[];
      pricing: { items: { itemId: string; selected: number; endedSelected: number }[] };
      sessions: { id: string; device: string; scrollPct: number }[];
    };
    const r = (await call<A>("GET", `/proposals/${p.id}/analytics`)).body;
    expect(r.overview).toMatchObject({ views: 2, uniqueViewers: 2, totalActiveMs: 9000, maxScrollPct: 80, devices: { desktop: 1, mobile: 1, tablet: 0 } });
    const coverStats = r.sections.find((s) => s.blockId === cover)!;
    expect(coverStats).toMatchObject({ label: "Cover: Content War Chest", avgVisibleMs: 3500, reReadSessions: 1 });
    // Choosing Full after Half: both toggled once, only Full ends selected
    expect(r.pricing.items.find((i) => i.itemId === pkg.items[0]!.id)).toMatchObject({ selected: 1, endedSelected: 0 });
    expect(r.pricing.items.find((i) => i.itemId === pkg.items[1]!.id)).toMatchObject({ selected: 1, endedSelected: 1 });
    expect(r.sessions.find((s) => s.id === a.body.sessionId)).toMatchObject({ device: "desktop", scrollPct: 80 });

    const session = (await call<{ blocks: { label: string; visibleMs: number; timesEntered: number }[] }>("GET", `/proposals/${p.id}/analytics/sessions/${a.body.sessionId}`)).body;
    expect(session.blocks[0]).toMatchObject({ label: "Cover: Content War Chest", visibleMs: 5000, timesEntered: 2 });

    const clicks = (await call<{ cells: { blockId: string; x: number; y: number; count: number }[] }>("GET", `/proposals/${p.id}/analytics/heatmap?version=1&device=desktop&kind=clicks`)).body;
    expect(clicks.cells).toEqual([{ blockId: cover, x: 12, y: 25, count: 1 }]);
    const mobile = (await call<{ cells: unknown[] }>("GET", `/proposals/${p.id}/analytics/heatmap?version=1&device=mobile&kind=clicks`)).body;
    expect(mobile.cells).toEqual([{ blockId: cover, x: 25, y: 25, count: 1 }]);
    const moves = (await call<{ cells: unknown[] }>("GET", `/proposals/${p.id}/analytics/heatmap?version=1&device=desktop&kind=moves`)).body;
    expect(moves.cells).toEqual([{ blockId: cover, x: 45, y: 5, count: 1 }]);

    const audit = (await call<{ event_type: string }[]>("GET", `/proposals/${p.id}/audit`)).body;
    expect(audit.map((e) => e.event_type)).toEqual(expect.arrayContaining(["created", "published", "viewed"]));
    const versions = (await call<{ version: number; reason: string }[]>("GET", `/proposals/${p.id}/versions`)).body;
    expect(versions).toEqual([expect.objectContaining({ version: 1, reason: "published" })]);
  });
});
