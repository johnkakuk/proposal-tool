import type { ApiErrorBody } from "@bridger/shared";
import { supabase } from "./supabase";

export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly issues: { path: string; message: string }[] = [],
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

/** Calls the Worker on the same origin with the owner's Supabase JWT. */
export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const headers = new Headers(init.headers);
  if (data.session) headers.set("Authorization", `Bearer ${data.session.access_token}`);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(init.json);
  }
  const res = await fetch(`/api/v1${path}`, { ...init, headers, body });
  if (res.status === 204) return undefined as T;
  const payload = (await res.json().catch(() => null)) as T | ApiErrorBody | null;
  if (!res.ok) {
    const err = (payload as ApiErrorBody | null)?.error;
    throw new ApiRequestError(res.status, err?.code ?? "error", err?.message ?? `Request failed (${res.status})`, err?.issues);
  }
  return payload as T;
}
