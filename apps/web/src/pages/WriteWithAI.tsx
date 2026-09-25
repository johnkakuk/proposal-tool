import { Link } from "react-router";
import { useToast } from "../components/Toaster";

function Copyable({ label, value }: { label: string; value: string }) {
  const toast = useToast();
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-slate-500">{label}</div>
      <div className="flex items-start gap-2">
        <pre className="min-w-0 flex-1 overflow-x-auto whitespace-pre-wrap rounded-md bg-slate-900 p-3 font-mono text-xs text-slate-100">{value}</pre>
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(value);
            toast("Copied");
          }}
          className="shrink-0 rounded-md px-2 py-1 text-sm font-medium text-brand ring-1 ring-slate-300 hover:bg-slate-50"
          aria-label={`Copy ${label}`}
        >
          Copy
        </button>
      </div>
    </div>
  );
}

/** "Write with AI" (SPEC §10.4): connect Claude or ChatGPT, then use a starter prompt. */
export function WriteWithAI() {
  const mcpUrl = `${window.location.origin}/mcp`;
  const prompt = `Create a proposal for {client name} at {company} ({email}) for a Content War Chest package, using the Content War Chest template.
Adjust the pricing and deliverables to match my notes, keep the tone in my writing guidelines, then give me the preview link.

Here are my discovery call notes:
…`;
  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <Link to="/app" className="text-sm text-slate-500 hover:text-ink">
          ← Proposals
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Write with AI</h1>
        <p className="mt-2 text-slate-600">
          Connect Claude or ChatGPT once, then ask it to draft proposals from your notes. It uses your templates, pricing, and writing guidelines, creates a draft here for you to review, and can
          publish only if you allow it in{" "}
          <Link to="/app/settings" className="font-medium text-brand underline">
            Settings → AI & API
          </Link>
          .
        </p>
      </div>

      <section className="space-y-3 rounded-xl bg-white p-6 shadow-xs ring-1 ring-slate-200">
        <h2 className="font-semibold">Claude (claude.ai or the desktop app)</h2>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700">
          <li>Settings → Connectors → Add custom connector.</li>
          <li>Name it “Bridger Proposals” and paste the URL below.</li>
          <li>Click Connect and approve on the page that opens.</li>
        </ol>
        <Copyable label="Connector URL" value={mcpUrl} />
      </section>

      <section className="space-y-3 rounded-xl bg-white p-6 shadow-xs ring-1 ring-slate-200">
        <h2 className="font-semibold">ChatGPT</h2>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700">
          <li>Settings → Apps & Connectors → Advanced → turn on Developer mode.</li>
          <li>Create a connector with the URL below and OAuth authentication.</li>
          <li>Approve the connection on the page that opens.</li>
        </ol>
        <Copyable label="Connector URL" value={mcpUrl} />
      </section>

      <section className="space-y-3 rounded-xl bg-white p-6 shadow-xs ring-1 ring-slate-200">
        <h2 className="font-semibold">Claude Code</h2>
        <p className="text-sm text-slate-700">
          Create an API key in{" "}
          <Link to="/app/settings" className="font-medium text-brand underline">
            Settings → AI & API
          </Link>
          , then run:
        </p>
        <Copyable label="Terminal command" value={`claude mcp add --transport http bridger-proposals ${mcpUrl} --header "Authorization: Bearer YOUR_API_KEY"`} />
      </section>

      <section className="space-y-3 rounded-xl bg-white p-6 shadow-xs ring-1 ring-slate-200">
        <h2 className="font-semibold">Starter prompt</h2>
        <Copyable label="Starter prompt" value={prompt} />
      </section>
    </div>
  );
}
