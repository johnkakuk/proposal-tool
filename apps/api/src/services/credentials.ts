import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { generateApiKey, hashApiKey } from "../lib/apiKeys.js";
import { ApiError } from "../lib/errors.js";
import { must, type ServiceContext } from "./context.js";

/** Settings → AI & API (SPEC §7.6): API keys and connected OAuth clients. */

export interface ApiKeyRow {
  id: string;
  name: string;
  key_prefix: string;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export async function listApiKeys(ctx: ServiceContext): Promise<ApiKeyRow[]> {
  return must(
    await ctx.db.from("api_keys").select("id, name, key_prefix, last_used_at, revoked_at, created_at").eq("owner_id", ctx.ownerId).is("revoked_at", null).order("created_at", { ascending: false }),
    "list API keys",
  ) as ApiKeyRow[];
}

/** Returns the full key exactly once; only its hash is stored. */
export async function createApiKey(ctx: ServiceContext, name: string): Promise<ApiKeyRow & { key: string }> {
  const key = generateApiKey();
  const row = must(
    await ctx.db.from("api_keys").insert({ owner_id: ctx.ownerId, name, key_prefix: key.slice(0, 8), key_hash: await hashApiKey(key) }).select("id, name, key_prefix, last_used_at, revoked_at, created_at").single(),
    "create the API key",
  ) as ApiKeyRow;
  return { ...row, key };
}

export async function revokeApiKey(ctx: ServiceContext, id: string): Promise<void> {
  const rows = must(
    await ctx.db.from("api_keys").update({ revoked_at: new Date().toISOString() }).eq("owner_id", ctx.ownerId).eq("id", id).is("revoked_at", null).select("id"),
    "revoke the API key",
  ) as { id: string }[];
  if (!rows.length) throw new ApiError(404, "not_found", "API key not found");
}

export async function listConnections(ctx: ServiceContext, oauth: OAuthHelpers | undefined) {
  if (!oauth) return [];
  const grants = (await oauth.listUserGrants(ctx.ownerId)).items;
  return Promise.all(
    grants.map(async (g) => {
      const client = await oauth.lookupClient(g.clientId);
      return { grantId: g.id, clientId: g.clientId, clientName: client?.clientName ?? "Unknown app", scope: g.scope, createdAt: new Date(g.createdAt * 1000).toISOString() };
    }),
  );
}

export async function revokeConnection(ctx: ServiceContext, oauth: OAuthHelpers | undefined, grantId: string): Promise<void> {
  if (!oauth) throw new ApiError(503, "unavailable", "OAuth isn't available here.");
  await oauth.revokeGrant(grantId, ctx.ownerId);
}
