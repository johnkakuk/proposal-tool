import { canonicalJson, sha256Hex, type PublicCertificate } from "@bridger/shared";
import { useEffect, useState } from "react";

/** Certificates always use UTC, so the record reads the same wherever it is rendered or viewed. */
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { dateStyle: "long", timeStyle: "long", timeZone: "UTC" });

const EVENT_LABEL: Record<string, string> = {
  published: "Proposal published",
  emailed: "Proposal emailed",
  viewed: "Viewed",
  otp_sent: "Verification code sent",
  otp_verified: "Email verified",
  signed: "Signed",
};

type Check = { status: "checking" } | { status: "match"; hash: string } | { status: "mismatch"; hash: string };

/** Recomputes SHA-256 over the RFC 8785 canonical snapshot, in the browser. */
export function useHashCheck(cert: PublicCertificate | undefined): Check {
  const [check, setCheck] = useState<Check>({ status: "checking" });
  useEffect(() => {
    if (!cert) return;
    void sha256Hex(canonicalJson(cert.snapshot)).then((hash) => setCheck({ status: hash === cert.documentHash ? "match" : "mismatch", hash }));
  }, [cert]);
  return check;
}

/** Certificate of Completion (SPEC §8.2). Used on the verification page and as the PDF's last page. */
export function CertificateDetails({ cert, check }: { cert: PublicCertificate; check?: Check }) {
  const row = (label: string, value: React.ReactNode, mono = false) => (
    <div className="grid gap-1 py-2 sm:grid-cols-[12rem_1fr]">
      <dt className="text-sm opacity-60">{label}</dt>
      <dd className={mono ? "font-mono text-xs break-all" : ""}>{value}</dd>
    </div>
  );
  const e = cert.evidence;
  return (
    <div>
      {check && (
        <div
          role="status"
          className={`mb-6 rounded-lg p-4 ${check.status === "match" ? "bg-emerald-50 text-emerald-900" : check.status === "mismatch" ? "bg-red-50 text-red-900" : "bg-black/5"}`}
        >
          {check.status === "checking"
            ? "Verifying…"
            : check.status === "match"
              ? "✓ Verified: the signed record is unchanged. Its SHA-256 hash matches the one recorded at signing."
              : "✗ Mismatch: the record's hash doesn't match the one recorded at signing."}
        </div>
      )}
      <dl className="divide-y divide-black/10">
        {row("Certificate ID", <strong>{cert.certificateId}</strong>)}
        {row("Document", `${cert.proposalTitle} (version ${cert.version})`)}
        {row("Signed by", `${cert.signer.name}${cert.signer.title ? `, ${cert.signer.title}` : ""}${cert.signer.company ? ` · ${cert.signer.company}` : ""}`)}
        {row("Signer email", cert.signer.email)}
        {row("Signed at", when(cert.signedAt))}
        {row("Document hash (SHA-256)", cert.documentHash, true)}
        {cert.pdfHash && row("Signed PDF hash (SHA-256)", cert.pdfHash, true)}
        {e && row("Email verified", e.emailVerified ? `Yes${e.otpVerifiedAt ? `, ${when(e.otpVerifiedAt)}` : ""}` : "No")}
        {e && row("IP address", e.ip ?? "—")}
        {e && row("Location", [(e.geo as { city?: string } | null)?.city, (e.geo as { region?: string } | null)?.region, (e.geo as { country?: string } | null)?.country].filter(Boolean).join(", ") || "—")}
        {e && row("Browser", <span className="text-xs">{e.userAgent ?? "—"}</span>)}
      </dl>
      {e && e.auditTrail.length > 0 && (
        <>
          <h3 className="mt-6 mb-2 font-semibold">Audit trail</h3>
          <table className="w-full text-left text-sm">
            <thead className="opacity-60">
              <tr>
                <th className="py-1 font-medium">Event</th>
                <th className="py-1 font-medium">Time</th>
                <th className="py-1 font-medium">IP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/10">
              {e.auditTrail.map((a, i) => (
                <tr key={i}>
                  <td className="py-1">{EVENT_LABEL[a.event] ?? a.event}</td>
                  <td className="py-1">{when(a.at)}</td>
                  <td className="py-1 font-mono text-xs">{a.ip ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <p className="mt-6 text-xs opacity-60">
        The document hash is the SHA-256 of the signed record (proposal content, pricing, the client's selections and totals, signer details, and consent) in RFC 8785 canonical JSON. Anyone
        can recompute it on the verification page. Signed electronically in accordance with the U.S. ESIGN Act and UETA.
      </p>
    </div>
  );
}
