import { Hono } from "hono";
import { REQUIRED_SECRETS, type AppEnv } from "../env.js";
import { serviceClient } from "../lib/supabase.js";

export const health = new Hono<AppEnv>().get("/", async (c) => {
  const configured = REQUIRED_SECRETS.every((k) => Boolean(c.env[k]));
  const body: { ok: boolean; service: string; time: string; configured: boolean; database?: "ok" | "error" } = {
    ok: configured,
    service: "bridger-proposals-api",
    time: new Date().toISOString(),
    configured,
  };

  // ?deep=1 also checks the database connection.
  if (c.req.query("deep") === "1" && configured) {
    const { error } = await serviceClient(c.env).from("settings").select("id", { head: true, count: "exact" });
    body.database = error ? "error" : "ok";
    body.ok = body.ok && !error;
  }
  return c.json(body, body.ok ? 200 : 503);
});
