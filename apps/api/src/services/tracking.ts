import { isBotUserAgent, sha256Hex, type TrackEvents, type TrackSessionSchema } from "@bridger/shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import type { Env } from "../env.js";
import { ApiError } from "../lib/errors.js";
import { hasOwnerCookie } from "../lib/ownerCookie.js";
import { must } from "./context.js";
import { FIRST_VIEW_ACTIVE_MS, onViewActivity } from "./notify.js";
import { loadPublicRow, publicState } from "./public.js";

/**
 * Tracking ingest (SPEC §11.2). Owner and bot visits are recorded as flagged sessions but
 * never store events, never change proposal status, and never trigger notifications.
 */

export interface RequestInfo {
  ip: string;
  userAgent: string | undefined;
  cookie: string | undefined;
  geo?: { country?: string; region?: string; city?: string };
}

export function parseUserAgent(ua = ""): { browser: string; os: string } {
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua)
      ? "Opera"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : "Other";
  const os = /iPhone|iPad|iPod/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "Other";
  return { browser, os };
}

const referrerHost = (ref?: string) => {
  try {
    return ref ? new URL(ref).hostname || null : null;
  } catch {
    return null;
  }
};

export interface StartedSession {
  sessionId: string;
  /** False for owner and bot sessions: the tracker should stop. */
  tracking: boolean;
}

export async function startSession(env: Env, db: SupabaseClient, input: z.output<typeof TrackSessionSchema>, req: RequestInfo): Promise<{ result: StartedSession; background?: Promise<void> }> {
  const row = await loadPublicRow(db, input.slug);
  const state = publicState(row);
  if (state !== "active" && state !== "signed") throw new ApiError(409, "not_trackable", "Nothing to track on this page.");
  const version = input.version <= row.current_version ? input.version : row.current_version;

  const settings = (await db.from("settings").select("excluded_ips").eq("owner_id", row.owner_id).maybeSingle()).data as { excluded_ips: string[] } | null;
  const isBot = isBotUserAgent(req.userAgent);
  const isOwner = input.ownerHint || (settings?.excluded_ips ?? []).includes(req.ip) || (await hasOwnerCookie(req.cookie, env.SIGNING_SECRET));
  const { browser, os } = parseUserAgent(req.userAgent);

  const session = must(
    await db
      .from("view_sessions")
      .insert({
        owner_id: row.owner_id,
        proposal_id: row.id,
        version,
        visitor_id: input.visitorId,
        device: input.device,
        viewport_w: input.viewportW,
        viewport_h: input.viewportH,
        browser,
        os,
        referrer: referrerHost(input.referrer),
        country: req.geo?.country ?? null,
        region: req.geo?.region ?? null,
        ip_hash: await sha256Hex(`${env.TRACKING_SALT}:${req.ip}`),
        is_owner: isOwner,
        is_bot: isBot,
      })
      .select("id, session_start")
      .single(),
    "start the session",
  ) as { id: string; session_start: string };

  const tracking = !isOwner && !isBot;
  if (!tracking) return { result: { sessionId: session.id, tracking } };

  // A real view: status sent → viewed, first/last viewed, audit, and return-visit check.
  const background = (async () => {
    const now = new Date().toISOString();
    if (!row.signed_at) {
      await db.from("proposals").update({ last_viewed_at: now }).eq("id", row.id);
      await db.from("proposals").update({ first_viewed_at: now }).eq("id", row.id).is("first_viewed_at", null);
      await db.from("proposals").update({ status: "viewed" }).eq("id", row.id).eq("status", "sent");
    }
    await db.from("audit_events").insert({
      owner_id: row.owner_id,
      proposal_id: row.id,
      event_type: "viewed",
      actor: "client",
      ip: req.ip,
      user_agent: req.userAgent ?? null,
      metadata: { sessionId: session.id, device: input.device, version },
    });
    const previous = (await db
      .from("view_sessions")
      .select("last_seen_at")
      .eq("proposal_id", row.id)
      .eq("is_owner", false)
      .eq("is_bot", false)
      .neq("id", session.id)
      .order("last_seen_at", { ascending: false })
      .limit(1)
      .maybeSingle()).data as { last_seen_at: string } | null;
    if (previous) {
      const { count } = await db.from("view_sessions").select("id", { count: "exact", head: true }).eq("proposal_id", row.id).eq("is_owner", false).eq("is_bot", false);
      await onViewActivity(env, db, { proposalId: row.id, activeMs: 0, sessionStart: session.session_start, previousSessionEnd: previous.last_seen_at, visitNumber: count ?? 1 });
    }
  })().catch((e) => console.error("view bookkeeping failed", e));

  return { result: { sessionId: session.id, tracking }, background };
}

export async function ingestEvents(env: Env, db: SupabaseClient, input: TrackEvents): Promise<{ background?: Promise<void> }> {
  const res = await db.rpc("ingest_tracking", {
    p_session_id: input.sessionId,
    p_blocks: input.blockStats,
    p_points: input.points,
    p_pricing: input.pricing,
    p_active_ms_delta: input.activeMsDelta,
    p_max_scroll: input.maxScrollPct,
  });
  if (res.error?.code === "P0002") throw new ApiError(404, "no_session", "Unknown session.");
  const [totals] = must(res, "record activity") as { active_ms_before: number; active_ms_after: number }[];
  if (!totals || totals.active_ms_before >= FIRST_VIEW_ACTIVE_MS || totals.active_ms_after < FIRST_VIEW_ACTIVE_MS) return {};

  // Crossed 5 s of real reading: first-view notification (deduped to once per proposal).
  const s = (await db.from("view_sessions").select("proposal_id, session_start, device, region, country, is_owner, is_bot").eq("id", input.sessionId).single()).data as {
    proposal_id: string;
    session_start: string;
    device: string;
    region: string | null;
    country: string | null;
    is_owner: boolean;
    is_bot: boolean;
  } | null;
  if (!s || s.is_owner || s.is_bot) return {};
  return {
    background: onViewActivity(env, db, {
      proposalId: s.proposal_id,
      activeMs: totals.active_ms_after,
      sessionStart: s.session_start,
      previousSessionEnd: null,
      visitNumber: 1,
      device: s.device,
      where: [s.region, s.country].filter(Boolean).join(", ") || undefined,
    }).catch((e) => console.error("first-view notification failed", e)),
  };
}
