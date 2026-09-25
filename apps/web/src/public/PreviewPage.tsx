import type { Pricing, ProposalContent, Theme, CompanyInfo, OwnerSignature } from "@bridger/shared";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { useParams } from "react-router";
import { ProposalBlocks, RenderProvider, useRenderContextValue } from "../render/ProposalRenderer";

interface Preview {
  title: string;
  clientName: string | null;
  brand: { theme: Theme | null; company: CompanyInfo | null };
  document: { content: ProposalContent; pricing: Pricing; ownerSignature: OwnerSignature | null };
}

/** Draft preview from a signed 1-hour link (SPEC §10.2 get_preview_url). Never tracked. */
export function PreviewPage() {
  const { token = "" } = useParams();
  const q = useQuery({
    queryKey: ["preview", token],
    queryFn: async () => {
      const res = await fetch(`/api/public/preview/${encodeURIComponent(token)}`);
      if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: { message?: string } } | null)?.error?.message ?? "This preview isn't available.");
      return (await res.json()) as Preview;
    },
    retry: false,
  });
  useEffect(() => {
    document.title = q.data ? `Preview: ${q.data.title}` : "Preview";
  }, [q.data]);
  if (q.isLoading) return <div className="min-h-screen bg-white" aria-busy="true" />;
  if (!q.data) return <main className="flex min-h-screen items-center justify-center p-8 text-center text-slate-600">{q.error instanceof Error ? q.error.message : "This preview isn't available."}</main>;
  return <PreviewBody p={q.data} />;
}

function PreviewBody({ p }: { p: Preview }) {
  const value = useRenderContextValue(p.document.pricing, "preview", { ownerSignatureName: p.document.ownerSignature?.name });
  return (
    <RenderProvider value={value} theme={p.brand.theme} overrides={p.document.content.theme}>
      <div className="min-h-screen bg-(--color-background)">
        <div role="status" className="sticky top-0 z-10 bg-amber-100 px-4 py-2 text-center text-sm text-amber-900">
          Draft preview{p.clientName ? ` for ${p.clientName}` : ""}. Not sent to the client, and the link expires within an hour.
        </div>
        <main className="mx-auto max-w-4xl px-4 py-10 sm:px-8">
          <ProposalBlocks content={p.document.content} />
        </main>
      </div>
    </RenderProvider>
  );
}
