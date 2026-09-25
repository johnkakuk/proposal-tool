import type { PublicSignature } from "@bridger/shared";
import { Markdown } from "../render/Markdown";
import { useRenderContext } from "../render/RenderContext";
import { useGoogleFonts } from "../render/ThemeScope";
import { MarkdownInput, Toggle } from "./fields";
import type { BlockUI } from "./types";

/** Script font for typed signatures (SPEC §8.2 step 4). */
export const SIGNATURE_FONT = "Caveat";

const formatDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { dateStyle: "long" });

function SignatureLine({ label, children, caption }: { label: string; children: React.ReactNode; caption?: React.ReactNode }) {
  return (
    <div>
      <div className="flex h-20 items-end border-b border-black/30 pb-1" aria-label={label}>
        {children}
      </div>
      <div className="mt-2 text-sm opacity-70">{caption}</div>
    </div>
  );
}

function SignedMark({ s }: { s: PublicSignature }) {
  return s.signature.type === "typed" ? (
    <span className="text-4xl leading-none" style={{ fontFamily: `"${SIGNATURE_FONT}", cursive` }}>
      {s.signature.text}
    </span>
  ) : s.signature.imageUrl ? (
    <img src={s.signature.imageUrl} alt={`Signature of ${s.signerName}`} className="h-16 w-auto" />
  ) : (
    <span className="italic opacity-60">Signed</span>
  );
}

function SignatureRenderer({ props }: { props: { intro: string; showOwnerSignature: boolean } }) {
  const { ownerSignatureName, signing, mode } = useRenderContext();
  useGoogleFonts([SIGNATURE_FONT]);
  const signed = signing?.signed ?? null;
  const canSign = Boolean(signing?.onAccept) && !signed;
  // The "set it up in Settings" hint is for the owner's editor only; clients never see an empty line.
  const showOwner = props.showOwnerSignature && (mode === "editor" || Boolean(ownerSignatureName));

  return (
    <section className="rounded-xl border-2 border-(--color-primary)/15 p-6 @lg:p-8">
      <h2 className="proposal-h2 !mt-0">{signed ? "Accepted" : "Accept this proposal"}</h2>
      {props.intro && !signed && <Markdown>{props.intro}</Markdown>}
      <div className={`mt-6 grid gap-8 ${showOwner ? "@lg:grid-cols-2" : ""}`}>
        {signed ? (
          <SignatureLine
            label="Client signature"
            caption={
              <>
                <strong className="opacity-100">{signed.signerName}</strong>
                {signed.signerTitle ? `, ${signed.signerTitle}` : ""}
                {signed.signerCompany ? ` · ${signed.signerCompany}` : ""}
                <br />
                Signed electronically on {formatDate(signed.signedAt)}
                {mode !== "print" && signing && (
                  <>
                    {" · "}
                    <a className="underline" href={`/p/${signing.slug}/certificate`}>
                      Certificate {signed.certificateId}
                    </a>
                  </>
                )}
              </>
            }
          >
            <SignedMark s={signed} />
          </SignatureLine>
        ) : (
          <SignatureLine label="Client signature" caption={canSign ? "Your signature" : "Signed electronically when the client accepts"}>
            {canSign ? (
              <button
                type="button"
                onClick={signing!.onAccept}
                className="mb-2 rounded-md bg-(--color-accent) px-5 py-2.5 font-semibold text-white shadow-sm hover:brightness-110"
              >
                Accept &amp; sign
              </button>
            ) : (
              <span className="text-sm opacity-40">Client signature</span>
            )}
          </SignatureLine>
        )}
        {showOwner && (
          <SignatureLine label="Bridger Digital signature" caption={ownerSignatureName ? `${ownerSignatureName}, Bridger Digital` : "Your signature (set it up in Settings)"}>
            <span className="text-4xl leading-none" style={{ fontFamily: `"${SIGNATURE_FONT}", cursive` }}>
              {ownerSignatureName ?? ""}
            </span>
          </SignatureLine>
        )}
      </div>
      {canSign && signing?.onDecline && (
        <p className="mt-6 text-sm opacity-70">
          Not the right fit?{" "}
          <button type="button" onClick={signing.onDecline} className="underline">
            Decline this proposal
          </button>
        </p>
      )}
    </section>
  );
}

export const signature: BlockUI<"signature"> = {
  type: "signature",
  singleton: true,
  menu: { description: "Where the client signs. Keep it last.", icon: "✍️", keywords: ["sign", "accept", "agreement", "e-signature"], group: "Sales" },
  Renderer: SignatureRenderer,
  Editor: ({ props, onChange }) => (
    <div className="space-y-3">
      <MarkdownInput label="Intro" value={props.intro} onChange={(intro) => onChange({ ...props, intro })} rows={3} />
      <Toggle label="Show my signature next to the client's" checked={props.showOwnerSignature} onChange={(showOwnerSignature) => onChange({ ...props, showOwnerSignature })} />
    </div>
  ),
};
