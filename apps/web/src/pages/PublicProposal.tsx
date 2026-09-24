import { useParams } from "react-router";

/** Public viewer (/p/:slug). Phase 3 renders the published version fetched from the Worker. */
export function PublicProposal() {
  const { slug } = useParams();
  return (
    <main className="mx-auto max-w-2xl px-4 py-16 text-center">
      <p className="text-sm text-slate-500">Proposal viewer coming in Phase 3.</p>
      <p className="mt-2 font-mono text-xs text-slate-400">{slug}</p>
    </main>
  );
}
