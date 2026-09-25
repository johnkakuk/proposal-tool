import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "../lib/api";
import { relativeTime } from "../components/ui";
import { diffVersions } from "./diff";
import { duration, type Analytics, type AuditEvent, type Device, type SessionDetail, type VersionDetail, type VersionSummary } from "./types";

/** What the editor canvas should show while the drawer is open. */
export type CanvasView = { kind: "heatmap"; version: number; device: Device; heat: { kind: "clicks" | "moves"; sessionId?: string; opacity: number } } | { kind: "version"; version: number; device: Device } | null;

const TABS = ["Overview", "Sections", "Heatmap", "Pricing", "Sessions", "Audit trail", "Versions"] as const;
type Tab = (typeof TABS)[number];

const when = (iso: string) => new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

/**
 * Analytics sidebar (SPEC §7.3). Owner and bot visits are excluded server-side.
 * Heatmap and Versions switch the editor canvas via `onCanvas`.
 */
export function AnalyticsDrawer({ proposalId, currentVersion, onClose, onCanvas }: { proposalId: string; currentVersion: number; onClose: () => void; onCanvas: (v: CanvasView) => void }) {
  const [tab, setTab] = useState<Tab>("Overview");
  const data = useQuery({ queryKey: ["analytics", proposalId], queryFn: () => api<Analytics>(`/proposals/${proposalId}/analytics`), refetchInterval: 30_000 });
  const versions = useQuery({ queryKey: ["versions", proposalId], queryFn: () => api<VersionSummary[]>(`/proposals/${proposalId}/versions`) });

  useEffect(() => {
    if (tab !== "Heatmap" && tab !== "Versions") onCanvas(null);
  }, [tab, onCanvas]);
  useEffect(() => () => onCanvas(null), [onCanvas]);

  return (
    <aside aria-label="Analytics" className="flex w-full shrink-0 flex-col border-l border-slate-200 bg-white lg:sticky lg:top-[57px] lg:h-[calc(100vh-57px)] lg:w-[26rem]">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <h2 className="font-semibold">Analytics</h2>
        <button type="button" onClick={onClose} aria-label="Close analytics" className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-ink">
          ✕
        </button>
      </div>
      <div role="tablist" aria-label="Analytics views" className="flex flex-wrap gap-1 border-b border-slate-200 px-2 py-1.5">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`shrink-0 rounded-md px-2.5 py-1 text-xs font-medium ${tab === t ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}
          >
            {t}
          </button>
        ))}
      </div>
      <div role="tabpanel" aria-label={tab} className="min-h-0 flex-1 overflow-y-auto p-4">
        {data.isLoading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : !data.data ? (
          <p className="text-sm text-red-700">Couldn't load analytics.</p>
        ) : tab === "Overview" ? (
          <Overview a={data.data} />
        ) : tab === "Sections" ? (
          <Sections a={data.data} />
        ) : tab === "Heatmap" ? (
          <HeatmapControls a={data.data} versions={versions.data ?? []} currentVersion={currentVersion} onCanvas={onCanvas} />
        ) : tab === "Pricing" ? (
          <PricingTab a={data.data} />
        ) : tab === "Sessions" ? (
          <Sessions proposalId={proposalId} a={data.data} />
        ) : tab === "Audit trail" ? (
          <Audit proposalId={proposalId} />
        ) : (
          <Versions proposalId={proposalId} versions={versions.data ?? []} onCanvas={onCanvas} />
        )}
      </div>
    </aside>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-500">{children}</p>;
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-0.5 text-xl font-semibold tabular-nums text-ink">{value}</div>
      {sub && <div className="text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

function Overview({ a }: { a: Analytics }) {
  const o = a.overview;
  if (o.views === 0) return <Empty>No client views yet. Views appear here once someone reads the published proposal for a few seconds. Your own visits never count.</Empty>;
  const devices = (Object.entries(o.devices) as [Device, number][]).filter(([, n]) => n > 0);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <Tile label="Views" value={String(o.views)} sub={`${o.uniqueViewers} unique viewer${o.uniqueViewers === 1 ? "" : "s"}`} />
        <Tile label="Avg. time reading" value={duration(o.avgActiveMs)} sub={`${duration(o.totalActiveMs)} total`} />
        <Tile label="Deepest scroll" value={`${o.maxScrollPct}%`} sub={`avg ${o.avgScrollPct}%`} />
        <Tile label="Last seen" value={o.lastSeenAt ? relativeTime(o.lastSeenAt) : "—"} sub={o.firstViewedAt ? `first ${relativeTime(o.firstViewedAt)}` : undefined} />
      </div>
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Devices</h3>
        <ul className="space-y-1 text-sm">
          {devices.map(([d, n]) => (
            <li key={d} className="flex justify-between">
              <span className="capitalize">{d}</span>
              <span className="tabular-nums text-slate-600">
                {n} ({Math.round((n / o.views) * 100)}%)
              </span>
            </li>
          ))}
        </ul>
      </div>
      <p className="text-xs text-slate-500">
        Status: <span className="capitalize">{o.status}</span>
      </p>
    </div>
  );
}

/** Single-series horizontal bars: average visible time per block, in document order. */
function Sections({ a }: { a: Analytics }) {
  const [hover, setHover] = useState<string | null>(null);
  if (a.overview.views === 0) return <Empty>Section reading times appear after the first client view.</Empty>;
  const max = Math.max(1, ...a.sections.map((s) => s.avgVisibleMs));
  return (
    <div>
      <p className="mb-3 text-xs text-slate-500">Average time each section was on screen per view. ↻ marks sections people came back to.</p>
      <ul className="space-y-2.5" aria-label="Average visible time per section">
        {a.sections.map((s) => {
          const pct = (s.avgVisibleMs / max) * 100;
          return (
            <li
              key={s.blockId}
              className="relative"
              onMouseEnter={() => setHover(s.blockId)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(s.blockId)}
              onBlur={() => setHover(null)}
              tabIndex={0}
            >
              <div className="mb-0.5 flex items-baseline justify-between gap-2 text-xs">
                <span className="truncate text-ink" title={s.label}>
                  {s.label}
                </span>
                <span className="shrink-0 tabular-nums text-slate-600">
                  {duration(s.avgVisibleMs)}
                  {s.reReadSessions > 0 && (
                    <span className="ml-1.5 rounded bg-amber-100 px-1 text-amber-900" title={`${s.reReadSessions} view(s) returned to this section`}>
                      ↻ {s.reReadSessions}
                    </span>
                  )}
                </span>
              </div>
              <div className="h-3 w-full">
                <div className="h-3 rounded-r-[4px] bg-brand transition-[width]" style={{ width: `${Math.max(pct, s.avgVisibleMs > 0 ? 1.5 : 0)}%` }} />
              </div>
              {hover === s.blockId && (
                <div role="tooltip" className="absolute right-0 top-full z-10 mt-1 rounded-md bg-ink px-2 py-1 text-xs text-white shadow">
                  {duration(s.avgVisibleMs)} avg · seen in {s.sessionsSeen} of {a.overview.views} views{s.reReadSessions ? ` · re-read in ${s.reReadSessions}` : ""}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function HeatmapControls({ a, versions, currentVersion, onCanvas }: { a: Analytics; versions: VersionSummary[]; currentVersion: number; onCanvas: (v: CanvasView) => void }) {
  const published = versions.filter((v) => v.reason === "published");
  const [version, setVersion] = useState(published[0]?.version ?? currentVersion);
  const [device, setDevice] = useState<Device>("desktop");
  const [kind, setKind] = useState<"clicks" | "moves">("clicks");
  const [sessionId, setSessionId] = useState("");
  const [opacity, setOpacity] = useState(0.8);
  useEffect(() => {
    if (version > 0) onCanvas({ kind: "heatmap", version, device, heat: { kind, sessionId: sessionId || undefined, opacity } });
  }, [version, device, kind, sessionId, opacity, onCanvas]);
  const sessions = a.sessions.filter((s) => s.version === version && s.device === device);
  const select = "mt-1 block w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm";
  return (
    <div className="space-y-3 text-sm">
      <p className="text-xs text-slate-500">The canvas shows where people {kind === "clicks" ? "clicked and tapped" : "moved their mouse"}. Positions are relative to each section, so they stay accurate at any screen size.</p>
      <label className="block text-xs font-medium text-slate-600">
        Version
        <select aria-label="Heatmap version" className={select} value={version} onChange={(e) => setVersion(Number(e.target.value))}>
          {published.map((v) => (
            <option key={v.version} value={v.version}>
              Version {v.version} · {when(v.created_at)}
            </option>
          ))}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-xs font-medium text-slate-600">
          Device
          <select aria-label="Heatmap device" className={select} value={device} onChange={(e) => setDevice(e.target.value as Device)}>
            <option value="desktop">Desktop</option>
            <option value="tablet">Tablet</option>
            <option value="mobile">Mobile</option>
          </select>
        </label>
        <label className="block text-xs font-medium text-slate-600">
          Show
          <select aria-label="Heatmap kind" className={select} value={kind} onChange={(e) => setKind(e.target.value as "clicks" | "moves")}>
            <option value="clicks">Clicks & taps</option>
            <option value="moves" disabled={device !== "desktop"}>
              Mouse movement
            </option>
          </select>
        </label>
      </div>
      <label className="block text-xs font-medium text-slate-600">
        Visit
        <select aria-label="Heatmap visit" className={select} value={sessionId} onChange={(e) => setSessionId(e.target.value)}>
          <option value="">All visits</option>
          {sessions.map((s) => (
            <option key={s.id} value={s.id}>
              {when(s.start)} · {duration(s.activeMs)}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-xs font-medium text-slate-600">
        Overlay opacity
        <input aria-label="Heatmap opacity" type="range" min={0.2} max={1} step={0.05} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} className="mt-1 w-full accent-brand" />
      </label>
      <div aria-hidden className="flex items-center gap-2 text-xs text-slate-500">
        <span>Fewer</span>
        <span className="h-2 flex-1 rounded-full" style={{ background: "linear-gradient(90deg, rgba(220,60,30,0.1), rgba(220,60,30,0.85))" }} />
        <span>More</span>
      </div>
    </div>
  );
}

function PricingTab({ a }: { a: Analytics }) {
  const optional = a.pricing.items.filter((i) => i.mode !== "fixed");
  if (optional.length === 0) return <Empty>This proposal has no optional add-ons or packages to choose from.</Empty>;
  if (a.pricing.sessionsWithActivity === 0) return <Empty>No one has changed a pricing option yet.</Empty>;
  const sections = [...new Set(optional.map((i) => i.section))];
  return (
    <div className="space-y-5">
      <p className="text-xs text-slate-500">
        {a.pricing.sessionsWithActivity} visit{a.pricing.sessionsWithActivity === 1 ? "" : "s"} changed pricing options. “Kept” counts visits where the option was still selected when they left.
      </p>
      {sections.map((section) => {
        const items = optional.filter((i) => i.section === section);
        const pkg = items[0]?.mode === "choose_one";
        return (
          <table key={section} className="w-full text-left text-sm">
            <caption className="mb-1 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              {section} {pkg ? "(packages)" : "(add-ons)"}
            </caption>
            <thead className="text-xs text-slate-500">
              <tr>
                <th className="py-1 font-medium">Option</th>
                <th className="py-1 text-right font-medium">On</th>
                {!pkg && <th className="py-1 text-right font-medium">Off</th>}
                <th className="py-1 text-right font-medium">{pkg ? "Chosen" : "Kept"}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 tabular-nums">
              {items.map((i) => (
                <tr key={i.itemId}>
                  <td className="py-1.5 pr-2">{i.item}</td>
                  <td className="py-1.5 text-right">{i.selected}</td>
                  {!pkg && <td className="py-1.5 text-right">{i.deselected}</td>}
                  <td className="py-1.5 text-right font-semibold">{i.endedSelected}</td>
                </tr>
              ))}
            </tbody>
          </table>
        );
      })}
    </div>
  );
}

function Sessions({ proposalId, a }: { proposalId: string; a: Analytics }) {
  const [open, setOpen] = useState<string | null>(null);
  const detail = useQuery({ queryKey: ["session", proposalId, open], queryFn: () => api<SessionDetail>(`/proposals/${proposalId}/analytics/sessions/${open}`), enabled: Boolean(open) });
  if (a.sessions.length === 0) return <Empty>No visits yet.</Empty>;
  return (
    <ul className="space-y-2">
      {a.sessions.map((s) => (
        <li key={s.id} className="rounded-lg border border-slate-200">
          <button type="button" aria-expanded={open === s.id} onClick={() => setOpen(open === s.id ? null : s.id)} className="w-full p-3 text-left text-sm hover:bg-slate-50">
            <div className="flex justify-between gap-2">
              <span className="font-medium">{when(s.start)}</span>
              <span className="tabular-nums text-slate-600">{duration(s.activeMs)}</span>
            </div>
            <div className="mt-0.5 text-xs capitalize text-slate-500">
              {[s.device, s.browser, s.location, `${s.scrollPct}% scrolled`, s.referrer ? `from ${s.referrer}` : null, `v${s.version}`].filter(Boolean).join(" · ")}
            </div>
          </button>
          {open === s.id && (
            <div className="border-t border-slate-100 p-3">
              {detail.isLoading ? (
                <p className="text-xs text-slate-500">Loading…</p>
              ) : !detail.data?.blocks.length ? (
                <p className="text-xs text-slate-500">No section data for this visit.</p>
              ) : (
                <ol className="space-y-1.5" aria-label="Sections in the order they were first seen">
                  {detail.data.blocks.map((b) => {
                    const max = Math.max(1, ...detail.data!.blocks.map((x) => x.visibleMs));
                    return (
                      <li key={b.blockId} className="text-xs">
                        <div className="flex justify-between gap-2">
                          <span className="truncate">{b.label}</span>
                          <span className="shrink-0 tabular-nums text-slate-600">
                            {duration(b.visibleMs)}
                            {b.timesEntered > 1 ? ` · ↻ ${b.timesEntered}×` : ""}
                          </span>
                        </div>
                        <div className="mt-0.5 h-2 rounded-r-[4px] bg-brand/80" style={{ width: `${Math.max(2, (b.visibleMs / max) * 100)}%` }} />
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

const EVENT: Record<string, string> = {
  created: "Created",
  edited: "Edited",
  published: "Published",
  link_copied: "Link copied",
  emailed: "Emailed to client",
  viewed: "Viewed",
  otp_sent: "Verification code sent",
  otp_verified: "Email verified",
  signed: "Signed",
  declined: "Declined",
  expired: "Expired",
  extended: "Extended",
  extension_requested: "Extension requested",
  pdf_exported: "PDF exported",
  archived: "Deleted (archived)",
  duplicated: "Duplicated",
};

function Audit({ proposalId }: { proposalId: string }) {
  const q = useQuery({ queryKey: ["audit", proposalId], queryFn: () => api<AuditEvent[]>(`/proposals/${proposalId}/audit`) });
  if (q.isLoading) return <p className="text-sm text-slate-500">Loading…</p>;
  return (
    <ol className="space-y-2 text-sm">
      {(q.data ?? []).map((e) => (
        <li key={e.id} className="flex gap-3">
          <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-slate-400" />
          <div>
            <div className="font-medium">{EVENT[e.event_type] ?? e.event_type}</div>
            <div className="text-xs text-slate-500">
              {when(e.occurred_at)} · {e.actor.startsWith("ai:") ? e.actor.slice(3) : e.actor}
              {e.ip ? ` · ${e.ip}` : ""}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

function Versions({ proposalId, versions, onCanvas }: { proposalId: string; versions: VersionSummary[]; onCanvas: (v: CanvasView) => void }) {
  const [viewing, setViewing] = useState<number | null>(null);
  if (versions.length === 0) return <Empty>Versions appear here each time you publish.</Empty>;
  return (
    <div className="space-y-5">
    {versions.length > 1 && <Compare proposalId={proposalId} versions={versions} />}
    <ul className="space-y-2 text-sm">
      {versions.map((v) => (
        <li key={v.version} className={`flex items-center justify-between rounded-lg border p-3 ${viewing === v.version ? "border-brand bg-brand/5" : "border-slate-200"}`}>
          <div>
            <div className="font-medium">
              Version {v.version} <span className="font-normal capitalize text-slate-500">· {v.reason}</span>
            </div>
            <div className="text-xs text-slate-500">{when(v.created_at)}</div>
            <div className="font-mono text-[10px] text-slate-500" title="SHA-256 of the version's content and pricing">
              {v.content_hash.slice(0, 16)}…
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              const next = viewing === v.version ? null : v.version;
              setViewing(next);
              onCanvas(next ? { kind: "version", version: next, device: "desktop" } : null);
            }}
            className="rounded-md px-2 py-1 text-xs font-semibold text-brand hover:bg-brand/5"
          >
            {viewing === v.version ? "Back to editor" : "View"}
          </button>
        </li>
      ))}
    </ul>
    </div>
  );
}

const KIND_STYLE = { added: "bg-emerald-100 text-emerald-900", removed: "bg-red-100 text-red-900", changed: "bg-amber-100 text-amber-900", moved: "bg-slate-100 text-slate-700" } as const;

/** Compare two versions: blocks and prices that changed (SPEC §7.3 nice-to-have). */
function Compare({ proposalId, versions }: { proposalId: string; versions: VersionSummary[] }) {
  const [from, setFrom] = useState(versions[1]!.version);
  const [to, setTo] = useState(versions[0]!.version);
  const load = (v: number) => ({ queryKey: ["version", proposalId, v], queryFn: () => api<VersionDetail>(`/proposals/${proposalId}/versions/${v}`), staleTime: Infinity });
  const a = useQuery(load(from));
  const b = useQuery(load(to));
  const diff = a.data && b.data ? diffVersions(a.data, b.data) : null;
  const select = "rounded-md border border-slate-300 bg-white px-2 py-1 text-sm";
  const changes = diff ? [...diff.blocks.map((c) => ({ ...c, detail: undefined as string | undefined, area: "Content" })), ...diff.pricing.map((c) => ({ ...c, area: "Pricing" }))] : [];
  return (
    <section aria-label="Compare versions" className="rounded-lg border border-slate-200 p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">Compare</span>
        <select aria-label="Compare from version" className={select} value={from} onChange={(e) => setFrom(Number(e.target.value))}>
          {versions.map((v) => (
            <option key={v.version} value={v.version}>
              v{v.version}
            </option>
          ))}
        </select>
        <span aria-hidden>→</span>
        <select aria-label="Compare to version" className={select} value={to} onChange={(e) => setTo(Number(e.target.value))}>
          {versions.map((v) => (
            <option key={v.version} value={v.version}>
              v{v.version}
            </option>
          ))}
        </select>
      </div>
      {!diff ? (
        <p className="mt-2 text-xs text-slate-500">Loading…</p>
      ) : changes.length === 0 && !diff.totals ? (
        <p className="mt-2 text-xs text-slate-500">No differences.</p>
      ) : (
        <ul className="mt-3 space-y-1.5 text-xs" aria-label="Differences">
          {diff.totals && (
            <li className="font-medium">
              Total: {diff.totals.before} → {diff.totals.after}
            </li>
          )}
          {changes.map((c, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className={`shrink-0 rounded px-1.5 py-0.5 font-medium capitalize ${KIND_STYLE[c.kind]}`}>{c.kind}</span>
              <span>
                <span className="text-slate-500">{c.area}: </span>
                {c.label}
                {c.detail && <span className="text-slate-500"> · {c.detail}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
