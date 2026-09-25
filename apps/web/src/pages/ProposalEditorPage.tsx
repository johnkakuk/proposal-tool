import type { ClientRow, Pricing, ProposalContent, ProposalDetail } from "@bridger/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ClientPicker } from "../components/ClientPicker";
import { Button, ErrorNote, Modal, Spinner, StatusChip, inputClass } from "../components/ui";
import { api, ApiRequestError, downloadFromApi } from "../lib/api";
import { useClients, useProposal, useProposalAction, useWorkspaceSettings } from "../lib/queries";
import { DocumentWorkspace, SidebarCard } from "../workspace/DocumentWorkspace";
import { useAutosave } from "../workspace/useAutosave";

interface Draft {
  title: string;
  clientId: string | null;
  expiresAt: string | null;
  content: ProposalContent;
  pricing: Pricing;
}

export function ProposalEditorPage() {
  const { id = "" } = useParams();
  const { data: proposal, error, isLoading } = useProposal(id);
  const settings = useWorkspaceSettings();
  if (isLoading || settings.isLoading) return <Spinner />;
  if (error || !proposal) return <div className="p-8"><ErrorNote error={error ?? new Error("Proposal not found")} /></div>;
  // Remount per proposal so the editor loads fresh content.
  return <ProposalEditorLoaded key={proposal.id} proposal={proposal} brand={settings.data?.brand?.theme ?? null} ownerSignatureName={settings.data?.ownerSignatureName} />;
}

interface SignatureSummary {
  certificateId: string;
  signerName: string;
  signerEmail: string;
  signerTitle: string | null;
  signerCompany: string | null;
  signedAt: string;
  pdfUrl: string | null;
  certificateUrl: string;
}

interface PublishResponse {
  proposal: ProposalDetail;
  published: boolean;
  publicUrl: string;
}

function ProposalEditorLoaded({ proposal, brand, ownerSignatureName }: { proposal: ProposalDetail; brand: import("@bridger/shared").Theme | null; ownerSignatureName?: string }) {
  const locked = Boolean(proposal.signed_at) || proposal.status === "archived";
  const [title, setTitle] = useState(proposal.title);
  const [clientId, setClientId] = useState<string | null>(proposal.client_id);
  const [expiresAt, setExpiresAt] = useState<string | null>(proposal.expires_at);
  const [doc, setDoc] = useState<{ content: ProposalContent; pricing: Pricing } | null>(null);
  const [status, setStatus] = useState(proposal.status);
  const [published, setPublished] = useState({ version: proposal.current_version, unpublished: proposal.has_unpublished_changes });
  const [share, setShare] = useState<string | null>(null);
  const [publishIssues, setPublishIssues] = useState<string[] | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const signature = useQuery({
    queryKey: ["signature", proposal.id],
    queryFn: () => api<SignatureSummary>(`/proposals/${proposal.id}/signature`),
    enabled: Boolean(proposal.signed_at),
    refetchInterval: (q) => (q.state.data && !q.state.data.pdfUrl ? 5000 : false),
  });
  const exportPdf = async () => {
    setExporting(true);
    try {
      await downloadFromApi(`/proposals/${proposal.id}/pdf`, `${title}.pdf`);
    } catch (e) {
      setPublishIssues([e instanceof Error ? e.message : "Export failed"]);
    } finally {
      setExporting(false);
    }
  };
  const publicUrl = `${window.location.origin}/p/${proposal.slug}`;
  const base = useRef(proposal.updated_at);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const action = useProposalAction();
  const { data: clients = [] } = useClients();
  const client = clients.find((c) => c.id === clientId) ?? null;
  const [templateOpen, setTemplateOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  const draft: Draft | null = doc && !locked ? { title: title.trim() || proposal.title, clientId, expiresAt, ...doc } : null;

  const save = useCallback(
    async (d: Draft) => {
      const updated = await api<ProposalDetail>(`/proposals/${proposal.id}`, { method: "PATCH", json: { ...d, baseUpdatedAt: base.current } });
      base.current = updated.updated_at;
      setStatus(updated.status);
      setPublished({ version: updated.current_version, unpublished: updated.has_unpublished_changes });
      void qc.invalidateQueries({ queryKey: ["proposals"] });
    },
    [proposal.id, qc],
  );
  const { state, flush } = useAutosave(draft, save);
  const onDocumentChange = useCallback((d: { content: ProposalContent; pricing: Pricing }) => setDoc(d), []);

  const duplicate = (asRevision: boolean) =>
    action.mutate({ id: proposal.id, action: "duplicate", json: { asRevision } }, { onSuccess: (p) => navigate(`/app/proposals/${p.id}`) });

  const publish = async () => {
    setPublishing(true);
    try {
      await flush();
      const r = await api<PublishResponse>(`/proposals/${proposal.id}/publish`, { method: "POST" });
      base.current = r.proposal.updated_at;
      setStatus(r.proposal.status);
      setExpiresAt(r.proposal.expires_at);
      setPublished({ version: r.proposal.current_version, unpublished: r.proposal.has_unpublished_changes });
      setShare(r.publicUrl);
      void qc.invalidateQueries({ queryKey: ["proposals"] });
    } catch (e) {
      setPublishIssues(e instanceof ApiRequestError && e.issues.length ? e.issues.map((i) => i.message) : [e instanceof Error ? e.message : "Publishing failed"]);
    } finally {
      setPublishing(false);
    }
  };

  const copyLink = async () => {
    await navigator.clipboard.writeText(publicUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    void api(`/proposals/${proposal.id}/events`, { method: "POST", json: { type: "link_copied" } }).catch(() => {});
  };

  const isLive = published.version > 0;
  const upToDate = isLive && !published.unpublished && status !== "expired";
  const publishLabel = !isLive ? "Publish" : upToDate ? "Published ✓" : "Update";

  const conflict = state.kind === "error" && state.error instanceof ApiRequestError && state.error.status === 409;

  return (
    <>
      <DocumentWorkspace
        initialContent={proposal.content}
        initialPricing={proposal.pricing}
        readOnly={locked}
        onDocumentChange={onDocumentChange}
        saveState={state}
        onRetrySave={conflict ? () => window.location.reload() : () => void flush()}
        brand={brand}
        ownerSignatureName={ownerSignatureName}
        publishCheck={locked ? undefined : { clientHasEmail: Boolean(client?.email) }}
        heading={
          <>
            <Link to="/app" className="shrink-0 rounded-md px-2 py-1 text-sm text-slate-500 hover:bg-slate-100 hover:text-ink" aria-label="Back to proposals">
              ←
            </Link>
            <input
              aria-label="Proposal title"
              className="min-w-0 flex-1 rounded-md border border-transparent px-2 py-1 text-lg font-semibold hover:border-slate-200 focus:border-brand focus:outline-none disabled:bg-transparent"
              value={title}
              disabled={locked}
              onChange={(e) => setTitle(e.target.value)}
            />
            <StatusChip status={status} />
            {isLive && published.unpublished && !locked && (
              <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800" title="The client sees the last published version until you update.">
                Unpublished changes
              </span>
            )}
          </>
        }
        actions={
          <div className="relative flex items-center gap-2">
            {!locked && (
              <Button variant="primary" onClick={() => void publish()} disabled={publishing || upToDate} title={upToDate ? "The client sees the latest version" : undefined}>
                {publishing ? "Publishing…" : publishLabel}
              </Button>
            )}
            <Button aria-haspopup="menu" aria-expanded={moreOpen} onClick={() => setMoreOpen(!moreOpen)}>
              ⋯
            </Button>
            {moreOpen && (
              <div role="menu" className="absolute right-0 top-10 z-30 w-56 rounded-lg border border-slate-200 bg-white p-1 text-sm shadow-lg" onMouseLeave={() => setMoreOpen(false)}>
                <MenuItem disabled={!isLive} onClick={() => (setMoreOpen(false), void copyLink())}>
                  {copied ? "Link copied ✓" : "Copy link"}
                </MenuItem>
                <MenuItem disabled={!isLive} onClick={() => window.open(publicUrl, "_blank", "noopener")}>
                  Open client view
                </MenuItem>
                <MenuItem disabled={!isLive || exporting} onClick={() => (setMoreOpen(false), void exportPdf())}>
                  {exporting ? "Exporting PDF…" : "Export PDF"}
                </MenuItem>
                <MenuItem disabled={!isLive || locked || status === "expired"} onClick={() => (setMoreOpen(false), setEmailOpen(true))}>
                  Send email…
                </MenuItem>
                <hr className="my-1 border-slate-100" />
                <MenuItem onClick={() => (setMoreOpen(false), setTemplateOpen(true))}>Save as template…</MenuItem>
                <MenuItem onClick={() => duplicate(false)}>Duplicate</MenuItem>
                {!locked && (
                  <MenuItem
                    onClick={() =>
                      window.confirm("Archive this proposal? It will be hidden from the dashboard.") &&
                      action.mutate({ id: proposal.id, action: "archive" }, { onSuccess: () => navigate("/app") })
                    }
                  >
                    Archive
                  </MenuItem>
                )}
              </div>
            )}
          </div>
        }
        banner={
          locked ? (
            <div className="flex flex-wrap items-center gap-3 border-t border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
              {proposal.signed_at ? (
                <span>
                  Signed
                  {signature.data && (
                    <>
                      {" "}
                      by <strong>{signature.data.signerName}</strong>
                      {signature.data.signerCompany ? ` (${signature.data.signerCompany})` : ""} on{" "}
                      {new Date(signature.data.signedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
                    </>
                  )}
                  . Signed proposals are locked.
                </span>
              ) : (
                "This proposal is archived and read-only."
              )}
              {signature.data && (
                <span className="flex gap-3">
                  {signature.data.pdfUrl ? (
                    <a href={signature.data.pdfUrl} className="font-semibold underline" target="_blank" rel="noopener">
                      Signed PDF
                    </a>
                  ) : (
                    <span className="opacity-70">Preparing PDF…</span>
                  )}
                  <a href={signature.data.certificateUrl} className="font-semibold underline" target="_blank" rel="noopener">
                    Certificate {signature.data.certificateId}
                  </a>
                </span>
              )}
              {proposal.signed_at && (
                <Button variant="primary" onClick={() => duplicate(true)} disabled={action.isPending}>
                  Duplicate as new revision
                </Button>
              )}
            </div>
          ) : undefined
        }
        sidebar={
          <SidebarCard title="Details">
            <div className="space-y-3">
              <div>
                <label htmlFor="proposal-client" className="block text-xs font-medium text-slate-600">
                  Client
                </label>
                <div className="mt-1">
                  <ClientPicker id="proposal-client" value={clientId} disabled={locked} onChange={(c: ClientRow | null) => setClientId(c?.id ?? null)} />
                </div>
                {client && !client.email && <p className="mt-1 text-xs text-amber-700">This client has no email address yet.</p>}
              </div>
              <label className="block text-xs font-medium text-slate-600">
                Expires
                <input
                  type="date"
                  disabled={locked}
                  className={`mt-1 ${inputClass}`}
                  value={expiresAt ? expiresAt.slice(0, 10) : ""}
                  onChange={(e) => setExpiresAt(e.target.value ? new Date(`${e.target.value}T23:59:59`).toISOString() : null)}
                />
                <span className="mt-1 block font-normal text-slate-400">Defaults to 30 days after publishing if left blank.</span>
              </label>
            </div>
          </SidebarCard>
        }
      />
      <Modal open={share !== null} onClose={() => setShare(null)} title="Your proposal is live">
        <p className="text-sm text-slate-600">Anyone with this link can view it. Send it to your client, or copy it into an email.</p>
        <div className="mt-4 flex gap-2">
          <input readOnly aria-label="Proposal link" className={`${inputClass} font-mono text-xs`} value={share ?? ""} onFocus={(e) => e.target.select()} />
          <Button variant="primary" onClick={() => void copyLink()}>
            {copied ? "Copied ✓" : "Copy"}
          </Button>
        </div>
        <div className="mt-4 flex justify-between text-sm">
          <a href={share ?? "#"} target="_blank" rel="noopener" className="font-medium text-brand underline">
            Open client view
          </a>
          <span className="text-slate-500">Version {published.version}</span>
        </div>
      </Modal>
      <Modal open={publishIssues !== null} onClose={() => setPublishIssues(null)} title="Almost ready to publish">
        <p className="text-sm text-slate-600">Fix these first:</p>
        <ul className="mt-3 space-y-1.5 text-sm">
          {publishIssues?.map((m) => (
            <li key={m} className="flex gap-2">
              <span aria-hidden className="text-amber-500">•</span>
              {m}
            </li>
          ))}
        </ul>
        <div className="mt-5 flex justify-end">
          <Button onClick={() => setPublishIssues(null)}>OK</Button>
        </div>
      </Modal>
      <SendEmailDialog open={emailOpen} onClose={() => setEmailOpen(false)} proposalId={proposal.id} clientEmail={client?.email ?? null} clientName={client?.name ?? null} unpublished={published.unpublished} />
      <SaveAsTemplateDialog open={templateOpen} onClose={() => setTemplateOpen(false)} proposalId={proposal.id} defaultName={title} beforeSave={flush} />
    </>
  );
}

function MenuItem({ onClick, children, disabled }: { onClick: () => void; children: string; disabled?: boolean }) {
  return (
    <button role="menuitem" type="button" onClick={onClick} disabled={disabled} className="block w-full rounded px-3 py-1.5 text-left hover:bg-slate-100 disabled:text-slate-400 disabled:hover:bg-transparent">
      {children}
    </button>
  );
}

function SaveAsTemplateDialog({ open, onClose, proposalId, defaultName, beforeSave }: { open: boolean; onClose: () => void; proposalId: string; defaultName: string; beforeSave: () => Promise<void> }) {
  const [name, setName] = useState(defaultName);
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const action = useProposalAction();
  const navigate = useNavigate();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    await beforeSave(); // template copies the saved proposal
    action.mutate({ id: proposalId, action: "save-as-template", json: { name, category, description } }, { onSuccess: (t) => navigate(`/app/templates/${t.id}`) });
  };
  return (
    <Modal open={open} onClose={onClose} title="Save as template">
      <form onSubmit={submit} className="space-y-4">
        <label className="block text-sm font-medium">
          Template name
          <input required className={`mt-1 ${inputClass}`} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block text-sm font-medium">
          Category
          <input className={`mt-1 ${inputClass}`} value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Content, Web, Video…" />
        </label>
        <label className="block text-sm font-medium">
          Description
          <textarea rows={2} className={`mt-1 ${inputClass}`} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <p className="text-xs text-slate-500">Client-specific text stays as written; edit the template afterwards to generalize it.</p>
        <ErrorNote error={action.error} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={action.isPending || !name.trim()}>
            Save template
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function SendEmailDialog({
  open,
  onClose,
  proposalId,
  clientEmail,
  clientName,
  unpublished,
}: {
  open: boolean;
  onClose: () => void;
  proposalId: string;
  clientEmail: string | null;
  clientName: string | null;
  unpublished: boolean;
}) {
  const first = clientName?.split(" ")[0];
  const [message, setMessage] = useState(`Hi${first ? ` ${first}` : ""},\n\nHere's the proposal we talked about. Have a look and let me know if you have any questions. You can accept it right from the page.\n\nThanks!`);
  const [sent, setSent] = useState<string | null>(null);
  const send = useMutation({
    mutationFn: () => api<{ to: string }>(`/proposals/${proposalId}/send-email`, { method: "POST", json: { message } }),
    onSuccess: (r) => setSent(r.to),
  });
  return (
    <Modal open={open} onClose={() => (onClose(), setSent(null), send.reset())} title="Email this proposal">
      {sent ? (
        <div className="space-y-4">
          <p role="status" className="text-sm text-emerald-700">
            ✓ Sent to {sent}.
          </p>
          <div className="flex justify-end">
            <Button onClick={() => (onClose(), setSent(null))}>Done</Button>
          </div>
        </div>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            send.mutate();
          }}
        >
          <p className="text-sm text-slate-600">
            To: <strong>{clientEmail ?? "—"}</strong>. Replies come to you. The email includes a button to open the proposal.
          </p>
          {!clientEmail && <p className="text-sm text-amber-700">Add an email address to this client first.</p>}
          {unpublished && <p className="text-sm text-amber-700">You have unpublished changes. The client will see the last published version.</p>}
          <label className="block text-sm font-medium">
            Message
            <textarea rows={8} className={`mt-1 ${inputClass}`} value={message} onChange={(e) => setMessage(e.target.value)} />
          </label>
          <ErrorNote error={send.error} />
          <div className="flex justify-end gap-2">
            <Button onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={!clientEmail || send.isPending}>
              {send.isPending ? "Sending…" : "Send"}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
