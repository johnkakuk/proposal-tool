/**
 * Visitor location for evidence and analytics. Requests normally reach the Worker through
 * the Pages proxy (service binding), where `request.cf` describes the internal hop, so the
 * proxy forwards the visitor's location in `X-Bridger-Geo` (it always overwrites any
 * client-sent value). Direct requests (local dev) use `request.cf`.
 */
export interface Geo {
  country?: string;
  region?: string;
  city?: string;
}

export const GEO_HEADER = "X-Bridger-Geo";

export function requestGeo(req: Request): Geo | undefined {
  const forwarded = req.headers.get(GEO_HEADER);
  if (forwarded) {
    try {
      const g = JSON.parse(forwarded) as Record<string, unknown>;
      const str = (v: unknown) => (typeof v === "string" && v.length <= 100 ? v : undefined);
      return { country: str(g.country), region: str(g.region), city: str(g.city) };
    } catch {
      return undefined;
    }
  }
  const cf = (req as { cf?: Geo }).cf;
  return cf ? { country: cf.country, region: cf.region, city: cf.city } : undefined;
}
