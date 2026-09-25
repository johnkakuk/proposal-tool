/**
 * Forwards the Worker's paths to the API Worker through the `API` service binding
 * (wrangler.toml), so the whole app lives on one hostname without Cloudflare managing
 * the domain's DNS (Worker routes would require that). `public/_routes.json` limits
 * Functions to these paths plus /p/*, so static assets never invoke this.
 *
 * The forwarded request keeps its URL, method, headers, and body; responses (including
 * MCP streams and Set-Cookie) pass straight through. The visitor's location is sent in
 * X-Bridger-Geo because `request.cf` doesn't describe the visitor after the hop.
 */
interface Env {
  API?: Fetcher;
}

const GEO_HEADER = "X-Bridger-Geo";

export function isWorkerPath(pathname: string): boolean {
  return /^\/(api|oauth|\.well-known|t)\//.test(pathname) || pathname === "/mcp" || pathname.startsWith("/mcp/");
}

export const onRequest: PagesFunction<Env> = async ({ request, env, next }) => {
  if (!isWorkerPath(new URL(request.url).pathname)) return next();
  if (!env.API) return new Response("API service binding missing", { status: 502 });

  const headers = new Headers(request.headers);
  const cf = (request as { cf?: { country?: string; region?: string; city?: string } }).cf;
  if (cf) headers.set(GEO_HEADER, JSON.stringify({ country: cf.country, region: cf.region, city: cf.city }));
  else headers.delete(GEO_HEADER);
  return env.API.fetch(new Request(request, { headers }));
};
