import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import type { Env } from "../src/env.js";

const env = (overrides: Partial<Env> = {}) =>
  ({
    SUPABASE_URL: "http://127.0.0.1:54321",
    SUPABASE_SERVICE_ROLE_KEY: "service",
    SUPABASE_JWT_SECRET: "jwt",
    RESEND_API_KEY: "re_test",
    TRACKING_SALT: "salt",
    APP_URL: "http://localhost:5173",
    OWNER_EMAIL: "owner@bridger.local",
    ...overrides,
  }) as Env;

describe("worker", () => {
  it("GET /api/health reports ok when configured", async () => {
    const res = await createApp().request("/api/health", {}, env());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, service: "bridger-proposals-api", configured: true });
  });

  it("GET /api/health returns 503 when secrets are missing, without naming them", async () => {
    const res = await createApp().request("/api/health", {}, env({ SUPABASE_SERVICE_ROLE_KEY: "" }));
    expect(res.status).toBe(503);
    const body = await res.text();
    expect(body).not.toContain("SERVICE_ROLE");
  });

  it("unknown routes return a JSON 404", async () => {
    const res = await createApp().request("/api/nope", {}, env());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: "not_found", message: "No route for GET /api/nope" } });
  });
});
