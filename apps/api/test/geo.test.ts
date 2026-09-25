import { describe, expect, it } from "vitest";
import { GEO_HEADER, requestGeo } from "../src/lib/geo";

describe("requestGeo", () => {
  it("prefers the location forwarded by the Pages proxy", () => {
    const req = new Request("https://x.test/", { headers: { [GEO_HEADER]: JSON.stringify({ country: "US", region: "Montana", city: "Bozeman" }) } });
    expect(requestGeo(req)).toEqual({ country: "US", region: "Montana", city: "Bozeman" });
  });

  it("ignores malformed or oversized values", () => {
    expect(requestGeo(new Request("https://x.test/", { headers: { [GEO_HEADER]: "{nope" } }))).toBeUndefined();
    const long = requestGeo(new Request("https://x.test/", { headers: { [GEO_HEADER]: JSON.stringify({ country: 5, city: "x".repeat(200) }) } }));
    expect(long).toEqual({ country: undefined, region: undefined, city: undefined });
  });

  it("falls back to request.cf, and to nothing", () => {
    const req = Object.assign(new Request("https://x.test/"), { cf: { country: "CA", region: "BC", city: "Victoria", asn: 1 } });
    expect(requestGeo(req)).toEqual({ country: "CA", region: "BC", city: "Victoria" });
    expect(requestGeo(new Request("https://x.test/"))).toBeUndefined();
  });
});
