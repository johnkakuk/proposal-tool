import { describe, expect, it, vi } from "vitest";
import { rateLimit } from "../src/lib/rateLimit";

const binding = (outcome: boolean | Error) => ({
  limit: vi.fn(async (_: { key: string }) => {
    if (outcome instanceof Error) throw outcome;
    return { success: outcome };
  }),
});

describe("rateLimit", () => {
  it("passes the key to the binding and allows requests under the limit", async () => {
    const b = binding(true);
    await expect(rateLimit(b, "sign:203.0.113.9")).resolves.toBeUndefined();
    expect(b.limit).toHaveBeenCalledWith({ key: "sign:203.0.113.9" });
  });

  it("rejects over the limit with 429", async () => {
    await expect(rateLimit(binding(false), "sign:1.2.3.4")).rejects.toMatchObject({ status: 429, code: "rate_limited" });
  });

  it("fails open when the binding throws or is missing, and logs it", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(rateLimit(binding(new Error("boom")), "otp:1.2.3.4")).resolves.toBeUndefined();
    await expect(rateLimit(undefined, "decline:1.2.3.4")).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledTimes(2);
    expect(String(log.mock.calls[0]![0])).toContain("otp");
    log.mockRestore();
  });

  it("is skipped entirely when RATE_LIMIT_OFF is set", async () => {
    const b = binding(false);
    await expect(rateLimit(b, "sign:1.2.3.4", { off: "1" })).resolves.toBeUndefined();
    expect(b.limit).not.toHaveBeenCalled();
  });
});
