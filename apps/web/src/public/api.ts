import type { PublicProposal } from "@bridger/shared";

export class NotAvailableError extends Error {}

/** Public endpoints: no auth, same origin (the Worker serves /api/public). */
export async function fetchPublicProposal(slug: string): Promise<PublicProposal> {
  const res = await fetch(`/api/public/proposals/${encodeURIComponent(slug)}`);
  if (res.status === 404) throw new NotAvailableError("This proposal isn't available.");
  if (!res.ok) throw new Error("Couldn't load this proposal. Please try again.");
  return (await res.json()) as PublicProposal;
}

export async function requestExtension(slug: string, message: string): Promise<void> {
  const res = await fetch(`/api/public/proposals/${encodeURIComponent(slug)}/extension-request`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(message ? { message } : {}),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message ?? "Couldn't send the request. Please try again.");
  }
}
