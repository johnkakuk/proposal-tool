import type { Pricing, ProposalContent } from "@bridger/shared";

export type Device = "desktop" | "tablet" | "mobile";

export interface Analytics {
  overview: {
    views: number;
    uniqueViewers: number;
    totalActiveMs: number;
    avgActiveMs: number;
    maxScrollPct: number;
    avgScrollPct: number;
    devices: Record<Device, number>;
    firstViewedAt: string | null;
    lastSeenAt: string | null;
    status: string;
  };
  sections: { blockId: string; type: string; label: string; avgVisibleMs: number; sessionsSeen: number; reReadSessions: number }[];
  pricing: { sessionsWithActivity: number; items: { sectionId: string; itemId: string; section: string; item: string; mode: string; selected: number; deselected: number; endedSelected: number }[] };
  sessions: { id: string; version: number; start: string; lastSeen: string; activeMs: number; device: Device; browser: string | null; os: string | null; location: string | null; scrollPct: number; referrer: string | null }[];
}

export interface SessionDetail {
  session: { id: string; version: number; session_start: string; active_ms: number; device: Device };
  blocks: { blockId: string; label: string; visibleMs: number; timesEntered: number; firstSeenAt: string }[];
}

export interface AuditEvent {
  id: string;
  event_type: string;
  occurred_at: string;
  actor: string;
  ip: string | null;
  metadata: Record<string, unknown>;
}

export interface VersionSummary {
  version: number;
  reason: "published" | "signed";
  created_at: string;
  content_hash: string;
}

export interface VersionDetail {
  version: number;
  reason: string;
  created_at: string;
  content: ProposalContent;
  pricing: Pricing;
  owner_signature: { name?: string } | null;
}

export interface HeatmapCells {
  cells: { blockId: string; x: number; y: number; count: number }[];
}

export const duration = (ms: number) => {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${String(s % 60).padStart(2, "0")}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
};
