import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../env.js";

/**
 * Sends one email and records it in email_log (SPEC §9). Transports:
 *   resend  — production (free tier), from proposals@bridgerdigital.com
 *   mailpit — local dev: Supabase's bundled Mailpit (http://127.0.0.1:54324)
 *   memory  — tests: appended to `memoryOutbox`
 * Phase 5 adds the branded templates and notification rules on top of this.
 */
export interface OutgoingEmail {
  ownerId: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Template name for email_log, e.g. "otp", "signed_copy". */
  template: string;
  proposalId?: string;
  replyTo?: string;
  attachments?: { filename: string; contentBase64: string }[];
  /** When set, the email is sent at most once for this key, ever (claimed in email_log). */
  dedupeKey?: string;
}

export const memoryOutbox: OutgoingEmail[] = [];

export async function sendEmail(env: Env, db: SupabaseClient, email: OutgoingEmail): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  const { data: log, error: logError } = await db
    .from("email_log")
    .insert({ owner_id: email.ownerId, to_email: email.to, template: email.template, proposal_id: email.proposalId ?? null, status: "queued", dedupe_key: email.dedupeKey ?? null })
    .select("id")
    .single();
  // Unique violation on dedupe_key: this email was already sent (or is being sent).
  if (logError?.code === "23505") return { ok: true, skipped: true };

  let providerId: string | null = null;
  let error: string | undefined;
  try {
    providerId = await transport(env, email);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    console.error(`Email "${email.template}" to ${email.to} failed:`, error);
  }
  if (log) {
    await db
      .from("email_log")
      .update(error ? { status: "failed", error } : { status: "sent", sent_at: new Date().toISOString(), resend_id: providerId })
      .eq("id", log.id);
  }
  return error ? { ok: false, error } : { ok: true };
}

async function transport(env: Env, email: OutgoingEmail): Promise<string | null> {
  const mode = env.EMAIL_TRANSPORT ?? "resend";
  if (mode === "memory") {
    memoryOutbox.push(email);
    return null;
  }
  if (mode === "mailpit") {
    const from = parseAddress(env.EMAIL_FROM);
    const res = await fetch(`${env.MAILPIT_URL ?? "http://127.0.0.1:54324"}/api/v1/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        From: { Email: from.email, Name: from.name },
        To: [{ Email: email.to }],
        ReplyTo: email.replyTo ? [{ Email: email.replyTo }] : undefined,
        Subject: email.subject,
        HTML: email.html,
        Text: email.text,
        Attachments: email.attachments?.map((a) => ({ Filename: a.filename, Content: a.contentBase64 })),
      }),
    });
    if (!res.ok) throw new Error(`Mailpit ${res.status}: ${await res.text()}`);
    return ((await res.json()) as { ID?: string }).ID ?? null;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: [email.to],
      reply_to: email.replyTo,
      subject: email.subject,
      html: email.html,
      text: email.text,
      attachments: email.attachments?.map((a) => ({ filename: a.filename, content: a.contentBase64 })),
    }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
  return ((await res.json()) as { id?: string }).id ?? null;
}

function parseAddress(value: string): { name?: string; email: string } {
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(value);
  return m ? { name: m[1] || undefined, email: m[2]! } : { email: value.trim() };
}

export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
