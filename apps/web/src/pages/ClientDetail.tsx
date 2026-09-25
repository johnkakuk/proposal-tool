import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { cadenceParts, money } from "../blocks/pricing/format";
import { ClientForm } from "../components/ClientForm";
import { ClientMenu, ProposalMenu } from "../components/RowMenus";
import { EmptyState, ErrorNote, Spinner, StatusChip, relativeTime } from "../components/ui";
import { useClient, useClientMutations } from "../lib/queries";

export function ClientDetail() {
  const { id = "" } = useParams();
  const { data, error, isLoading } = useClient(id);
  const { update } = useClientMutations();
  const [saved, setSaved] = useState(false);
  const navigate = useNavigate();

  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorNote error={error ?? new Error("Client not found")} />;

  return (
    <>
      <Link to="/app/clients" className="text-sm text-slate-500 hover:text-ink">
        ← Clients
      </Link>
      <div className="mb-6 mt-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">
          {data.name}
          {data.company && <span className="font-normal text-slate-500"> · {data.company}</span>}
        </h1>
        <ClientMenu client={data} onDeleted={() => navigate("/app/clients")} />
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <section className="rounded-xl bg-white p-6 shadow-xs ring-1 ring-slate-200">
          <h2 className="mb-4 font-semibold">Contact</h2>
          <ClientForm
            key={data.updated_at}
            initial={data}
            submitLabel={saved ? "Saved ✓" : "Save changes"}
            busy={update.isPending}
            error={update.error}
            onSubmit={(v) => update.mutate({ id: data.id, input: v }, { onSuccess: () => (setSaved(true), setTimeout(() => setSaved(false), 2000)) })}
          />
        </section>
        <section>
          <h2 className="mb-3 font-semibold">Proposals</h2>
          {data.proposals.length === 0 ? (
            <EmptyState title="No proposals for this client yet" />
          ) : (
            <ul className="divide-y divide-slate-100 rounded-xl bg-white shadow-xs ring-1 ring-slate-200">
              {data.proposals.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div>
                    <Link to={`/app/proposals/${p.id}`} className="font-medium hover:text-brand hover:underline">
                      {p.title}
                    </Link>
                    <div className="text-xs text-slate-500">Updated {relativeTime(p.updated_at)}</div>
                  </div>
                  <div className="flex items-center gap-2">
                  <div className="text-right text-sm tabular-nums">
                    <StatusChip status={p.status} />
                    <div className="mt-1 text-slate-600">
                      {cadenceParts({ one_time: p.total_one_time_cents, monthly: p.total_monthly_cents, quarterly: 0, yearly: 0 })
                        .map(([c, v]) => money(v, c))
                        .join(" + ")}
                    </div>
                  </div>
                  <ProposalMenu proposal={p} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
