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

async function insertSignature(proposalId: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.signatures (owner_id, proposal_id, version, signer_name, signer_email, signature_type, signature_text,
       selections, computed_totals, consent_text, consent_given_at, snapshot, document_hash, certificate_id)
     values ($1, $2, 2, 'Jane Client', 'jane@example.com', 'typed', 'Jane Client', '{}', '{}', 'I agree', now(), '{}', $3, 'BDP-7K3Q-92XD')
     returning id`,
    [owner, proposalId, HASH],
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
