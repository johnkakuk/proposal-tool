import { Link } from "react-router";

/** Placeholder for SPEC §10.4; connection instructions arrive with the MCP server (Phase 7). */
export function WriteWithAI() {
  return (
    <div className="max-w-2xl">
      <Link to="/app" className="text-sm text-slate-500 hover:text-ink">
        ← Proposals
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">Write with AI</h1>
      <p className="mt-3 text-slate-600">
        Soon you'll be able to connect Claude or ChatGPT and ask it to draft a proposal from your discovery-call notes, using your templates and pricing. The AI creates a draft
        here for you to review before anything is sent.
      </p>
      <p className="mt-3 text-sm text-slate-500">Connector setup and a starter prompt will appear on this page in the AI phase.</p>
    </div>
  );
}
