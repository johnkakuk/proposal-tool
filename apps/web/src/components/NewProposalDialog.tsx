import type { ClientRow } from "@bridger/shared";
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { useCreateProposal, useTemplates } from "../lib/queries";
import { ClientPicker } from "./ClientPicker";
import { Button, ErrorNote, Modal, inputClass } from "./ui";

type Start = { kind: "blank" } | { kind: "template"; id: string } | { kind: "ai" };

/** "New proposal" → Blank, From template, or Write with AI (SPEC §7.1). */
export function NewProposalDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [start, setStart] = useState<Start>({ kind: "blank" });
  const [title, setTitle] = useState("");
  const [client, setClient] = useState<ClientRow | null>(null);
  const { data: templates = [] } = useTemplates();
  const create = useCreateProposal();
  const navigate = useNavigate();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (start.kind === "ai") return;
    create.mutate(
      { title: title.trim(), clientId: client?.id ?? null, templateId: start.kind === "template" ? start.id : null },
      { onSuccess: (p) => navigate(`/app/proposals/${p.id}`) },
    );
  };

  const option = (active: boolean) => `rounded-lg border p-3 text-left transition ${active ? "border-brand bg-brand/5 ring-1 ring-brand" : "border-slate-200 hover:border-slate-300"}`;

  return (
    <Modal open={open} onClose={onClose} title="New proposal" wide>
      <form onSubmit={submit} className="space-y-5">
        <fieldset>
          <legend className="mb-2 text-sm font-medium">Start from</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            <button type="button" className={option(start.kind === "blank")} onClick={() => setStart({ kind: "blank" })} aria-pressed={start.kind === "blank"}>
              <div className="font-medium">Blank</div>
              <div className="text-xs text-slate-500">Write from scratch</div>
            </button>
            <button
              type="button"
              className={option(start.kind === "template")}
              onClick={() => templates[0] && setStart({ kind: "template", id: templates[0].id })}
              aria-pressed={start.kind === "template"}
              disabled={templates.length === 0}
            >
              <div className="font-medium">From template</div>
              <div className="text-xs text-slate-500">{templates.length} available</div>
            </button>
            <button type="button" className={option(start.kind === "ai")} onClick={() => setStart({ kind: "ai" })} aria-pressed={start.kind === "ai"}>
              <div className="font-medium">Write with AI</div>
              <div className="text-xs text-slate-500">Claude or ChatGPT</div>
            </button>
          </div>
        </fieldset>

        {start.kind === "template" && (
          <div className="grid max-h-56 gap-2 overflow-y-auto sm:grid-cols-2" role="radiogroup" aria-label="Template">
            {templates.map((t) => (
              <button key={t.id} type="button" role="radio" aria-checked={start.id === t.id} className={option(start.id === t.id)} onClick={() => setStart({ kind: "template", id: t.id })}>
                <div className="text-sm font-medium">{t.name}</div>
                {t.description && <div className="line-clamp-2 text-xs text-slate-500">{t.description}</div>}
              </button>
            ))}
          </div>
        )}

        {start.kind === "ai" ? (
          <div className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
            Draft the proposal in Claude or ChatGPT: paste your call notes and ask for a proposal. It's saved here as a draft for you to review, with a preview link.{" "}
            <Link to="/app/write-with-ai" className="font-medium text-brand underline" onClick={onClose}>
              Setup and a starter prompt
            </Link>
          </div>
        ) : (
          <>
            <label className="block text-sm font-medium">
              Title
              <input required autoFocus className={`mt-1 ${inputClass}`} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Content War Chest for Acme Roofing" />
            </label>
            <div>
              <label htmlFor="new-proposal-client" className="block text-sm font-medium">
                Client
              </label>
              <div className="mt-1">
                <ClientPicker id="new-proposal-client" value={client?.id ?? null} onChange={setClient} />
              </div>
            </div>
            <ErrorNote error={create.error} />
            <div className="flex justify-end gap-2">
              <Button onClick={onClose}>Cancel</Button>
              <Button type="submit" variant="primary" disabled={create.isPending || !title.trim()}>
                Create proposal
              </Button>
            </div>
          </>
        )}
      </form>
    </Modal>
  );
}
