import { PROPOSAL_STATUSES, type ProposalStatus } from "@bridger/shared";
import { useState } from "react";
import { Link } from "react-router";
import { cadenceParts, money } from "../blocks/pricing/format";
import { NewProposalDialog } from "../components/NewProposalDialog";
import { ProposalMenu } from "../components/RowMenus";
import { Button, EmptyState, ErrorNote, Spinner, StatusChip, inputClass, relativeTime, shortDate } from "../components/ui";
import { useProposals } from "../lib/queries";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { formatCents } from "@bridger/shared";

/** Pipeline list (SPEC §7.1). Stats, view counts, and date filters arrive with later phases. */
export function Dashboard() {
  const [status, setStatus] = useState<ProposalStatus | "">("");
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const { data, error, isLoading } = useProposals({ status: status || undefined, q: q.trim() || undefined });

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Proposals</h1>
        <Button variant="primary" onClick={() => setCreating(true)}>
          + New proposal
        </Button>
      </div>

      <StatRow />

      <div className="mb-4 flex flex-wrap gap-2 [&>*]:w-auto">
        <input aria-label="Search proposals" placeholder="Search by title…" className={`${inputClass} max-w-xs`} value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label="Filter by status" className={`${inputClass} max-w-44`} value={status} onChange={(e) => setStatus(e.target.value as ProposalStatus | "")}>
          <option value="">All active</option>
          {PROPOSAL_STATUSES.map((s) => (
            <option key={s} value={s} className="capitalize">
              {s[0]!.toUpperCase() + s.slice(1)}
            </option>
          ))}
        </select>
      </div>

      <ErrorNote error={error} />
      {isLoading ? (
        <Spinner />
      ) : !data?.length ? (
        <EmptyState
          title={q || status ? "No proposals match" : "No proposals yet"}
          body={q || status ? "Try a different search or filter." : "Start from a template or a blank page."}
          action={!q && !status && <Button variant="primary" onClick={() => setCreating(true)}>New proposal</Button>}
        />
      ) : (
        <div className="overflow-x-auto rounded-xl bg-white shadow-xs ring-1 ring-slate-200">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Proposal</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Value</th>
                <th className="px-4 py-3 font-medium">Sent</th>
                <th className="px-4 py-3 text-right font-medium">Views</th>
                <th className="px-4 py-3 font-medium">Last viewed</th>
                <th className="px-4 py-3 font-medium">Expires</th>
                <th className="px-4 py-3 font-medium">Updated</th>
                <th className="w-12 px-2 py-3">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link to={`/app/proposals/${p.id}`} className="font-medium text-ink hover:text-brand hover:underline">
                      {p.title}
                    </Link>
                    <div className="text-xs text-slate-500">{p.client ? (p.client.company ?? p.client.name) : "No client"}</div>
                  </td>
                  <td className="px-4 py-3">
                    <StatusChip status={p.status} />
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {cadenceParts({ one_time: p.total_one_time_cents, monthly: p.total_monthly_cents, quarterly: 0, yearly: 0 }).map(([c, v]) => (
                      <div key={c}>{money(v, c)}</div>
                    ))}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{shortDate(p.sent_at)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-600">{p.view_count ?? 0}</td>
                  <td className="px-4 py-3 text-slate-600">{relativeTime(p.last_viewed_at)}</td>
                  <td className="px-4 py-3 text-slate-600">{shortDate(p.expires_at)}</td>
                  <td className="px-4 py-3 text-slate-600">{relativeTime(p.updated_at)}</td>
                  <td className="px-2 py-3 text-right">
                    <ProposalMenu proposal={p} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <NewProposalDialog open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

interface Stats {
  sentLast30: number;
  openRate30: number | null;
  winRate90: number | null;
  signedThisMonth: { count: number; oneTimeCents: number; monthlyCents: number };
  avgTimeToSignMs: number | null;
}

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);
const days = (ms: number | null) => {
  if (ms === null) return "—";
  const d = ms / 86_400_000;
  return d < 1 ? `${Math.max(1, Math.round(d * 24))} h` : `${d < 10 ? d.toFixed(1) : Math.round(d)} days`;
};

/** KPI row (SPEC §7.1). Each tile names its period. */
function StatRow() {
  const { data } = useQuery({ queryKey: ["stats"], queryFn: () => api<Stats>("/stats") });
  const tiles: { label: string; value: string; sub: string }[] = [
    { label: "Sent", value: data ? String(data.sentLast30) : "…", sub: "last 30 days" },
    { label: "Open rate", value: data ? pct(data.openRate30) : "…", sub: "of those sent, last 30 days" },
    { label: "Win rate", value: data ? pct(data.winRate90) : "…", sub: "signed, of sent in 90 days" },
    {
      label: "Signed this month",
      value: data ? formatCents(data.signedThisMonth.oneTimeCents) : "…",
      sub: data ? `${data.signedThisMonth.monthlyCents ? `+ ${formatCents(data.signedThisMonth.monthlyCents)}/mo · ` : ""}${data.signedThisMonth.count} signed` : "",
    },
    { label: "Avg. time to sign", value: data ? days(data.avgTimeToSignMs) : "…", sub: "from sending, last 90 days" },
  ];
  return (
    <dl className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" aria-label="Pipeline stats">
      {tiles.map((t) => (
        <div key={t.label} className="rounded-xl bg-white p-4 shadow-xs ring-1 ring-slate-200">
          <dt className="text-xs font-medium text-slate-500">{t.label}</dt>
          <dd className="mt-1 text-2xl font-semibold tabular-nums text-ink">{t.value}</dd>
          <dd className="text-xs text-slate-500">{t.sub}</dd>
        </div>
      ))}
    </dl>
  );
}
