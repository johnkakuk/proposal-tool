import { useMutation, useQuery } from "@tanstack/react-query";
import { useParams } from "react-router";
import { Button, ErrorNote, Spinner } from "../components/ui";
import { api } from "../lib/api";

/**
 * OAuth consent (SPEC §3): Claude.ai or ChatGPT asks to connect. John is signed in
 * (RequireAuth), sees who is asking and where they'll be sent back, and approves or denies.
 */
export function ConnectConsent() {
  const { id = "" } = useParams();
  const info = useQuery({ queryKey: ["consent", id], queryFn: () => api<{ clientName: string; redirectHost: string; scope: string[] }>(`/oauth/consent/${id}`), retry: false });
  const decide = useMutation({
    mutationFn: (approve: boolean) => api<{ redirectTo: string }>(`/oauth/consent/${id}`, { method: "POST", json: { approve } }),
    onSuccess: ({ redirectTo }) => window.location.assign(redirectTo),
  });

  return (
    <main className="flex min-h-full items-center justify-center px-4 py-12">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-sm ring-1 ring-slate-200">
        <p className="text-sm font-semibold text-brand">Bridger Digital Proposals</p>
        {info.isLoading ? (
          <Spinner />
        ) : info.error || !info.data ? (
          <>
            <h1 className="mt-2 text-xl font-semibold">This request expired</h1>
            <ErrorNote error={info.error} />
            <p className="mt-3 text-sm text-slate-600">Go back to the app you're connecting and try again.</p>
          </>
        ) : (
          <>
            <h1 className="mt-2 text-xl font-semibold">Connect {info.data.clientName}?</h1>
            <p className="mt-2 text-sm text-slate-600">
              <strong>{info.data.clientName}</strong> wants to work with your proposals. You'll be sent back to <strong>{info.data.redirectHost}</strong>.
            </p>
            <ul className="mt-5 space-y-2 text-sm">
              {[
                "Read your templates, clients, proposals, and analytics",
                "Create and edit draft proposals and clients",
                "Publish or email proposals, only if you allow it in Settings → AI & API",
              ].map((t) => (
                <li key={t} className="flex gap-2">
                  <span aria-hidden className="text-emerald-600">✓</span>
                  {t}
                </li>
              ))}
              <li className="flex gap-2 text-slate-500">
                <span aria-hidden>✕</span>
                It can never delete anything or change signed proposals
              </li>
            </ul>
            <ErrorNote error={decide.error} />
            <div className="mt-6 flex gap-2">
              <Button className="flex-1" onClick={() => decide.mutate(false)} disabled={decide.isPending}>
                Deny
              </Button>
              <Button variant="primary" className="flex-1" onClick={() => decide.mutate(true)} disabled={decide.isPending}>
                Allow
              </Button>
            </div>
            <p className="mt-4 text-xs text-slate-400">You can disconnect it any time in Settings → AI & API.</p>
          </>
        )}
      </div>
    </main>
  );
}
