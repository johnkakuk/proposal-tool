import { readFileSync } from "node:fs";
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import {
  AUDIT_EVENT_TYPES,
  BrandSchema,
  CREATED_VIA,
  NotificationPrefsSchema,
  PROPOSAL_STATUSES,
  PricingSchema,
  ProposalContentSchema,
  VERSION_REASONS,
  computePricing,
} from "@bridger/shared";
import { SEED_PATH, buildSeedSql } from "../../scripts/gen-seed-templates.js";
import { asRole, createUser, freshDb, testSlug } from "./harness.js";

const HASH = "a".repeat(64);
const HASH2 = "b".repeat(64);

let db: PGlite;
let owner: string;
let other: string;

beforeAll(async () => {
  db = await freshDb();
  owner = await createUser(db, "john@bridgerdigital.com");
  other = await createUser(db, "intruder@example.com");
});

async function insertProposal(ownerId: string, status = "draft", extra: Record<string, unknown> = {}): Promise<string> {
  const cols = { owner_id: ownerId, slug: testSlug(), title: "Test proposal", status, ...extra };
  const keys = Object.keys(cols);
  const { rows } = await db.query<{ id: string }>(
    `insert into public.proposals (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
    Object.values(cols),
  );
  return rows[0]!.id;
}

async function signedProposal(): Promise<string> {
  const id = await insertProposal(owner, "viewed", { current_version: 1 });
  await db.query(`insert into public.proposal_versions (owner_id, proposal_id, version, content, pricing, content_hash, reason) values ($1, $2, 1, '{}', '{}', $3, 'published')`, [owner, id, HASH]);
  await db.query(`insert into public.proposal_versions (owner_id, proposal_id, version, content, pricing, content_hash, reason) values ($1, $2, 2, '{}', '{}', $3, 'signed')`, [owner, id, HASH]);
  // The signing transaction's UPDATE (unsigned → signed) must be allowed.
  await db.query(`update public.proposals set status = 'signed', signed_at = now(), current_version = 2 where id = $1`, [id]);
  return id;
}

// Certificate IDs are unique in the database; tests get distinct ones from a counter
// (random picks from a small alphabet collided now and then).
const CERT_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
let certCounter = 0;
function nextCertificateId(): string {
  let n = certCounter++;
  let tail = "";
  for (let i = 0; i < 4; i++, n = Math.floor(n / CERT_ALPHABET.length)) tail = CERT_ALPHABET[n % CERT_ALPHABET.length] + tail;
  return `BDP-TEST-${tail}`;
}

async function insertSignature(proposalId: string, certificateId = nextCertificateId()): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.signatures (owner_id, proposal_id, version, signer_name, signer_email, signature_type, signature_text,
       selections, computed_totals, consent_text, consent_given_at, snapshot, document_hash, certificate_id)
     values ($1, $2, 2, 'Jane Client', 'jane@example.com', 'typed', 'Jane Client', '{}', '{}', 'I agree', now(), '{}', $3, $4)
     returning id`,
    [owner, proposalId, HASH, certificateId],
  );
  return rows[0]!.id;
}

const rejects = (p: Promise<unknown>, re: RegExp) => expect(p).rejects.toThrow(re);

describe("schema", () => {
  it("enums match packages/shared exactly", async () => {
    const values = async (type: string) =>
      (await db.query<{ v: string }>(`select unnest(enum_range(null::public.${type}))::text as v`)).rows.map((r) => r.v);
    expect(await values("proposal_status")).toEqual([...PROPOSAL_STATUSES]);
    expect(await values("created_via")).toEqual([...CREATED_VIA]);
    expect(await values("version_reason")).toEqual([...VERSION_REASONS]);
    expect(await values("audit_event_type")).toEqual([...AUDIT_EVENT_TYPES]);
  });

  it("has RLS enabled on every public table", async () => {
    const { rows } = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r'`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(15);
    expect(rows.filter((r) => !r.relrowsecurity).map((r) => r.relname)).toEqual([]);
  });

  it("creates private buckets for signatures and signed PDFs", async () => {
    const { rows } = await db.query<{ id: string; public: boolean }>(`select id, public from storage.buckets order by id`);
    expect(rows).toEqual([
      { id: "assets", public: true },
      { id: "signatures", public: false },
      { id: "signed-pdfs", public: false },
    ]);
  });
});

describe("owner bootstrap and seed", () => {
  it("creating the owner account creates a valid settings row", async () => {
    const { rows } = await db.query<{ brand: unknown; notification_prefs: unknown; default_expiry_days: number; timezone: string; require_signer_email_otp: boolean; ai_can_publish: boolean; ai_can_email_client: boolean }>(
      `select * from public.settings where owner_id = $1`,
      [owner],
    );
    expect(rows).toHaveLength(1);
    const s = rows[0]!;
    expect(BrandSchema.safeParse(s.brand).success).toBe(true);
    expect(NotificationPrefsSchema.safeParse(s.notification_prefs).success).toBe(true);
    expect(s).toMatchObject({ default_expiry_days: 30, timezone: "America/Los_Angeles", require_signer_email_otp: true, ai_can_publish: true, ai_can_email_client: false });
  });

  it("the committed seed SQL is up to date with scripts/starter-templates.ts", () => {
    expect(readFileSync(SEED_PATH, "utf8")).toBe(buildSeedSql());
  });

  it("seed templates load idempotently and pass the shared schemas", async () => {
    const seed = readFileSync(SEED_PATH, "utf8");
    await db.exec(seed);
    await db.exec(seed);
    const { rows } = await db.query<{ name: string; content: unknown; pricing: unknown }>(`select name, content, pricing from public.templates where owner_id = $1 order by name`, [owner]);
    expect(rows.map((r) => r.name)).toEqual(["Authority Engine", "Content War Chest", "Video Production", "Website Build"]);
    for (const r of rows) {
      expect(ProposalContentSchema.safeParse(r.content).success, r.name).toBe(true);
      expect(() => computePricing(PricingSchema.parse(r.pricing)), r.name).not.toThrow();
    }
  });
});

describe("immutability: signed proposals (acceptance: updating a signed proposal in SQL raises)", () => {
  it("rejects any content or metadata change, even as superuser", async () => {
    const id = await signedProposal();
    await rejects(db.query(`update public.proposals set title = 'Hacked' where id = $1`, [id]), /signed and locked/);
    await rejects(db.query(`update public.proposals set content = '{"schemaVersion":1,"blocks":[{"id":"x"}]}' where id = $1`, [id]), /signed and locked/);
    await rejects(db.query(`update public.proposals set pricing = '{}' , status = 'archived' where id = $1`, [id]), /signed and locked/);
    await rejects(db.query(`update public.proposals set signed_at = null, status = 'draft' where id = $1`, [id]), /signed and locked/);
  });

  it("rejects changes as service_role too", async () => {
    const id = await signedProposal();
    await rejects(asRole(db, "service_role", null, (tx) => tx.query(`update public.proposals set title = 'x' where id = $1`, [id])), /signed and locked/);
  });

  it("allows archiving and unarchiving, but archiving doesn't unlock it", async () => {
    const id = await signedProposal();
    await db.query(`update public.proposals set status = 'archived' where id = $1`, [id]);
    await rejects(db.query(`update public.proposals set title = 'x' where id = $1`, [id]), /signed and locked/);
    await rejects(db.query(`update public.proposals set status = 'sent' where id = $1`, [id]), /signed and locked/);
    await db.query(`update public.proposals set status = 'signed' where id = $1`, [id]);
  });

  it("rejects deleting a signed proposal", async () => {
    const id = await signedProposal();
    await rejects(db.query(`delete from public.proposals where id = $1`, [id]), /cannot be deleted/);
  });

  it("leaves unsigned proposals editable", async () => {
    const id = await insertProposal(owner, "draft");
    await db.query(`update public.proposals set title = 'Edited' where id = $1`, [id]);
    const { rows } = await db.query<{ title: string }>(`select title from public.proposals where id = $1`, [id]);
    expect(rows[0]!.title).toBe("Edited");
    await db.query(`delete from public.proposals where id = $1`, [id]);
  });

  it("requires signed_at when status is signed", async () => {
    await rejects(insertProposal(owner, "signed"), /signed_has_signed_at/);
  });
});

describe("immutability: append-only tables", () => {
  it("proposal_versions can't be updated, deleted, or truncated", async () => {
    const id = await signedProposal();
    await rejects(db.query(`update public.proposal_versions set content_hash = $2 where proposal_id = $1`, [id, HASH2]), /immutable/);
    await rejects(db.query(`delete from public.proposal_versions where proposal_id = $1`, [id]), /immutable/);
    await rejects(db.exec(`truncate public.proposal_versions cascade`), /immutable/);
  });

  it("audit_events can't be updated or deleted", async () => {
    const id = await insertProposal(owner);
    await db.query(`insert into public.audit_events (owner_id, proposal_id, event_type, actor) values ($1, $2, 'created', 'ai:Claude')`, [owner, id]);
    await rejects(db.query(`update public.audit_events set actor = 'owner' where proposal_id = $1`, [id]), /immutable/);
    await rejects(db.query(`delete from public.audit_events where proposal_id = $1`, [id]), /immutable/);
  });

  it("audit actor must be owner, client, system, or ai:<client>", async () => {
    const id = await insertProposal(owner);
    await rejects(db.query(`insert into public.audit_events (owner_id, proposal_id, event_type, actor) values ($1, $2, 'created', 'hacker')`, [owner, id]), /check constraint/);
  });

  it("signatures: pdf_path/pdf_hash can be set exactly once; nothing else changes", async () => {
    const sigId = await insertSignature(await signedProposal());
    await rejects(db.query(`update public.signatures set signer_name = 'Someone Else' where id = $1`, [sigId]), /immutable/);
    await rejects(
      db.query(`update public.signatures set pdf_path = 'a.pdf', pdf_hash = $2, signer_name = 'X' where id = $1`, [sigId, HASH]),
      /immutable/,
    );
    await rejects(db.query(`update public.signatures set pdf_path = 'a.pdf' where id = $1`, [sigId]), /immutable/);
    await db.query(`update public.signatures set pdf_path = 'signed/a.pdf', pdf_hash = $2 where id = $1`, [sigId, HASH]);
    await rejects(db.query(`update public.signatures set pdf_path = 'signed/b.pdf', pdf_hash = $2 where id = $1`, [sigId, HASH2]), /immutable/);
    await rejects(db.query(`delete from public.signatures where id = $1`, [sigId]), /immutable/);
  });
});

describe("RLS and grants", () => {
  it("the owner sees only their own proposals", async () => {
    const mine = await insertProposal(owner);
    const theirs = await insertProposal(other);
    const ids = await asRole(db, "authenticated", owner, async (tx) => (await tx.query<{ id: string }>(`select id from public.proposals`)).rows.map((r) => r.id));
    expect(ids).toContain(mine);
    expect(ids).not.toContain(theirs);
  });

  it("the SPA can't write proposals directly (Worker-only)", async () => {
    const mine = await insertProposal(owner);
    await rejects(asRole(db, "authenticated", owner, (tx) => tx.query(`update public.proposals set status = 'signed', signed_at = now() where id = $1`, [mine])), /permission denied/);
    await rejects(
      asRole(db, "authenticated", owner, (tx) => tx.query(`insert into public.proposals (slug, title) values ($1, 'x')`, [testSlug()])),
      /permission denied/,
    );
  });

  it("the SPA can manage its own clients but not someone else's", async () => {
    const count = await asRole(db, "authenticated", owner, async (tx) => {
      await tx.query(`insert into public.clients (name, email) values ('Acme', 'a@acme.test')`);
      return (await tx.query<{ n: number }>(`select count(*)::int as n from public.clients`)).rows[0]!.n;
    });
    expect(count).toBe(1);
    await rejects(
      asRole(db, "authenticated", owner, (tx) => tx.query(`insert into public.clients (owner_id, name) values ($1, 'Spoof')`, [other])),
      /row-level security/,
    );
  });

  it("anon has no table access at all", async () => {
    for (const table of ["proposals", "settings", "clients", "templates", "signatures", "view_sessions", "otp_codes"]) {
      await rejects(asRole(db, "anon", null, (tx) => tx.query(`select 1 from public.${table} limit 1`)), /permission denied/);
    }
  });

  it("authenticated can't touch otp_codes or append to audit_events", async () => {
    const id = await insertProposal(owner);
    await rejects(asRole(db, "authenticated", owner, (tx) => tx.query(`select * from public.otp_codes`)), /permission denied/);
    await rejects(
      asRole(db, "authenticated", owner, (tx) => tx.query(`insert into public.audit_events (owner_id, proposal_id, event_type, actor) values ($1, $2, 'signed', 'client')`, [owner, id])),
      /permission denied/,
    );
  });
});

describe("publish_proposal", () => {
  const publish = async (id: string, expectedUpdatedAt?: string, expiresAt = new Date(Date.now() + 86_400_000).toISOString()) => {
    const updated = expectedUpdatedAt ?? (await db.query<{ u: string }>(`select updated_at::text as u from public.proposals where id = $1`, [id])).rows[0]!.u;
    const { rows } = await db.query<{ v: number }>(`select public.publish_proposal($1, $2, $3::timestamptz, $4, null, $5::timestamptz, 'owner', null, null) as v`, [id, owner, updated, HASH, expiresAt]);
    return rows[0]!.v;
  };
  const row = async (id: string) =>
    (await db.query<{ status: string; current_version: number; sent_at: string | null }>(`select status, current_version, sent_at from public.proposals where id = $1`, [id])).rows[0]!;

  it("snapshots a version, bumps current_version, and moves draft → sent", async () => {
    const id = await insertProposal(owner);
    expect(await publish(id)).toBe(1);
    expect(await row(id)).toMatchObject({ status: "sent", current_version: 1 });
    expect((await row(id)).sent_at).not.toBeNull();
    await db.query(`update public.proposals set title = 'Edited', status = 'viewed' where id = $1`, [id]);
    expect(await publish(id)).toBe(2);
    expect(await row(id)).toMatchObject({ status: "viewed", current_version: 2 });
    const events = await db.query<{ event_type: string }>(`select event_type from public.audit_events where proposal_id = $1 order by occurred_at`, [id]);
    expect(events.rows.map((e) => e.event_type)).toEqual(["published", "published"]);
  });

  it("republishing an expired proposal with a new date extends it", async () => {
    const id = await insertProposal(owner);
    await publish(id);
    await db.query(`update public.proposals set status = 'expired' where id = $1`, [id]);
    await publish(id);
    expect((await row(id)).status).toBe("sent");
    const events = await db.query<{ event_type: string }>(`select event_type from public.audit_events where proposal_id = $1 order by occurred_at, event_type`, [id]);
    expect(events.rows.map((e) => e.event_type)).toContain("extended");
  });

  it("rejects stale callers, past expiry, and signed or archived proposals, leaving no stray versions", async () => {
    const id = await insertProposal(owner);
    await rejects(publish(id, "2000-01-01T00:00:00Z"), /changed while publishing/);
    await rejects(publish(id, undefined, "2000-01-01T00:00:00Z"), /must be in the future/);
    const signed = await signedProposal();
    await rejects(publish(signed), /can't be published/);
    const archived = await insertProposal(owner, "archived");
    await rejects(publish(archived), /can't be published/);
    const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from public.proposal_versions where proposal_id = $1`, [id]);
    expect(rows[0]!.n).toBe(0);
  });

  it("isn't callable by the browser roles", async () => {
    const id = await insertProposal(owner);
    await rejects(
      asRole(db, "authenticated", owner, (tx) => tx.query(`select public.publish_proposal($1, $2, now(), $3, null, now() + interval '1 day', 'owner', null, null)`, [id, owner, HASH])),
      /permission denied/,
    );
  });
});

describe("sign_proposal", () => {
  const sigPayload = (extra: Record<string, unknown> = {}) => ({
    signer_name: "Jane Client",
    signer_email: "jane@example.com",
    signer_title: "Owner",
    signer_company: "Acme",
    signature_type: "typed",
    signature_text: "Jane Client",
    selections: {},
    computed_totals: {},
    consent_text: "I agree",
    signed_at: new Date().toISOString(),
    ip: "203.0.113.9",
    user_agent: "test",
    geo: { country: "US" },
    timezone_offset_minutes: 420,
    snapshot: { hello: "world" },
    document_hash: HASH2,
    certificate_id: nextCertificateId(),
    ...extra,
  });

  async function published(): Promise<string> {
    const id = await insertProposal(owner, "draft", { pricing: { currency: "USD", sections: [], discounts: [] } });
    const upd = (await db.query<{ u: string }>(`select updated_at::text as u from public.proposals where id = $1`, [id])).rows[0]!.u;
    await db.query(`select public.publish_proposal($1, $2, $3::timestamptz, $4, null, now() + interval '7 days', 'owner', null, null)`, [id, owner, upd, HASH]);
    return id;
  }
  const sign = (id: string, version: number, otp: string | null = null, extra = {}) =>
    db.query<{ id: string }>(`select public.sign_proposal($1, $2, $3, $4::jsonb) as id`, [id, version, otp, JSON.stringify(sigPayload(extra))]);

  it("locks the proposal, adds a signed version copied from the published one, and audits", async () => {
    const id = await published();
    const { rows } = await sign(id, 1);
    expect(rows[0]!.id).toMatch(/^[0-9a-f-]{36}$/);
    const p = (await db.query<{ status: string; current_version: number; signed_at: string | null }>(`select status, current_version, signed_at from public.proposals where id = $1`, [id])).rows[0]!;
    expect(p).toMatchObject({ status: "signed", current_version: 2 });
    expect(p.signed_at).not.toBeNull();
    const versions = (await db.query<{ version: number; reason: string; content_hash: string }>(`select version, reason, content_hash from public.proposal_versions where proposal_id = $1 order by version`, [id])).rows;
    expect(versions).toEqual([
      { version: 1, reason: "published", content_hash: HASH },
      { version: 2, reason: "signed", content_hash: HASH },
    ]);
    const s = (await db.query<{ version: number; document_hash: string; email_verified: boolean }>(`select version, document_hash, email_verified from public.signatures where proposal_id = $1`, [id])).rows[0]!;
    expect(s).toEqual({ version: 2, document_hash: HASH2, email_verified: false });
    // Now immutable
    await rejects(db.query(`update public.proposals set title = 'x' where id = $1`, [id]), /signed and locked/);
    await rejects(sign(id, 2), /can no longer be signed/);
  });

  it("rejects a client looking at an old version (409 in the API)", async () => {
    const id = await published();
    await db.query(`update public.proposals set title = 'v2' where id = $1`, [id]);
    const upd = (await db.query<{ u: string }>(`select updated_at::text as u from public.proposals where id = $1`, [id])).rows[0]!.u;
    await db.query(`select public.publish_proposal($1, $2, $3::timestamptz, $4, null, now() + interval '7 days', 'owner', null, null)`, [id, owner, upd, HASH]);
    await expect(sign(id, 1)).rejects.toMatchObject({ code: "40001" });
    await sign(id, 2);
  });

  it("rejects expired proposals and drafts", async () => {
    const id = await published();
    await db.query(`update public.proposals set expires_at = now() - interval '1 minute' where id = $1`, [id]);
    await rejects(sign(id, 1), /expired/);
    const draft = await insertProposal(owner);
    await rejects(sign(draft, 0), /can no longer be signed/);
  });

  it("consumes a verified OTP exactly once", async () => {
    const id = await published();
    const otp = (await db.query<{ id: string }>(`insert into public.otp_codes (proposal_id, email, code_hash, verified_at) values ($1, 'jane@example.com', 'x', now()) returning id`, [id])).rows[0]!.id;
    const unverified = (await db.query<{ id: string }>(`insert into public.otp_codes (proposal_id, email, code_hash) values ($1, 'jane@example.com', 'x') returning id`, [id])).rows[0]!.id;
    await rejects(sign(id, 1, unverified), /verification expired/);
    await sign(id, 1, otp);
    const used = (await db.query<{ used_at: string | null }>(`select used_at from public.otp_codes where id = $1`, [otp])).rows[0]!;
    expect(used.used_at).not.toBeNull();
    expect((await db.query<{ email_verified: boolean }>(`select email_verified from public.signatures where proposal_id = $1`, [id])).rows[0]!.email_verified).toBe(true);
  });
});

describe("purge_proposal", () => {
  const purge = (id: string, ownerId = owner, confirmSigned = false) => db.query<{ bucket: string; path: string }>(`select * from public.purge_proposal($1, $2, $3)`, [id, ownerId, confirmSigned]);

  it("permanently deletes an archived, unsigned proposal with its versions and audit trail", async () => {
    const id = await insertProposal(owner);
    const upd = (await db.query<{ u: string }>(`select updated_at::text as u from public.proposals where id = $1`, [id])).rows[0]!.u;
    await db.query(`select public.publish_proposal($1, $2, $3::timestamptz, $4, null, now() + interval '7 days', 'owner', null, null)`, [id, owner, upd, HASH]);
    const revision = await insertProposal(owner, "draft", { revision_of: id });
    await rejects(purge(id), /Only archived/);
    await db.query(`update public.proposals set status = 'archived' where id = $1`, [id]);
    await purge(id);
    for (const table of ["proposals", "proposal_versions", "audit_events"]) {
      const col = table === "proposals" ? "id" : "proposal_id";
      expect((await db.query<{ n: number }>(`select count(*)::int as n from public.${table} where ${col} = $1`, [id])).rows[0]!.n).toBe(0);
    }
    expect((await db.query<{ revision_of: string | null }>(`select revision_of from public.proposals where id = $1`, [revision])).rows[0]!.revision_of).toBeNull();
  });

  it("deletes a signed proposal only with explicit confirmation, including its signature, and returns its files", async () => {
    const signed = await signedProposal();
    await insertSignature(signed);
    await db.query(`update public.signatures set pdf_path = $2, pdf_hash = $3 where proposal_id = $1`, [signed, `${signed}/signed.pdf`, HASH]);
    await rejects(purge(signed, owner, true), /Only archived/);
    await db.query(`update public.proposals set status = 'archived' where id = $1`, [signed]);
    await rejects(purge(signed), /without explicit confirmation/);
    const files = (await purge(signed, owner, true)).rows;
    expect(files).toContainEqual({ bucket: "signed-pdfs", path: `${signed}/signed.pdf` });
    for (const table of ["proposals", "proposal_versions", "audit_events", "signatures"]) {
      const col = table === "proposals" ? "id" : "proposal_id";
      expect((await db.query<{ n: number }>(`select count(*)::int as n from public.${table} where ${col} = $1`, [signed])).rows[0]!.n).toBe(0);
    }
  });

  it("never deletes signed proposals, other owners' proposals, or anything outside a purge", async () => {
    const signed = await signedProposal();
    await insertSignature(signed);
    await db.query(`update public.proposals set status = 'archived' where id = $1`, [signed]);
    await rejects(purge(signed), /without explicit confirmation/);
    // Signed rows stay undeletable and unchangeable outside a purge, even when archived.
    await rejects(db.query(`delete from public.proposals where id = $1`, [signed]), /signed and cannot be deleted/);
    await rejects(db.query(`delete from public.signatures where proposal_id = $1`, [signed]), /signatures are immutable/);
    await rejects(db.query(`update public.signatures set signer_name = 'x' where proposal_id = $1`, [signed]), /signatures are immutable/);
    const theirs = await insertProposal(other, "archived");
    await rejects(purge(theirs), /not found/);
    // Outside purge_proposal the append-only rules still hold, even for archived rows.
    await db.query(`insert into public.audit_events (owner_id, proposal_id, event_type, actor) values ($1, $2, 'archived', 'owner')`, [owner, signed]);
    await rejects(db.query(`delete from public.audit_events where proposal_id = $1`, [signed]), /immutable/);
    await rejects(db.query(`delete from public.proposal_versions where proposal_id = $1`, [signed]), /immutable/);
    await rejects(
      asRole(db, "authenticated", owner, (tx) => tx.query(`select public.purge_proposal($1, $2, true)`, [theirs, owner])),
      /permission denied/,
    );
  });
});

describe("tracking", () => {
  async function session(proposalId: string, flags: { is_owner?: boolean; is_bot?: boolean } = {}) {
    const { rows } = await db.query<{ id: string }>(
      `insert into public.view_sessions (owner_id, proposal_id, version, visitor_id, device, ip_hash, is_owner, is_bot)
       values ($1, $2, 1, 'v1', 'desktop', $3, $4, $5) returning id`,
      [owner, proposalId, HASH, flags.is_owner ?? false, flags.is_bot ?? false],
    );
    return rows[0]!.id;
  }
  const ingest = (sid: string, blocks: unknown[], points: unknown[], pricing: unknown[], active: number, scroll: number) =>
    db.query<{ active_ms_before: number; active_ms_after: number }>(`select * from public.ingest_tracking($1, $2, $3, $4, $5, $6)`, [
      sid,
      JSON.stringify(blocks),
      JSON.stringify(points),
      JSON.stringify(pricing),
      active,
      scroll,
    ]);

  it("accumulates block time, entries, active time, and max scroll across batches", async () => {
    const pid = await insertProposal(owner, "sent");
    const sid = await session(pid);
    await ingest(sid, [{ blockId: "b1", visibleMsDelta: 2000, entered: true }], [], [], 3000, 40);
    const r = await ingest(sid, [{ blockId: "b1", visibleMsDelta: 1500, entered: true }, { blockId: "b2", visibleMsDelta: 800, entered: true }], [], [], 2500, 30);
    expect(r.rows[0]).toMatchObject({ active_ms_before: 3000, active_ms_after: 5500 });
    const stats = (await db.query<{ block_id: string; visible_ms: number; times_entered: number }>(`select block_id, visible_ms::int, times_entered from public.session_block_stats where session_id = $1 order by block_id`, [sid])).rows;
    expect(stats).toEqual([
      { block_id: "b1", visible_ms: 3500, times_entered: 2 },
      { block_id: "b2", visible_ms: 800, times_entered: 1 },
    ]);
    expect((await db.query<{ max_scroll_pct: number }>(`select max_scroll_pct from public.view_sessions where id = $1`, [sid])).rows[0]!.max_scroll_pct).toBe(40);
  });

  it("caps heatmap points at 3,000 per session, clamps coordinates, records pricing toggles", async () => {
    const pid = await insertProposal(owner, "sent");
    const sid = await session(pid);
    const pts = (n: number) => Array.from({ length: n }, (_, i) => ({ blockId: "b1", kind: "click", x: i % 2 ? 1.7 : -0.2, y: 0.5 }));
    await ingest(sid, [], pts(2500), [{ sectionId: "s", itemId: "i", action: "selected" }], 0, 0);
    await ingest(sid, [], pts(900), [], 0, 0);
    const { rows } = await db.query<{ n: number; minx: number; maxx: number }>(`select count(*)::int as n, min(x_pct) as minx, max(x_pct) as maxx from public.heatmap_points where session_id = $1`, [sid]);
    expect(rows[0]).toEqual({ n: 3000, minx: 0, maxx: 1 });
    expect((await db.query<{ n: number }>(`select count(*)::int as n from public.pricing_interactions where session_id = $1`, [sid])).rows[0]!.n).toBe(1);
  });

  it("stores no events for owner or bot sessions", async () => {
    const pid = await insertProposal(owner, "sent");
    for (const flags of [{ is_owner: true }, { is_bot: true }]) {
      const sid = await session(pid, flags);
      await ingest(sid, [{ blockId: "b1", visibleMsDelta: 5000, entered: true }], [{ blockId: "b1", kind: "click", x: 0.5, y: 0.5 }], [], 9000, 90);
      const counts = await db.query<{ a: number; b: number; ms: number }>(
        `select (select count(*)::int from public.session_block_stats where session_id = $1) as a,
                (select count(*)::int from public.heatmap_points where session_id = $1) as b,
                (select active_ms::int from public.view_sessions where id = $1) as ms`,
        [sid],
      );
      expect(counts.rows[0]).toEqual({ a: 0, b: 0, ms: 0 });
    }
  });

  it("rolls up old points into the grid and reads cells + fresh points together", async () => {
    const pid = await insertProposal(owner, "sent");
    const sid = await session(pid);
    await ingest(sid, [], [{ blockId: "b1", kind: "click", x: 0.51, y: 0.02 }, { blockId: "b1", kind: "click", x: 0.519, y: 0.039 }, { blockId: "b1", kind: "move", x: 0.99, y: 1 }], [], 0, 0);
    await db.query(`update public.heatmap_points set occurred_at = now() - interval '2 days' where session_id = $1`, [sid]);
    await ingest(sid, [], [{ blockId: "b1", kind: "click", x: 0.5, y: 0.0 }], [], 0, 0); // fresh
    await db.query(`select public.rollup_heatmaps()`);
    const cells = (await db.query<{ cell_x: number; cell_y: number; count: number; kind: string }>(`select cell_x, cell_y, count, kind from public.heatmap_cells where proposal_id = $1 order by kind, cell_x`, [pid])).rows;
    expect(cells).toEqual([
      { cell_x: 25, cell_y: 1, count: 2, kind: "click" },
      { cell_x: 49, cell_y: 49, count: 1, kind: "move" },
    ]);
    const grid = (await db.query<{ block_id: string; cell_x: number; cell_y: number; count: number }>(`select block_id, cell_x, cell_y, count::int from public.heatmap_grid($1, 1, 'desktop', array['click']::public.heatmap_kind[]) order by cell_y`, [pid])).rows;
    expect(grid).toEqual([
      { block_id: "b1", cell_x: 25, cell_y: 0, count: 1 },
      { block_id: "b1", cell_x: 25, cell_y: 1, count: 2 },
    ]);
    // Re-running the rollup doesn't double count
    await db.query(`select public.rollup_heatmaps()`);
    expect((await db.query<{ n: number }>(`select sum(count)::int as n from public.heatmap_cells where proposal_id = $1`, [pid])).rows[0]!.n).toBe(3);
    // One session's view uses its raw points
    const one = (await db.query<{ n: number }>(`select sum(count)::int as n from public.heatmap_grid($1, 1, 'desktop', array['click']::public.heatmap_kind[], $2)`, [pid, sid])).rows[0]!.n;
    expect(one).toBe(3);
  });
});
