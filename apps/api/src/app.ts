import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "./env.js";
import { ApiError } from "./lib/errors.js";
import { health } from "./routes/health.js";
import { publicRoutes } from "./routes/public.js";
import { v1 } from "./routes/v1/index.js";

/**
 * Routes on proposals.bridgerdigital.com that reach the Worker (SPEC §2):
 *   /api/*          REST (admin, public viewer, v1)
 *   /mcp            MCP server                     — Phase 7
 *   /oauth/*, /.well-known/*  OAuth 2.1 for MCP    — Phase 7
 *   /t/*            tracking ingest                — Phase 6
 * All business logic lives in src/services/* (SPEC §10.5); routes stay thin.
 */
export function createApp() {
  const app = new Hono<AppEnv>();

  app.route("/api/health", health);
  app.route("/api/public", publicRoutes);
  app.route("/api/v1", v1);

  app.notFound((c) => c.json({ error: { code: "not_found", message: `No route for ${c.req.method} ${c.req.path}` } }, 404));

  app.onError((err, c) => {
    if (err instanceof ApiError) {
      return c.json({ error: { code: err.code, message: err.message, ...(err.issues ? { issues: err.issues } : {}) } }, err.status);
    }
    if (err instanceof HTTPException) return err.getResponse();
    console.error("Unhandled error", err);
    return c.json({ error: { code: "internal", message: "Something went wrong" } }, 500);
  });

  return app;
}
