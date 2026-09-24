import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { supabase } from "../lib/supabase";

interface Health {
  ok: boolean;
  configured: boolean;
}

/** Phase 1 placeholder: proves login, RLS reads, and the same-origin Worker proxy all work. */
export function Dashboard() {
  const { session } = useAuth();
  const [health, setHealth] = useState<Health | "unreachable" | null>(null);
  const [templateCount, setTemplateCount] = useState<number | string | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json() as Promise<Health>)
      .then(setHealth)
      .catch(() => setHealth("unreachable"));
    supabase
      .from("templates")
      .select("id", { count: "exact", head: true })
      .then(({ count, error }) => setTemplateCount(error ? error.message : (count ?? 0)));
  }, []);

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <header className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-brand">Proposals</h1>
        <button onClick={() => supabase.auth.signOut()} className="text-sm text-slate-600 hover:text-ink">
          Sign out
        </button>
      </header>
      <dl className="grid gap-4 rounded-xl bg-white p-6 text-sm shadow-sm ring-1 ring-slate-200 sm:grid-cols-3">
        <div>
          <dt className="text-slate-500">Signed in as</dt>
          <dd className="font-medium">{session?.user.email}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Worker</dt>
          <dd className="font-medium">
            {health === null ? "…" : health === "unreachable" ? "Unreachable" : health.ok ? "OK" : "Not configured"}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">Templates</dt>
          <dd className="font-medium">{templateCount ?? "…"}</dd>
        </div>
      </dl>
      <p className="mt-6 text-sm text-slate-500">The pipeline table, editor, clients, and templates arrive in Phase 2.</p>
    </main>
  );
}
