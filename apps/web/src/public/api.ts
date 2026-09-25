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

export class PublicApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`/api/public${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => null)) as (T & { error?: { code: string; message: string } }) | null;
  if (!res.ok) throw new PublicApiError(res.status, json?.error?.code ?? "error", json?.error?.message ?? "Something went wrong. Please try again.");
  return json as T;
}

const p = (slug: string) => `/proposals/${encodeURIComponent(slug)}`;
export const sendCode = (slug: string, email: string) => post<{ ok: true }>(`${p(slug)}/otp`, { email });
export const verifyCode = (slug: string, email: string, code: string) => post<{ ok: true }>(`${p(slug)}/otp/verify`, { email, code });
export const signProposal = (slug: string, body: unknown) => post<{ signatureId: string; certificateId: string; documentHash: string }>(`${p(slug)}/sign`, body);
export const declineProposal = (slug: string, reason: string) => post<{ ok: true }>(`${p(slug)}/decline`, reason ? { reason } : {});

export async function fetchCertificate(slug: string, token?: string | null) {
  const res = await fetch(`/api/public${p(slug)}/certificate${token ? `?token=${encodeURIComponent(token)}` : ""}`);
  if (res.status === 404) throw new NotAvailableError("No certificate for this proposal.");
  if (!res.ok) throw new Error("Couldn't load the certificate.");
  return (await res.json()) as import("@bridger/shared").PublicCertificate;
}

export const signedPdfUrl = (slug: string) => `/api/public${p(slug)}/signed.pdf`;
