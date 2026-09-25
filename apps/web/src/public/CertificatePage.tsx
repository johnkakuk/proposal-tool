import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { Link, useParams } from "react-router";
import { fetchCertificate, signedPdfUrl } from "./api";
import { CertificateDetails, useHashCheck } from "./Certificate";

/** Public verification page (SPEC §8.2 step 8): /p/:slug/certificate */
export function CertificatePage() {
  const { slug = "" } = useParams();
  const { data, error, isLoading } = useQuery({ queryKey: ["certificate", slug], queryFn: () => fetchCertificate(slug), retry: false });
  const check = useHashCheck(data);
  useEffect(() => {
    document.title = data ? `Certificate ${data.certificateId}` : "Certificate";
  }, [data]);

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-12 text-ink">
      <div className="mx-auto max-w-3xl rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 sm:p-10">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Certificate of Completion</p>
        {isLoading ? (
          <p className="mt-6 text-slate-500">Loading…</p>
        ) : error || !data ? (
          <p className="mt-6">No signed certificate exists for this link.</p>
        ) : (
          <>
            <h1 className="mt-1 mb-6 text-2xl font-bold">{data.proposalTitle}</h1>
            <CertificateDetails cert={data} check={check} />
            <div className="mt-8 flex flex-wrap gap-4 text-sm">
              <Link to={`/p/${slug}`} className="font-medium underline">
                View the signed proposal
              </Link>
              {data.pdfHash && (
                <a href={signedPdfUrl(slug)} className="font-medium underline">
                  Download the signed PDF
                </a>
              )}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
