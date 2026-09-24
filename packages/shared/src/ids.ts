import { customAlphabet, nanoid } from "nanoid";

/** Block IDs: 10-char nanoid. Stable across edits and versions (analytics attach to them). */
export const newBlockId = (): string => nanoid(10);

/** Public proposal slug: 21-char nanoid (~126 bits), unguessable. */
export const newSlug = (): string => nanoid(21);

/** Pricing section / line item / discount IDs. Prefixed so they read well in AI-authored JSON. */
export const newSectionId = (): string => `sec_${nanoid(8)}`;
export const newItemId = (): string => `item_${nanoid(8)}`;
export const newDiscountId = (): string => `disc_${nanoid(8)}`;

// No 0/O, 1/I/L — easy to read aloud and type from a printed certificate.
const certAlphabet = customAlphabet("23456789ABCDEFGHJKMNPQRSTUVWXYZ", 8);

/** Human-readable certificate ID, e.g. `BDP-7K3Q-92XD`. */
export function newCertificateId(): string {
  const raw = certAlphabet();
  return `BDP-${raw.slice(0, 4)}-${raw.slice(4)}`;
}

export const CERTIFICATE_ID_RE = /^BDP-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/;
export const SLUG_RE = /^[A-Za-z0-9_-]{21}$/;
