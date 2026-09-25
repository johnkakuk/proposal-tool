import type { AuthRequest } from "@cloudflare/workers-oauth-provider";
import { Hono } from "hono";
import { nanoid } from "nanoid";
import type { AppEnv } from "../env.js";
import { ApiError } from "../lib/errors.js";

/**
 * OAuth 2.1 authorization for MCP connectors (SPEC §3). The provider (src/index.ts)
 * serves discovery, dynamic client registration, and tokens; this route starts consent:
 * it validates the request, parks it in KV for 10 minutes, and sends the browser to the
 * in-app consent page (/app/connect/:id), where John signs in and approves or denies.
 */
export interface PendingConsent {
  request: AuthRequest;
  clientName: string;
  redirectHost: string;
}

export const CONSENT_TTL = 600;
export const consentKey = (id: string) => `consent:${id}`;

/** A readable, audit-safe client name ("Claude", "ChatGPT", …). */
export const cleanClientName = (name: string | undefined) => (name ?? "").replace(/[^\p{L}\p{N} ._-]/gu, "").trim().slice(0, 40) || "AI client";

export const oauth = new Hono<AppEnv>().get("/authorize", async (c) => {
  const helpers = c.env.OAUTH_PROVIDER;
  if (!helpers) throw new ApiError(503, "unavailable", "OAuth isn't available.");
  let request: AuthRequest;
  try {
    request = await helpers.parseAuthRequest(c.req.raw);
  } catch (e) {
    return c.text(`Invalid authorization request: ${e instanceof Error ? e.message : "unknown error"}`, 400);
  }
  const client = await helpers.lookupClient(request.clientId);
  if (!client) return c.text("Unknown client. Re-add the connector and try again.", 400);
  const id = nanoid(24);
  const pending: PendingConsent = { request, clientName: cleanClientName(client.clientName), redirectHost: new URL(request.redirectUri).host };
  await c.env.OAUTH_KV.put(consentKey(id), JSON.stringify(pending), { expirationTtl: CONSENT_TTL });
  return c.redirect(`/app/connect/${id}`, 302);
});
