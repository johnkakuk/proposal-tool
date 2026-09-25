import type { PublicProposal, Selections } from "@bridger/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useParams, useSearchParams } from "react-router";
import { cadenceParts, money } from "../blocks/pricing/format";
import { formatIsoDate } from "../render/format";
import { ProposalBlocks, RenderProvider, useRenderContextValue } from "../render/ProposalRenderer";
import { ThemeScope } from "../render/ThemeScope";
import { NotAvailableError, fetchCertificate, fetchPublicProposal, requestExtension, signedPdfUrl } from "./api";
import { CertificateDetails } from "./Certificate";
import { DeclineDialog } from "./DeclineDialog";
import { SigningModal } from "./SigningModal";

/**
 * Client-facing proposal (SPEC §8.1). `?print=1` renders the print/PDF view: no header,
 * no interaction, page breaks honored. Tracking (Phase 6) will never run in print.
 */
export function PublicProposalPage() {
  const { slug = "" } = useParams();
  const [params] = useSearchParams();
  const print = params.get("print") === "1";
  const { data, error, isLoading } = useQuery({
    queryKey: ["public-proposal", slug],
    queryFn: () => fetchPublicProposal(slug),
    retry: (n, e) => !(e instanceof NotAvailableError) && n < 2,
    // After signing, poll until the signed PDF is ready.
    refetchInterval: (q) => (!print && q.state.data?.state === "signed" && !q.state.data.signed?.pdfReady ? 4000 : false),
  });

  useEffect(() => {
    document.title = data ? `${data.title}${data.brand.company ? ` · ${data.brand.company.name}` : ""}` : "Proposal";
  }, [data]);

  if (isLoading) return <div className="min-h-screen bg-white" aria-busy="true" />;
  if (error || !data) return <Message title="This proposal isn't available" body="The link may be incorrect, or the proposal may have been withdrawn." />;
  if (data.state === "expired") return <Expired proposal={data} />;
  if (data.state === "declined") return <Declined proposal={data} />;
  if (!data.document) return <Message title="This proposal isn't available" />;
  return <Viewer proposal={data} print={print} />;
}

function Viewer({ proposal, print }: { proposal: PublicProposal; print: boolean }) {
  const doc = proposal.document!;
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const token = params.get("token");
  const signed = proposal.signed;
  const [selections, setSelections] = useState<Selections | undefined>(signed?.selections);
  const [signing, setSigning] = useState(false);
  const [declining, setDeclining] = useState(false);
  const onSelect = useCallback((sectionId: string, itemIds: string[]) => setSelections((s) => ({ ...s, [sectionId]: itemIds })), []);
  const active = !print && proposal.state === "active";
  const signingContext = useMemo(
    () => ({ slug: proposal.slug, signed, onAccept: active ? () => setSigning(true) : undefined, onDecline: active ? () => setDeclining(true) : undefined }),
    [proposal.slug, signed, active],
  );
  const value = useRenderContextValue(doc.pricing, print ? "print" : "public", {
    selections: signed?.selections ?? selections,
    onSelect: active ? onSelect : undefined,
    ownerSignatureName: doc.ownerSignature?.name,
    signing: signingContext,
  });

  // Print view: the PDF renderer waits for [data-print-ready]; signed PDFs include the certificate.
  const cert = useQuery({ queryKey: ["certificate", proposal.slug, token], queryFn: () => fetchCertificate(proposal.slug, token), enabled: print && Boolean(signed), retry: false });
  const [fontsReady, setFontsReady] = useState(false);
  useEffect(() => {
    void document.fonts.ready.then(() => setFontsReady(true));
  }, []);
  const printReady = print && fontsReady && (!signed || cert.isSuccess || cert.isError);

  return (
    <RenderProvider value={value} theme={proposal.brand.theme} overrides={doc.content.theme}>
      <div className={`min-h-screen bg-(--color-background) ${print ? "proposal-print" : ""}`} data-print-ready={printReady ? "" : undefined}>
        {!print && (
          <header className="sticky top-0 z-10 border-b border-black/10 bg-(--color-background)/95 backdrop-blur print:hidden">
            <div className="mx-auto flex max-w-4xl items-center gap-4 px-4 py-3">
              {proposal.brand.theme?.logoUrl ? (
                <img src={proposal.brand.theme.logoUrl} alt={proposal.brand.company?.name ?? ""} className="h-8 w-auto" />
              ) : (
                <span className="font-(family-name:--font-heading) font-bold text-(--color-primary)">{proposal.brand.company?.name ?? "Proposal"}</span>
              )}
              <div className="ml-auto flex items-center gap-4">
                {value.result && value.pricing.sections.length > 0 && (
                  <div className="text-right text-sm leading-tight tabular-nums" aria-live="polite" aria-label="Current total">
                    <span className="sr-only">Total: </span>
                    {cadenceParts(value.result.total).map(([c, v]) => (
                      <div key={c} className="font-semibold">
                        {money(v, c)}
                      </div>
                    ))}
                  </div>
                )}
                {signed ? (
                  <>
                    <span className="rounded-full bg-emerald-100 px-3 py-1 text-sm font-semibold text-emerald-800">Signed</span>
                    {signed.pdfReady ? (
                      <a href={signedPdfUrl(proposal.slug)} className="rounded-md border border-black/20 px-3 py-2 text-sm font-semibold hover:bg-black/5">
                        Download PDF
                      </a>
                    ) : (
                      <span className="text-sm opacity-60" role="status">
                        Preparing PDF…
                      </span>
                    )}
                  </>
                ) : (
                  <button type="button" onClick={() => setSigning(true)} className="rounded-md bg-(--color-accent) px-4 py-2 text-sm font-semibold text-white shadow-sm hover:brightness-110">
                    Accept proposal
                  </button>
                )}
              </div>
            </div>
          </header>
        )}
        <main className="mx-auto max-w-4xl px-4 py-10 sm:px-8 print:max-w-none print:p-0">
          <ProposalBlocks content={doc.content} />
          {proposal.expiresAt && active && <p className="mt-10 text-center text-sm opacity-60">This proposal is valid until {formatIsoDate(proposal.expiresAt.slice(0, 10))}.</p>}
          {print && cert.data && (
            <section style={{ breakBefore: "page" }} className="pt-4">
              <h2 className="proposal-h2 !mt-0">Certificate of Completion</h2>
              <CertificateDetails cert={cert.data} />
            </section>
          )}
        </main>
        <Footer proposal={proposal} />
      </div>
      {/* Stays mounted after signing so the thank-you step remains visible while the page updates. */}
      {(active || signing) && (
        <>
          <SigningModal
            proposal={proposal}
            selections={value.selections}
            totals={value.result}
            open={signing}
            onClose={() => setSigning(false)}
            onSigned={() => void qc.invalidateQueries({ queryKey: ["public-proposal", proposal.slug] })}
          />
          <DeclineDialog slug={proposal.slug} open={declining} onClose={() => setDeclining(false)} onDeclined={() => void qc.invalidateQueries({ queryKey: ["public-proposal", proposal.slug] })} />
        </>
      )}
    </RenderProvider>
  );
}

function Footer({ proposal }: { proposal: PublicProposal }) {
  const c = proposal.brand.company;
  if (!c) return null;
  return (
    <footer className="border-t border-black/10 py-8 text-center text-sm opacity-70 print:hidden">
      <div className="font-semibold">{c.name}</div>
      {[c.address, c.phone].filter(Boolean).map((line) => (
        <div key={line}>{line}</div>
      ))}
      {c.website && (
        <a href={c.website} className="underline" rel="noopener noreferrer" target="_blank">
          {c.website.replace(/^https?:\/\//, "")}
        </a>
      )}
    </footer>
  );
}

function Branded({ proposal, children }: { proposal: PublicProposal; children: ReactNode }) {
  return (
    <ThemeScope theme={proposal.brand.theme}>
      <div className="flex min-h-screen items-center justify-center bg-(--color-background) px-4">
        <div className="w-full max-w-lg rounded-2xl border border-black/10 p-8 text-center shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-(--color-accent)">{proposal.brand.company?.name ?? "Proposal"}</p>
          <h1 className="mt-2 font-(family-name:--font-heading) text-2xl font-bold text-(--color-primary)">{proposal.title}</h1>
          {children}
        </div>
      </div>
    </ThemeScope>
  );
}

function Expired({ proposal }: { proposal: PublicProposal }) {
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | { error: string }>("idle");
  return (
    <Branded proposal={proposal}>
      <p className="mt-4 opacity-80">
        This proposal expired{proposal.expiresAt ? ` on ${formatIsoDate(proposal.expiresAt.slice(0, 10))}` : ""}. Still interested? Ask for more time and we'll get back to you.
      </p>
      {status === "sent" ? (
        <p role="status" className="mt-6 rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">
          Thanks! We've been notified and will be in touch shortly.
        </p>
      ) : (
        <form
          className="mt-6 space-y-3 text-left"
          onSubmit={async (e) => {
            e.preventDefault();
            setStatus("sending");
            try {
              await requestExtension(proposal.slug, message.trim());
              setStatus("sent");
            } catch (err) {
              setStatus({ error: (err as Error).message });
            }
          }}
        >
          <label className="block text-sm font-medium">
            Message (optional)
            <textarea rows={3} maxLength={1000} className="mt-1 block w-full rounded-md border border-black/20 bg-white p-2 text-sm" value={message} onChange={(e) => setMessage(e.target.value)} />
          </label>
          {typeof status === "object" && (
            <p role="alert" className="text-sm text-red-700">
              {status.error}
            </p>
          )}
          <button type="submit" disabled={status === "sending"} className="w-full rounded-md bg-(--color-accent) px-4 py-2.5 font-semibold text-white hover:brightness-110 disabled:opacity-60">
            Request an extension
          </button>
        </form>
      )}
    </Branded>
  );
}

function Declined({ proposal }: { proposal: PublicProposal }) {
  return (
    <Branded proposal={proposal}>
      <p className="mt-4 opacity-80">This proposal was declined. If that was a mistake or your plans have changed, we'd love to hear from you.</p>
      <a
        href={`mailto:${proposal.brand.contactEmail}?subject=${encodeURIComponent(`Re: ${proposal.title}`)}`}
        className="mt-6 inline-block rounded-md bg-(--color-accent) px-5 py-2.5 font-semibold text-white hover:brightness-110"
      >
        Get in touch
      </a>
    </Branded>
  );
}

function Message({ title, body }: { title: string; body?: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 text-center">
      <div>
        <h1 className="text-xl font-semibold text-ink">{title}</h1>
        {body && <p className="mt-2 text-slate-500">{body}</p>}
      </div>
    </main>
  );
}
