import type { PublicProposalMeta } from "@bridger/shared";
import { PUBLIC_PAGE_HEADERS, escapeHtml, ogTags } from "../../src/lib/ogMeta";

/**
 * Pages Function for /p/:slug (SPEC §8.1): serves the SPA shell with the proposal's
 * title and Open Graph tags injected, plus noindex/referrer headers.
 *
 * Metadata comes from the API Worker through a service binding (`API`, see
 * wrangler.toml), which avoids routing a subrequest back through the zone. Without the
 * binding (local `pages dev`) it falls back to fetching the same origin.
 * If anything fails, the plain shell is served; the SPA still works.
 */
interface Env {
  ASSETS: Fetcher;
  API?: Fetcher;
}

export const onRequestGet: PagesFunction<Env, "slug"> = async ({ request, env, params }) => {
  const url = new URL(request.url);
  const slug = String(params.slug);
  const shell = await env.ASSETS.fetch(new URL("/", url));

  let meta: PublicProposalMeta | null = null;
  if (/^[A-Za-z0-9_-]{21}$/.test(slug) && url.searchParams.get("print") !== "1") {
    try {
      const metaUrl = new URL(`/api/public/proposals/${slug}/meta`, url);
      const res = env.API ? await env.API.fetch(metaUrl.toString()) : await fetch(metaUrl);
      if (res.ok) meta = (await res.json()) as PublicProposalMeta;
    } catch {
      // fall through to the plain shell
    }
  }

  const page = meta
    ? new HTMLRewriter()
        .on("title", { element: (e) => void e.setInnerContent(escapeHtml(meta!.title), { html: true }) })
        .on("head", { element: (e) => void e.append(ogTags(meta!, `${url.origin}${url.pathname}`), { html: true }) })
        .transform(shell)
    : shell;

  const headers = new Headers(page.headers);
  for (const [k, v] of Object.entries(PUBLIC_PAGE_HEADERS)) headers.set(k, v);
  headers.set("Cache-Control", "no-store");
  return new Response(page.body, { status: 200, headers });
};
