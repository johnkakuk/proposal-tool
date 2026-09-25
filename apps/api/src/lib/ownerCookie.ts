import { sha256Hex } from "@bridger/shared";

/**
 * "This browser is me" (SPEC §7.6): an HttpOnly cookie proving the visitor is the owner,
 * so tracking ignores them. The value is a keyed hash, so it can't be forged.
 */
export const OWNER_COOKIE = "bdp_owner";

export const ownerCookieValue = (secret: string) => sha256Hex(`owner-cookie:v1:${secret}`);

export async function hasOwnerCookie(cookieHeader: string | undefined, secret: string): Promise<boolean> {
  const value = cookieHeader?.split(/;\s*/).find((c) => c.startsWith(`${OWNER_COOKIE}=`))?.slice(OWNER_COOKIE.length + 1);
  return Boolean(value) && value === (await ownerCookieValue(secret));
}

export function ownerCookieHeader(value: string, secure: boolean, maxAgeSeconds: number): string {
  return `${OWNER_COOKIE}=${value}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}
