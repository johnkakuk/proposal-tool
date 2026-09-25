import { maskEmail, sha256Hex } from "@bridger/shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../env.js";
import { escapeHtml, sendEmail } from "../lib/email.js";
import { ApiError } from "../lib/errors.js";
import { must } from "./context.js";
import { loadPublicRow, publicState, type PublicRow } from "./public.js";

/**
 * Email verification for signing (SPEC §8.2 step 3): 6-digit code, 10-minute expiry,
 * 5 attempts per code, at most 3 sends per 15 minutes per proposal + email.
 * Only a salted hash of the code is stored.
 */

const MAX_SENDS = 3;
const SEND_WINDOW_MS = 15 * 60_000;
const MAX_ATTEMPTS = 5;

export interface RequestMeta {
  ip?: string;
  userAgent?: string;
}

const normalize = (email: string) => email.trim().toLowerCase();

function randomCode(): string {
  // Rejection sampling for an unbiased 6-digit code.
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0]! < 4_294_000_000) return String(buf[0]! % 1_000_000).padStart(6, "0");
  }
}

const hashCode = (secret: string, proposalId: string, email: string, code: string) => sha256Hex(`${secret}:${proposalId}:${email}:${code}`);

function assertSignable(row: PublicRow) {
  const state = publicState(row);
  if (state !== "active") throw new ApiError(409, "not_signable", state === "expired" ? "This proposal has expired." : "This proposal can no longer be signed.");
}

async function audit(db: SupabaseClient, row: PublicRow, type: "otp_sent" | "otp_verified", meta: RequestMeta, email: string) {
  must(
    await db.from("audit_events").insert({ owner_id: row.owner_id, proposal_id: row.id, event_type: type, actor: "client", ip: meta.ip ?? null, user_agent: meta.userAgent ?? null, metadata: { email: maskEmail(email) } }),
    "write the audit log",
  );
}

export async function sendOtp(env: Env, db: SupabaseClient, slug: string, rawEmail: string, meta: RequestMeta): Promise<void> {
  const row = await loadPublicRow(db, slug);
  assertSignable(row);
  const email = normalize(rawEmail);

  const since = new Date(Date.now() - SEND_WINDOW_MS).toISOString();
  const { count } = await db.from("otp_codes").select("id", { count: "exact", head: true }).eq("proposal_id", row.id).eq("email", email).gte("created_at", since);
  if ((count ?? 0) >= MAX_SENDS) throw new ApiError(429, "rate_limited", "Too many codes requested. Please wait a few minutes and try again.");

  const code = randomCode();
  must(await db.from("otp_codes").insert({ proposal_id: row.id, email, code_hash: await hashCode(env.SIGNING_SECRET, row.id, email, code) }), "create the code");

  const sent = await sendEmail(env, db, {
    ownerId: row.owner_id,
    proposalId: row.id,
    to: email,
    template: "otp",
    replyTo: env.OWNER_EMAIL,
    subject: `${code} is your code to sign “${row.title}”`,
    text: `Your verification code is ${code}. It expires in 10 minutes.\n\nIf you didn't request this, you can ignore this email.`,
    html: `<p>Your verification code for signing <strong>${escapeHtml(row.title)}</strong>:</p><p style="font-size:28px;letter-spacing:6px;font-weight:700">${code}</p><p>It expires in 10 minutes. If you didn't request this, you can ignore this email.</p>`,
  });
  if (!sent.ok) throw new ApiError(503, "email_failed", "We couldn't send the code. Please try again in a moment.");
  await audit(db, row, "otp_sent", meta, email);
}

export async function verifyOtp(env: Env, db: SupabaseClient, slug: string, rawEmail: string, code: string, meta: RequestMeta): Promise<void> {
  const row = await loadPublicRow(db, slug);
  assertSignable(row);
  const email = normalize(rawEmail);
  const otp = must(
    await db
      .from("otp_codes")
      .select("id, code_hash, attempts, expires_at, verified_at")
      .eq("proposal_id", row.id)
      .eq("email", email)
      .is("used_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    "check the code",
  ) as { id: string; code_hash: string; attempts: number; expires_at: string; verified_at: string | null } | null;

  if (!otp || Date.parse(otp.expires_at) <= Date.now()) throw new ApiError(400, "code_expired", "That code has expired. Request a new one.");
  if (otp.verified_at) return;
  if (otp.attempts >= MAX_ATTEMPTS) throw new ApiError(429, "too_many_attempts", "Too many incorrect attempts. Request a new code.");

  const matches = timingSafeEqual(await hashCode(env.SIGNING_SECRET, row.id, email, code), otp.code_hash);
  if (!matches) {
    must(await db.from("otp_codes").update({ attempts: otp.attempts + 1 }).eq("id", otp.id), "check the code");
    const left = MAX_ATTEMPTS - otp.attempts - 1;
    throw new ApiError(400, "wrong_code", left > 0 ? `That code isn't right. ${left} attempt${left === 1 ? "" : "s"} left.` : "Too many incorrect attempts. Request a new code.");
  }
  must(await db.from("otp_codes").update({ verified_at: new Date().toISOString() }).eq("id", otp.id), "verify the code");
  await audit(db, row, "otp_verified", meta, email);
}

/** The verified, unused code for this signer, if any (consumed by the signing transaction). */
export async function findVerifiedOtp(db: SupabaseClient, proposalId: string, rawEmail: string): Promise<string | null> {
  const since = new Date(Date.now() - 30 * 60_000).toISOString();
  const row = must(
    await db
      .from("otp_codes")
      .select("id")
      .eq("proposal_id", proposalId)
      .eq("email", normalize(rawEmail))
      .is("used_at", null)
      .not("verified_at", "is", null)
      .gte("verified_at", since)
      .order("verified_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    "check email verification",
  ) as { id: string } | null;
  return row?.id ?? null;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
