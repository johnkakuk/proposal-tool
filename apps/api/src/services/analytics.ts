import { blockRegistry, type Block, type Pricing, type ProposalContent } from "@bridger/shared";
import { ApiError } from "../lib/errors.js";
import { must, type ServiceContext } from "./context.js";
import { getProposal } from "./proposals.js";

/**
 * Proposal analytics for the sidebar (SPEC §7.3). Owner and bot sessions never appear.
 * Volumes per proposal are small (a few hundred sessions at most), so aggregation
 * happens here rather than in SQL views.
 */

interface SessionRow {
  id: string;
  version: number;
  visitor_id: string;
  session_start: string;
  last_seen_at: string;
  active_ms: number;
  max_scroll_pct: number;
  device: "desktop" | "tablet" | "mobile";
  browser: string | null;
  os: string | null;
  referrer: string | null;
  country: string | null;
  region: string | null;
}

/** A readable name for a block: its heading, cover title, or first words. */
export function blockLabel(b: Block): string {
  const words = (s: string, n = 48) => {
    const clean = s.replace(/[#*_>`[\]()-]/g, " ").replace(/\s+/g, " ").trim();
    return clean.length > n ? `${clean.slice(0, n - 1)}…` : clean;
  };
  switch (b.type) {
    case "heading":
      return b.props.text || "Heading";
    case "text":
      return words(b.props.markdown) || "Text";
    case "cover":
      return `Cover: ${b.props.title}`;
    case "deliverables":
    case "terms":
    case "case_study":
      return `${blockRegistry[b.type].label}: ${b.props.title}`;
    case "cta":
      return `Call to action: ${b.props.heading}`;
    default:
      return blockRegistry[b.type].label;
  }
}

async function realSessions(ctx: ServiceContext, proposalId: string): Promise<SessionRow[]> {
  return must(
    await ctx.db
      .from("view_sessions")
      .select("id, version, visitor_id, session_start, last_seen_at, active_ms, max_scroll_pct, device, browser, os, referrer, country, region")
      .eq("owner_id", ctx.ownerId)
      .eq("proposal_id", proposalId)
      .eq("is_owner", false)
      .eq("is_bot", false)
      .order("session_start", { ascending: false })
      .limit(2000),
    "load sessions",
  ) as SessionRow[];
}

async function latestPublished(ctx: ServiceContext, proposalId: string, currentVersion: number): Promise<{ content: ProposalContent; pricing: Pricing } | null> {
  if (currentVersion === 0) return null;
  return must(
    await ctx.db.from("proposal_versions").select("content, pricing").eq("proposal_id", proposalId).eq("owner_id", ctx.ownerId).eq("version", currentVersion).maybeSingle(),
    "load the version",
  ) as { content: ProposalContent; pricing: Pricing } | null;
}

export async function getAnalytics(ctx: ServiceContext, id: string) {
  const p = await getProposal(ctx, id);
  const [sessions, doc] = await Promise.all([realSessions(ctx, id), latestPublished(ctx, id, p.current_version)]);
  const ids = new Set(sessions.map((s) => s.id));

  // Overview
  const totalActiveMs = sessions.reduce((a, s) => a + Number(s.active_ms), 0);
  const devices = { desktop: 0, tablet: 0, mobile: 0 };
  for (const s of sessions) devices[s.device]++;
  const overview = {
    views: sessions.length,
    uniqueViewers: new Set(sessions.map((s) => s.visitor_id)).size,
    totalActiveMs,
    avgActiveMs: sessions.length ? Math.round(totalActiveMs / sessions.length) : 0,
    maxScrollPct: sessions.reduce((a, s) => Math.max(a, s.max_scroll_pct), 0),
    avgScrollPct: sessions.length ? Math.round(sessions.reduce((a, s) => a + s.max_scroll_pct, 0) / sessions.length) : 0,
    devices,
    firstViewedAt: sessions.at(-1)?.session_start ?? null,
    lastSeenAt: sessions[0]?.last_seen_at ?? null,
    status: p.status,
  };

  // Sections: average visible time per block across all real sessions
  const stats = must(
    await ctx.db
      .from("session_block_stats")
      .select("session_id, block_id, visible_ms, times_entered, view_sessions!inner(proposal_id, is_owner, is_bot)")
      .eq("view_sessions.proposal_id", id)
      .eq("view_sessions.is_owner", false)
      .eq("view_sessions.is_bot", false)
      .limit(20_000),
    "load section stats",
  ) as { session_id: string; block_id: string; visible_ms: number; times_entered: number }[];
  const byBlock = new Map<string, { total: number; sessions: number; reReads: number }>();
  for (const r of stats) {
    if (!ids.has(r.session_id)) continue;
    const b = byBlock.get(r.block_id) ?? { total: 0, sessions: 0, reReads: 0 };
    b.total += Number(r.visible_ms);
    b.sessions++;
    if (r.times_entered > 1) b.reReads++;
    byBlock.set(r.block_id, b);
  }
  const blocks = (doc?.content.blocks ?? []).filter((b) => !b.hidden && b.type !== "divider" && b.type !== "page_break");
  const sections = blocks.map((b) => {
    const s = byBlock.get(b.id);
    return { blockId: b.id, type: b.type, label: blockLabel(b), avgVisibleMs: sessions.length && s ? Math.round(s.total / sessions.length) : 0, sessionsSeen: s?.sessions ?? 0, reReadSessions: s?.reReads ?? 0 };
  });

  // Pricing: toggle counts, final choices per session, package preferences
  const interactions = must(
    await ctx.db.from("pricing_interactions").select("session_id, section_id, item_id, action, occurred_at").eq("proposal_id", id).order("occurred_at").limit(20_000),
    "load pricing activity",
  ) as { session_id: string; section_id: string; item_id: string; action: "selected" | "deselected"; occurred_at: string }[];
  const names = new Map<string, { section: string; item: string; mode: string }>();
  for (const s of doc?.pricing.sections ?? []) for (const i of s.items) names.set(`${s.id}/${i.id}`, { section: s.title, item: i.name, mode: s.mode });
  const toggles = new Map<string, { selected: number; deselected: number }>();
  const final = new Map<string, Map<string, boolean>>(); // session → item key → selected?
  for (const e of interactions) {
    if (!ids.has(e.session_id)) continue;
    const key = `${e.section_id}/${e.item_id}`;
    const t = toggles.get(key) ?? { selected: 0, deselected: 0 };
    t[e.action]++;
    toggles.set(key, t);
    const f = final.get(e.session_id) ?? new Map<string, boolean>();
    if (names.get(key)?.mode === "choose_one" && e.action === "selected") {
      for (const k of f.keys()) if (k.startsWith(`${e.section_id}/`)) f.set(k, false);
    }
    f.set(key, e.action === "selected");
    final.set(e.session_id, f);
  }
  const finalCounts = new Map<string, number>();
  for (const f of final.values()) for (const [k, on] of f) if (on) finalCounts.set(k, (finalCounts.get(k) ?? 0) + 1);
  const pricing = {
    sessionsWithActivity: final.size,
    items: [...names.entries()].map(([key, n]) => {
      const [sectionId, itemId] = key.split("/") as [string, string];
      return { sectionId, itemId, section: n.section, item: n.item, mode: n.mode, ...(toggles.get(key) ?? { selected: 0, deselected: 0 }), endedSelected: finalCounts.get(key) ?? 0 };
    }),
  };

  const sessionList = sessions.map((s) => ({
    id: s.id,
    version: s.version,
    start: s.session_start,
    lastSeen: s.last_seen_at,
    activeMs: Number(s.active_ms),
    device: s.device,
    browser: s.browser,
    os: s.os,
    location: [s.region, s.country].filter(Boolean).join(", ") || null,
    scrollPct: s.max_scroll_pct,
    referrer: s.referrer,
  }));

  return { overview, sections, pricing, sessions: sessionList };
}

export async function getSessionDetail(ctx: ServiceContext, id: string, sessionId: string) {
  const s = must(
    await ctx.db.from("view_sessions").select("id, version, session_start, active_ms, device").eq("owner_id", ctx.ownerId).eq("proposal_id", id).eq("id", sessionId).eq("is_owner", false).eq("is_bot", false).maybeSingle(),
    "load the session",
  ) as { id: string; version: number; session_start: string; active_ms: number; device: string } | null;
  if (!s) throw new ApiError(404, "not_found", "Session not found");
  const [rows, version] = await Promise.all([
    ctx.db.from("session_block_stats").select("block_id, visible_ms, times_entered, first_seen_at").eq("session_id", sessionId).order("first_seen_at"),
    ctx.db.from("proposal_versions").select("content").eq("proposal_id", id).eq("version", s.version).maybeSingle(),
  ]);
  const blocks = new Map(((version.data?.content as ProposalContent | undefined)?.blocks ?? []).map((b) => [b.id, b]));
  return {
    session: s,
    blocks: ((rows.data ?? []) as { block_id: string; visible_ms: number; times_entered: number; first_seen_at: string }[]).map((r) => ({
      blockId: r.block_id,
      label: blocks.has(r.block_id) ? blockLabel(blocks.get(r.block_id)!) : r.block_id,
      visibleMs: Number(r.visible_ms),
      timesEntered: r.times_entered,
      firstSeenAt: r.first_seen_at,
    })),
  };
}

export async function getAuditTrail(ctx: ServiceContext, id: string) {
  await getProposal(ctx, id);
  return must(
    await ctx.db.from("audit_events").select("id, event_type, occurred_at, actor, ip, metadata").eq("owner_id", ctx.ownerId).eq("proposal_id", id).order("occurred_at", { ascending: false }).limit(1000),
    "load the audit trail",
  ) as { id: string; event_type: string; occurred_at: string; actor: string; ip: string | null; metadata: Record<string, unknown> }[];
}

export async function listVersions(ctx: ServiceContext, id: string) {
  await getProposal(ctx, id);
  return must(
    await ctx.db.from("proposal_versions").select("version, reason, created_at, content_hash").eq("owner_id", ctx.ownerId).eq("proposal_id", id).order("version", { ascending: false }),
    "load versions",
  ) as { version: number; reason: "published" | "signed"; created_at: string; content_hash: string }[];
}

export async function getVersion(ctx: ServiceContext, id: string, version: number) {
  const row = must(
    await ctx.db.from("proposal_versions").select("version, reason, created_at, content, pricing, owner_signature").eq("owner_id", ctx.ownerId).eq("proposal_id", id).eq("version", version).maybeSingle(),
    "load the version",
  );
  if (!row) throw new ApiError(404, "not_found", "Version not found");
  return row as { version: number; reason: string; created_at: string; content: ProposalContent; pricing: Pricing; owner_signature: unknown };
}

export async function getHeatmap(ctx: ServiceContext, id: string, q: { version: number; device: "desktop" | "tablet" | "mobile"; kind: "clicks" | "moves"; sessionId?: string }) {
  await getProposal(ctx, id);
  const kinds = q.kind === "clicks" ? ["click", "tap"] : ["move"];
  const cells = must(
    await ctx.db.rpc("heatmap_grid", { p_proposal_id: id, p_version: q.version, p_device: q.device, p_kinds: kinds, p_session_id: q.sessionId ?? null }),
    "load the heatmap",
  ) as { block_id: string; cell_x: number; cell_y: number; count: number }[];
  return { cells: cells.map((c) => ({ blockId: c.block_id, x: c.cell_x, y: c.cell_y, count: Number(c.count) })) };
}
