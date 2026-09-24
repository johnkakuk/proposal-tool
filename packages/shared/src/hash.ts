import canonicalize from "canonicalize";

/**
 * Canonical hashing for signed snapshots (§8.2): RFC 8785 JSON canonicalization,
 * then SHA-256 via Web Crypto (available in browsers, Workers, and Node 20+).
 */

export function canonicalJson(value: unknown): string {
  const out = canonicalize(value);
  if (out === undefined) throw new TypeError("Value cannot be canonicalized");
  return out;
}

export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** SHA-256 hex of the RFC 8785 canonical form. Key order and whitespace don't affect the result. */
export async function hashCanonical(value: unknown): Promise<string> {
  return sha256Hex(canonicalJson(value));
}

/** The hash stored on proposal_versions: canonical {content, pricing}. */
export async function documentHash(doc: { content: unknown; pricing: unknown }): Promise<string> {
  return hashCanonical({ content: doc.content, pricing: doc.pricing });
}
