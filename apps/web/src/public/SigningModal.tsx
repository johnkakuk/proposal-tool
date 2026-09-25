import { consentText, type PricingResult, type PublicProposal, type Selections } from "@bridger/shared";
import { useEffect, useState, type FormEvent } from "react";
import { cadenceParts, money } from "../blocks/pricing/format";
import { SIGNATURE_FONT } from "../blocks/signature";
import { PublicApiError, sendCode, signProposal, verifyCode } from "./api";
import { PublicModal, primaryButton, publicInput } from "./PublicModal";
import { SignaturePad } from "./SignaturePad";

type Step = "details" | "verify" | "sign" | "done";

export interface SignedResult {
  certificateId: string;
}

/**
 * The signing flow (SPEC §8.2): details + review → email code → signature + consent.
 * The server re-validates everything; this UI only gathers it.
 */
export function SigningModal({
  proposal,
  selections,
  totals,
  open,
  onClose,
  onSigned,
}: {
  proposal: PublicProposal;
  selections: Selections;
  totals: PricingResult | null;
  open: boolean;
  onClose: () => void;
  onSigned: (r: SignedResult) => void;
}) {
  const [step, setStep] = useState<Step>("details");
  const [signer, setSigner] = useState({ name: "", email: proposal.signerDefaults.email ?? "", title: "", company: proposal.signerDefaults.company ?? "" });
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);

  useEffect(() => {
    if (open) {
      setError(null);
      if (step === "done") return;
      setStep("details");
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const fail = (e: unknown) => {
    if (e instanceof PublicApiError && e.code === "stale_version") setStale(true);
    setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
  };

  const title = { details: "Review & accept", verify: "Verify your email", sign: "Sign", done: "Thank you!" }[step];
  const stepNumber = { details: 1, verify: 2, sign: proposal.requireOtp ? 3 : 2, done: 0 }[step];
  const steps = proposal.requireOtp ? 3 : 2;

  return (
    <PublicModal open={open} onClose={onClose} title={title} dismissable={step !== "done"}>
      {stepNumber > 0 && (
        <p className="-mt-3 mb-5 text-sm text-(--color-muted)">
          Step {stepNumber} of {steps}
        </p>
      )}
      {stale ? (
        <div role="alert" className="space-y-4">
          <p>This proposal was updated since you opened it. Please review the latest version before signing.</p>
          <button type="button" className={primaryButton} onClick={() => window.location.reload()}>
            Load the latest version
          </button>
        </div>
      ) : step === "details" ? (
        <DetailsStep
          proposal={proposal}
          signer={signer}
          setSigner={setSigner}
          selections={selections}
          totals={totals}
          onNext={async () => {
            setError(null);
            if (!proposal.requireOtp) return setStep("sign");
            try {
              await sendCode(proposal.slug, signer.email);
              setStep("verify");
            } catch (e) {
              fail(e);
            }
          }}
        />
      ) : step === "verify" ? (
        <VerifyStep slug={proposal.slug} email={signer.email} onBack={() => setStep("details")} onVerified={() => (setError(null), setStep("sign"))} onError={fail} />
      ) : step === "sign" ? (
        <SignStep
          signerName={signer.name}
          company={signer.company}
          onBack={() => setStep("details")}
          onSubmit={async (signature) => {
            setError(null);
            try {
              const r = await signProposal(proposal.slug, {
                version: proposal.version,
                selections,
                signer,
                signature,
                consent: true,
                timezoneOffsetMinutes: new Date().getTimezoneOffset(),
              });
              setStep("done");
              onSigned({ certificateId: r.certificateId });
            } catch (e) {
              fail(e);
            }
          }}
        />
      ) : (
        <p>Your acceptance has been recorded. You'll receive a signed copy by email, and you can download it from this page once it's ready.</p>
      )}
      {error && !stale && (
        <p role="alert" className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      )}
    </PublicModal>
  );
}

function DetailsStep({
  proposal,
  signer,
  setSigner,
  selections,
  totals,
  onNext,
}: {
  proposal: PublicProposal;
  signer: { name: string; email: string; title: string; company: string };
  setSigner: (s: { name: string; email: string; title: string; company: string }) => void;
  selections: Selections;
  totals: PricingResult | null;
  onNext: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const pricing = proposal.document!.pricing;
  const chosen = pricing.sections.flatMap((s) => s.items.filter((i) => (selections[s.id] ?? []).includes(i.id)).map((i) => ({ section: s.title, name: i.name, id: i.id })));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    await onNext();
    setBusy(false);
  };
  const field = (key: keyof typeof signer, label: string, type = "text", autoComplete?: string) => (
    <label className="block text-sm font-medium">
      {label}
      <input required type={type} autoComplete={autoComplete} className={publicInput} value={signer[key]} onChange={(e) => setSigner({ ...signer, [key]: e.target.value })} />
    </label>
  );
  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {field("name", "Full name", "text", "name")}
        {field("email", "Email", "email", "email")}
        {field("title", "Title", "text", "organization-title")}
        {field("company", "Company", "text", "organization")}
      </div>
      {chosen.length > 0 && (
        <div className="rounded-lg bg-black/[0.03] p-4">
          <h3 className="mb-2 text-sm font-semibold">You're accepting</h3>
          <ul className="space-y-1 text-sm">
            {chosen.map((c) => (
              <li key={c.id}>• {c.name}</li>
            ))}
          </ul>
          {totals && (
            <div className="mt-3 flex justify-between border-t border-black/10 pt-3 font-semibold">
              <span>Total</span>
              <span className="text-right tabular-nums">
                {cadenceParts(totals.total).map(([c, v]) => (
                  <div key={c}>{money(v, c)}</div>
                ))}
              </span>
            </div>
          )}
        </div>
      )}
      <button type="submit" className={primaryButton} disabled={busy}>
        {busy ? "One moment…" : "Continue"}
      </button>
    </form>
  );
}

function VerifyStep({ slug, email, onBack, onVerified, onError }: { slug: string; email: string; onBack: () => void; onVerified: () => void; onError: (e: unknown) => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(30);
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown(cooldown - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await verifyCode(slug, email, code);
          onVerified();
        } catch (err) {
          onError(err);
        } finally {
          setBusy(false);
        }
      }}
    >
      <p>
        We sent a 6-digit code to <strong>{email}</strong>. It expires in 10 minutes.
      </p>
      <label className="block text-sm font-medium">
        Verification code
        <input
          required
          autoFocus
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          className={`${publicInput} text-center text-2xl tracking-[0.5em]`}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
        />
      </label>
      <button type="submit" className={primaryButton} disabled={busy || code.length !== 6}>
        {busy ? "Checking…" : "Verify"}
      </button>
      <div className="flex justify-between text-sm">
        <button type="button" onClick={onBack} className="underline text-(--color-muted)">
          Change email
        </button>
        <button
          type="button"
          disabled={cooldown > 0}
          className="underline text-(--color-muted) disabled:no-underline disabled:opacity-40"
          onClick={async () => {
            try {
              await sendCode(slug, email);
              setCooldown(30);
            } catch (err) {
              onError(err);
            }
          }}
        >
          {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
        </button>
      </div>
    </form>
  );
}

function SignStep({ signerName, company, onBack, onSubmit }: { signerName: string; company: string; onBack: () => void; onSubmit: (s: { type: "typed"; text: string } | { type: "drawn"; imageDataUrl: string }) => Promise<void> }) {
  const [mode, setMode] = useState<"typed" | "drawn">("typed");
  const [typed, setTyped] = useState(signerName);
  const [drawn, setDrawn] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const ready = agreed && (mode === "typed" ? typed.trim().length >= 2 : Boolean(drawn));
  const tab = (m: "typed" | "drawn", label: string) => (
    <button type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)} className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium ${mode === m ? "bg-white shadow-sm" : "text-(--color-muted)"}`}>
      {label}
    </button>
  );
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!ready) return;
        setBusy(true);
        await onSubmit(mode === "typed" ? { type: "typed", text: typed.trim() } : { type: "drawn", imageDataUrl: drawn! });
        setBusy(false);
      }}
    >
      <div role="tablist" aria-label="Signature style" className="flex gap-1 rounded-lg bg-black/5 p-1">
        {tab("typed", "Type")}
        {tab("drawn", "Draw")}
      </div>
      {mode === "typed" ? (
        <div>
          <label className="block text-sm font-medium">
            Type your full name
            <input className={publicInput} value={typed} onChange={(e) => setTyped(e.target.value)} />
          </label>
          <div className="mt-3 flex h-20 items-end border-b border-black/30 pb-1 text-4xl" style={{ fontFamily: `"${SIGNATURE_FONT}", cursive` }} role="img" aria-label="Signature preview">
            {typed}
          </div>
        </div>
      ) : (
        <SignaturePad onChange={setDrawn} />
      )}
      <label className="flex gap-3 text-sm leading-relaxed">
        <input type="checkbox" className="mt-1 size-4 shrink-0 accent-(--color-accent)" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
        <span>{consentText(company)}</span>
      </label>
      <button type="submit" className={primaryButton} disabled={!ready || busy}>
        {busy ? "Signing…" : "Sign & Accept"}
      </button>
      <button type="button" onClick={onBack} className="block w-full text-center text-sm underline text-(--color-muted)">
        Back
      </button>
    </form>
  );
}
