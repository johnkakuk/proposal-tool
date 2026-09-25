import { must, type ServiceContext } from "./context.js";

/** Settings → Data export (SPEC §7.6): all of the owner's data as one JSON document. */
export async function exportAll(ctx: ServiceContext) {
  const q = <T>(p: PromiseLike<{ data: T | null; error: { message: string } | null }>, what: string) => p.then((r) => must(r, what) as T);
  const [settings, clients, templates, proposals, versions, signatures, emails] = await Promise.all([
    q(ctx.db.from("settings").select("brand, default_terms_markdown, default_expiry_days, timezone, notification_prefs, owner_signature, require_signer_email_otp, ai_can_publish, ai_can_email_client, guidelines_markdown").eq("owner_id", ctx.ownerId).maybeSingle(), "export settings"),
    q(ctx.db.from("clients").select("*").eq("owner_id", ctx.ownerId).order("created_at"), "export clients"),
    q(ctx.db.from("templates").select("*").eq("owner_id", ctx.ownerId).order("created_at"), "export templates"),
    q(ctx.db.from("proposals").select("*").eq("owner_id", ctx.ownerId).order("created_at"), "export proposals"),
    q(ctx.db.from("proposal_versions").select("proposal_id, version, reason, content, pricing, content_hash, owner_signature, created_at").eq("owner_id", ctx.ownerId).order("version"), "export versions"),
    q(
      ctx.db
        .from("signatures")
        .select("proposal_id, version, signer_name, signer_email, signer_title, signer_company, signature_type, selections, computed_totals, consent_text, consent_given_at, email_verified, snapshot, document_hash, pdf_hash, certificate_id")
        .eq("owner_id", ctx.ownerId),
      "export signatures",
    ),
    q(ctx.db.from("email_log").select("to_email, template, proposal_id, status, sent_at").eq("owner_id", ctx.ownerId).order("created_at"), "export email log"),
  ]);
  const byProposal = <T extends { proposal_id: string }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) m.set(r.proposal_id, [...(m.get(r.proposal_id) ?? []), r]);
    return m;
  };
  const v = byProposal(versions as { proposal_id: string }[]);
  const s = byProposal(signatures as { proposal_id: string }[]);
  return {
    exportedAt: new Date().toISOString(),
    format: "bridger-proposals-export/1",
    settings,
    clients,
    templates,
    proposals: (proposals as { id: string }[]).map((p) => ({ ...p, versions: v.get(p.id) ?? [], signatures: s.get(p.id) ?? [] })),
    emailLog: emails,
  };
}
