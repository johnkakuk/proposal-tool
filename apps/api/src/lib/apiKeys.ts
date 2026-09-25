import { sha256Hex } from "@bridger/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Static API keys for Claude Code, scripts, and Zapier (SPEC §3). Format:
 * `bdp_` + 32 base62 characters (~190 bits). Only the SHA-256 is stored; the key is
 * shown once. `key_prefix` (first 8 characters) identifies it in Settings.
 */
export const API_KEY_PREFIX = "bdp_";
const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

export function generateApiKey(): string {
  const out: string[] = [];
  const buf = new Uint8Array(64);
  while (out.length < 32) {
    crypto.getRandomValues(buf);
    for (const b of buf) if (b < 248 && out.length < 32) out.push(ALPHABET[b % 62]!); // 248 = 62×4: unbiased
  }
  return API_KEY_PREFIX + out.join("");
}

export const isApiKey = (token: string) => /^bdp_[0-9A-Za-z]{32}$/.test(token);
export const hashApiKey = (key: string) => sha256Hex(key);

export interface ApiKeyPrincipal {
  keyId: string;
  ownerId: string;
  name: string;
}

/** Looks up an active key and records its use. */
export async function resolveApiKey(db: SupabaseClient, token: string): Promise<ApiKeyPrincipal | null> {
  if (!isApiKey(token)) return null;
  const { data } = await db.from("api_keys").select("id, owner_id, name").eq("key_hash", await hashApiKey(token)).is("revoked_at", null).maybeSingle();
  if (!data) return null;
  await db.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", data.id);
  return { keyId: data.id as string, ownerId: data.owner_id as string, name: data.name as string };
}
