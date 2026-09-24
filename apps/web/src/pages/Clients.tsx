import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { ClientForm } from "../components/ClientForm";
import { Button, EmptyState, ErrorNote, Modal, Spinner, inputClass } from "../components/ui";
import { useClientMutations, useClients } from "../lib/queries";

export function Clients() {
  const [q, setQ] = useState("");
  const { data, error, isLoading } = useClients(q.trim() || undefined);
  const { create } = useClientMutations();
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();

  return (
    <>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Clients</h1>
        <Button variant="primary" onClick={() => setCreating(true)}>
          + New client
        </Button>
      </div>
      <input aria-label="Search clients" placeholder="Search name, company, or email…" className={`${inputClass} mb-4 max-w-sm`} value={q} onChange={(e) => setQ(e.target.value)} />
      <ErrorNote error={error} />
      {isLoading ? (
        <Spinner />
      ) : !data?.length ? (
        <EmptyState title={q ? "No clients match" : "No clients yet"} action={!q && <Button onClick={() => setCreating(true)}>Add your first client</Button>} />
      ) : (
        <div className="overflow-x-auto rounded-xl bg-white shadow-xs ring-1 ring-slate-200">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Company</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Phone</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link to={`/app/clients/${c.id}`} className="font-medium hover:text-brand hover:underline">
                      {c.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{c.company ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{c.email ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{c.phone ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={creating} onClose={() => setCreating(false)} title="New client">
        <ClientForm submitLabel="Create client" busy={create.isPending} error={create.error} onSubmit={(v) => create.mutate(v, { onSuccess: (c) => navigate(`/app/clients/${c.id}`) })} />
      </Modal>
    </>
  );
}
