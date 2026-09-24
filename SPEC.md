# Bridger Proposals — Product & Technical Spec

**Owner:** John (Bridger Digital)
**URL:** `proposals.bridgerdigital.com`
**Purpose:** A self-hosted replacement for Prospero. It builds, publishes, tracks, and e-signs client proposals. AI assistants (Claude, ChatGPT) can write and publish proposals directly through an MCP server.
**Spec version:** 1.0 (2026-09-24)

---

## 0. Instructions for Claude Code

- Build in the phases listed in §14. Stop at the end of each phase and summarize what was built, what's stubbed, and anything that needs John's decision.
- **Everything runs on free tiers.** Do not add paid services or paid plan features. If a feature seems to need one, stop and flag it.
- Write TypeScript everywhere with `strict` on. Every external input (API, MCP, tracking, forms) is validated with Zod schemas from `packages/shared`.
- Money is stored in **integer cents**. Never use floats for money.
- Pricing math lives in **one shared module** that the client and server both use. The server always recomputes totals and never trusts totals sent by the client.
- Signed proposals are immutable. The database enforces this (§6.4), and the app enforces it too.
- Add a `CLAUDE.md` at the repo root that summarizes conventions from this spec as you go.

---

## 1. Scope

### In v1
1. Proposal builder: start from a template, from scratch, or have AI create it through MCP
2. Template library
3. Pricing tables: fixed items, optional add-ons, choose-one packages, discounts (percentage or dollar amount, per line or whole proposal)
4. E-signature done by the book: consent, email verification, frozen snapshot, SHA-256 hash, audit trail, certificate, and a signed PDF. The proposal locks once signed.
5. View tracking: sessions, time on each section, scroll depth
6. Heatmaps (clicks, taps, mouse movement) and an analytics sidebar on each proposal
7. Expiration dates, PDF export, and a unique unguessable link per proposal
8. Email notifications for all important events (this replaces any in-app invoice reminders)
9. MCP server so Claude and ChatGPT can create, edit, publish, and read analytics on proposals
10. REST API underneath the MCP server

### Out of v1 (maybe later)
- Stripe or any payment collection (John invoices manually in QuickBooks)
- QuickBooks integration
- Multiple signers or countersigning workflows (the schema should allow multiple signers later)
- Automated reminder emails to clients
- Team accounts or multiple users (single owner; the schema keeps an `owner_id` so it can grow)
- In-app AI writing with a paid API key (see §15, open questions)

---

## 2. Tech Stack

| Layer | Choice | Notes |
|---|---|---|
| Frontend | React + Vite + TypeScript | Admin app and public viewer in one SPA |
| Styling | Tailwind CSS | Proposal themes come from CSS variables (§5.4) |
| Hosting (web) | **Cloudflare Pages** | Free tier allows commercial use. A Pages Function injects OG meta tags on public links. |
| API / MCP / tracking | **Cloudflare Worker** using Hono | Routed on the same hostname, so there's no CORS |
| Database / Auth / Storage | **Supabase** (Postgres + Auth + Storage) | Proposal content in JSONB columns; audit and analytics in relational tables |
| KV | Cloudflare KV | OAuth token storage for MCP, rate-limit counters |
| Email | **Resend** (free tier) | Sends from `proposals@bridgerdigital.com` (verify the domain in Resend) |
| PDF | Cloudflare Browser Rendering, run from the Worker | Renders the print view to PDF. **Confirm the current free-tier limits before building.** If they're too tight, fall back to `pdf-lib`. |
| Rich text editor | TipTap | Stores content as a limited **Markdown** subset (easy for AI to write) |
| Drag & drop | dnd-kit | Reordering blocks |
| Charts | Recharts | Analytics sidebar |
| Hashing | SHA-256 via Web Crypto; canonical JSON via RFC 8785 (`canonicalize` package) | |
| Testing | Vitest (unit), Playwright (end-to-end) | |

### Routing on `proposals.bridgerdigital.com`
| Path | Served by |
|---|---|
| `/app/*` | Admin SPA (requires login) |
| `/p/:slug` | Public proposal viewer (SPA + Pages Function that adds OG and noindex) |
| `/api/*` | Worker: REST API |
| `/mcp` | Worker: MCP server (Streamable HTTP) |
| `/oauth/*`, `/.well-known/*` | Worker: OAuth 2.1 for MCP clients |
| `/t/*` | Worker: tracking ingest |

Route these paths to the Worker with Cloudflare Worker routes. Everything else goes to Pages.

### Repo layout (pnpm workspaces monorepo)
```
/apps
  /web          React/Vite SPA + /functions (Pages Functions)
  /api          Cloudflare Worker (Hono): REST, MCP, OAuth, tracking, cron
/packages
  /shared       Zod schemas, types, pricing engine, canonical hashing, block registry
/supabase
  /migrations   SQL migrations (tables, RLS, triggers)
  seed.sql      Starter templates + Bridger brand settings
CLAUDE.md
SPEC.md
```

### Environment variables / secrets
- Worker: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `RESEND_API_KEY`, `APP_URL`, `OWNER_EMAIL`, `TRACKING_SALT`, plus KV bindings `OAUTH_KV` and `RATE_KV`, and the Browser Rendering binding
- Web: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
- The service-role key only ever exists in Worker secrets and must never reach the client.

---

## 3. Auth & Access

- **Admin:** Supabase Auth with email + password and magic link. **Turn off public signups.** Create John's account by hand.
- **Public viewer:** no login. Access comes from an unguessable slug (21-character nanoid). The viewer talks only to the Worker, never directly to Supabase.
- **MCP / API clients:**
  - **OAuth 2.1** with Dynamic Client Registration via `@cloudflare/workers-oauth-provider`, backed by KV. The consent screen asks John to log in with Supabase. Claude.ai and ChatGPT custom connectors need this.
  - **Static API keys** (bearer tokens) for Claude Code, scripts, and Zapier. Keys are created in Settings, stored as SHA-256 hashes, shown once, and can be revoked. Each key has a name and a `last_used_at` timestamp.
- **RLS:** turn it on for every table. The admin SPA uses the anon key plus John's JWT, and policies restrict rows to `owner_id = auth.uid()`. The Worker uses the service role only for public, tracking, and signing endpoints, after its own validation.

---

## 4. Core Concepts

- **Proposal:** a JSON document (`content`) plus a pricing object (`pricing`), with metadata and a status.
- **Version:** an immutable snapshot, created every time a proposal is published and again when it's signed.
- **Template:** the same document shape as a proposal, minus client and status. "Save as template" and "New from template" both copy JSON.
- **Session:** one visit to the public viewer.
- **Audit event:** an append-only log entry for every important action.

### Status lifecycle
```
draft → sent → viewed → signed
                  ↘ declined
   (sent|viewed) → expired  (when expires_at passes; John can extend, which returns it to sent/viewed)
   any → archived (manual)
```
- Only `draft` proposals can be edited freely.
- Editing a `sent` or `viewed` proposal and republishing creates a new version. The link stays the same, and the viewer always shows the latest published version.
- `signed` is final. The only way forward is **"Duplicate as new revision"**, which creates a new draft linked through `revision_of`.

---

## 5. Proposal Document Schema

Define everything in `packages/shared` with Zod. Export a JSON Schema version too, because the MCP tool `get_block_schema` returns it.

### 5.1 Top-level
```ts
type ProposalContent = {
  schemaVersion: 1;
  theme?: ThemeOverrides;          // per-proposal overrides of brand theme
  blocks: Block[];
};

type Block = { id: string; type: BlockType; props: Record<string, unknown>; hidden?: boolean };
```
Block IDs are short random strings (nanoid, 10 characters) and **stay stable across edits and versions**. Analytics and heatmaps attach to them.

### 5.2 Block types (v1)
| type | props (summary) |
|---|---|
| `cover` | title, subtitle, clientName, clientLogoUrl?, backgroundImageUrl?, preparedBy, date |
| `heading` | text, level (1–3) |
| `text` | markdown (limited subset: headings, bold, italic, links, lists, blockquote) |
| `image` | url, alt, caption?, width (full / wide / normal) |
| `video` | url (YouTube / Vimeo / Loom), caption? |
| `columns` | columns: 2–3, each column holding a `markdown` string + optional image |
| `deliverables` | title, items: [{ title, description, icon? }] |
| `timeline` | phases: [{ title, duration, description }] |
| `pricing` | pricingSectionIds: string[] (which sections of `pricing` to show here), showTotals: bool |
| `testimonial` | quote, author, role, company, avatarUrl? |
| `case_study` | title, client, challenge, solution, results: string[], imageUrl? |
| `team` | members: [{ name, role, photoUrl, bio? }] |
| `faq` | items: [{ q, a (markdown) }] |
| `terms` | title, markdown |
| `cta` | heading, body, buttonLabel (scrolls to the signature) |
| `divider` | style |
| `page_break` | none (PDF only) |
| `signature` | intro markdown, showOwnerSignature: bool. **There must be exactly one per proposal, and it must be the last block that isn't a divider.** |

Add new block types through a **block registry** (`type → { schema, Editor, Renderer, defaultProps }`) so the editor, renderer, and MCP schema all come from one source.

### 5.3 Pricing object
```ts
type Pricing = {
  currency: "USD";
  sections: PricingSection[];
  discounts: Discount[];            // proposal-level
  taxRatePct?: number;              // default off; display only
  notes?: string;                   // markdown shown under totals
};

type PricingSection = {
  id: string;
  title: string;
  description?: string;
  mode: "fixed" | "optional" | "choose_one";
  // fixed: every item included; optional: client toggles each item;
  // choose_one: radio group (Good / Better / Best packages)
  items: LineItem[];
  discounts: Discount[];            // section-level
};

type LineItem = {
  id: string;
  name: string;
  description?: string;             // markdown
  quantity: number;                 // may be decimal, e.g. 1.5 (hours); stored as number, max 2 decimal places
  unitPriceCents: number;
  unitLabel?: string;               // "hr", "video", "month"
  billing: "one_time" | "monthly" | "quarterly" | "yearly";
  selectedByDefault: boolean;       // for optional/choose_one
  discount?: Discount;              // line-level
};

type Discount = {
  id: string;
  label: string;                    // "Returning client discount"
  type: "percent" | "amount";
  value: number;                    // percent 0–100, or cents
  appliesTo: "one_time" | "recurring" | "all";   // for section/proposal-level
};
```

### Pricing engine rules (`packages/shared/pricing.ts`)
Inputs are `Pricing` plus `selections` (`{ [sectionId]: itemId[] }`). The output has line totals, section totals, and grand totals **split by billing cadence** (one-time, monthly, quarterly, yearly).

1. Line subtotal = `round(quantity × unitPriceCents)`
2. Apply the line discount. A percent discount takes `round(subtotal × pct/100)`. An amount discount can't go below 0.
3. Section subtotal per cadence = sum of the selected lines
4. Apply section discounts to the matching cadence buckets. A percent discount applies to each bucket. An amount discount targeting `all` is split across buckets in proportion to their size; put the rounding remainder on the largest bucket.
5. Apply proposal discounts the same way to the proposal cadence totals.
6. Tax (if set) is applied last and shown on a separate line.
7. Rounding: half-up to whole cents at every step.
8. Show every discount as its own line in the UI and the PDF ("−$500 Returning client discount").

Validation: `choose_one` sections must have exactly one item selected. `fixed` items are always selected. Unknown item IDs are rejected.

**Unit tests are required**, covering: every mode, stacked discounts, amount discounts larger than the subtotal, proportional splits, decimal quantities, and rounding edge cases.

### 5.4 Theme
Brand settings: logo, primary/accent/background/text colors, heading and body fonts (Google Fonts), and the company block (name, address, phone, website). Proposals can override colors, fonts, or add a client logo. The renderer applies all of this through CSS variables.

---

## 6. Database (Supabase / Postgres)

Every table has `id uuid pk default gen_random_uuid()`, `owner_id uuid` (except the analytics child tables), `created_at`, and `updated_at`. Write the SQL migrations in `/supabase/migrations`.

### 6.1 Core tables
**settings** (one row per owner)
- brand jsonb (theme, logo, company info), default_terms_markdown, default_expiry_days (default 30), timezone (default `America/Los_Angeles`), notification_prefs jsonb, owner_signature jsonb (name, title, image path), excluded_ips text[], require_signer_email_otp bool default true, ai_can_publish bool default true, ai_can_email_client bool default false

**clients**
- name, company, email, phone, website, logo_url, notes

**templates**
- name, description, category, content jsonb, pricing jsonb, thumbnail_url

**proposals**
- slug text unique (nanoid 21)
- client_id fk
- title
- status enum (`draft|sent|viewed|signed|declined|expired|archived`)
- content jsonb, pricing jsonb
- current_version int (0 = never published)
- expires_at timestamptz null
- sent_at, first_viewed_at, last_viewed_at, signed_at, declined_at, decline_reason
- created_via enum (`manual|template|mcp|api`), created_via_client text (for example "Claude", "ChatGPT")
- template_id fk null, revision_of fk null
- total_one_time_cents, total_monthly_cents (denormalized, based on default selections, for the dashboard)

**proposal_versions**
- proposal_id, version int, content jsonb, pricing jsonb, content_hash text, created_at, reason enum (`published|signed`)
- unique (proposal_id, version)

**signatures**
- proposal_id, version, signer_name, signer_email, signer_title, signer_company
- signature_type (`typed|drawn`), signature_text, signature_image_path
- selections jsonb, computed_totals jsonb
- consent_text (exact text shown), consent_given_at
- email_verified bool, otp_verified_at
- ip, user_agent, geo (country/region from the `cf` object), timezone offset
- snapshot jsonb (the frozen canonical document: content + pricing + selections + totals + signer info + owner signature)
- document_hash (SHA-256 of the canonical snapshot)
- pdf_path, pdf_hash
- certificate_id (short human-readable ID, for example `BDP-7K3Q-92XD`)

**audit_events** (append-only)
- proposal_id, event_type, occurred_at, actor (`owner|client|ai:<client>|system`), ip, user_agent, metadata jsonb
- Event types: `created, edited, published, link_copied, emailed, viewed, otp_sent, otp_verified, signed, declined, expired, extended, extension_requested, pdf_exported, archived, duplicated`

**api_keys**
- name, key_prefix (first 8 characters, for display), key_hash, last_used_at, revoked_at

**email_log**
- to, template, proposal_id, resend_id, status, sent_at, error

### 6.2 Analytics tables
**view_sessions**
- proposal_id, version, visitor_id (random ID in a first-party cookie), session_start, last_seen_at, active_ms, max_scroll_pct, device (`desktop|tablet|mobile`), viewport_w, viewport_h, browser, os, referrer, country, region, ip_hash (salted SHA-256; never store raw IPs here), is_owner bool, is_bot bool

**session_block_stats**
- session_id, block_id, visible_ms, first_seen_at, times_entered
- unique (session_id, block_id); upserted and incremented as batches arrive

**heatmap_points** (raw, short-lived)
- session_id, proposal_id, version, block_id, kind (`click|tap|move`), x_pct (0–1 across the block's width), y_pct (0–1 down the block's height), device, occurred_at

**heatmap_cells** (aggregated, permanent)
- proposal_id, version, block_id, device, kind, cell_x (0–49), cell_y (0–49), count
- unique (proposal_id, version, block_id, device, kind, cell_x, cell_y)

**pricing_interactions**
- session_id, proposal_id, section_id, item_id, action (`selected|deselected`), occurred_at

**otp_codes**
- proposal_id, email, code_hash, expires_at (10 minutes), attempts, used_at

### 6.3 Indexes
Index `proposals(owner_id, status)`, `proposals(slug)`, `view_sessions(proposal_id, session_start)`, `session_block_stats(session_id)`, `heatmap_points(proposal_id, occurred_at)`, and `audit_events(proposal_id, occurred_at)`.

### 6.4 Immutability triggers (required)
- `proposals`: a BEFORE UPDATE trigger raises an exception if `OLD.status = 'signed'` and anything other than `status → archived` or `updated_at` changes.
- `proposal_versions`, `signatures`, and `audit_events`: BEFORE UPDATE and BEFORE DELETE triggers always raise an exception. Also revoke UPDATE and DELETE from the `authenticated` and `anon` roles.
- Storage: the signed PDF bucket is private. The Worker issues signed URLs.

### 6.5 Retention (runs in a nightly cron)
- Roll `heatmap_points` older than 24 hours into `heatmap_cells`, then delete raw points older than 90 days.
- Delete expired `otp_codes`.
- Cap points per session at 3,000. Drop any extra points before they're inserted.

These keep the database well under the Supabase free-tier size limit.

---

## 7. Screens (Admin SPA, `/app`)

### 7.1 Dashboard
- Pipeline table: title, client, status chip, value (one-time + monthly), sent date, last viewed ("2h ago"), view count, expiry
- Filters: status, client, date range. Search by title or client.
- Stat row: proposals sent (30 days), open rate, win rate, signed value this month (one-time and monthly), average time to sign
- A "New proposal" button opens a choice: **Blank**, **From template**, or **Write with AI** (shows how to connect Claude or ChatGPT, see §10.4)

### 7.2 Proposal editor
- Three panes: block list/outline (left), live canvas (center), block properties (right)
- Add a block from a picker, drag to reorder, duplicate, hide, or delete
- Edit text inline on the canvas with TipTap
- A pricing editor for sections, items, modes, and discounts. Totals update live using the shared engine.
- Preview toggle for desktop and mobile width
- Top bar: title, client picker, expiry date, status, **Save** (autosave with a 1.5 s debounce), **Preview**, **Publish / Update**, **Copy link**, **Send email**, **Export PDF**
- Undo/redo (history kept locally)
- Validation before publishing: exactly one signature block, a client with an email, at least one pricing section, and no empty required props
- Signed proposals open **read-only**, with a banner and a "Duplicate as new revision" button

### 7.3 Proposal detail: analytics sidebar
Open it from the editor or the dashboard. It's a right-hand drawer with tabs:
1. **Overview:** total views, unique viewers, total and average active time, max scroll depth, device split, last seen, current status
2. **Sections:** a bar chart of average visible time per block, labeled with block headings. Highlights blocks that were re-read (times_entered > 1).
3. **Heatmap:** switches the canvas into heatmap mode. Blocks render with a canvas overlay drawn from `heatmap_cells`. Filters: version, device, kind (clicks/moves), session (all or one).
4. **Pricing:** which optional items were toggled on and off, and how often. The last selections before leaving. Choose-one package preferences.
5. **Sessions:** a list of visits (time, duration, device, location, scroll %). Clicking one shows a per-block timeline for that session.
6. **Audit trail:** the full `audit_events` log
7. **Versions:** the version list, with a view of each snapshot (a side-by-side diff is nice-to-have)

Owner sessions and bot sessions never appear in any of these.

### 7.4 Templates
List (grid of thumbnails), create, edit (same editor, with no client or expiry), duplicate, delete. "Save proposal as template" is available from the editor.

### 7.5 Clients
List and detail (contact info plus that client's proposals). Create and edit.

### 7.6 Settings
- Brand & theme (live preview)
- Company info, default terms, default expiry
- Owner signature (typed or drawn), name, and title. It's applied automatically when a proposal is published if the signature block has `showOwnerSignature`.
- Notifications: a toggle for each email type (§9)
- Signing: require email OTP (default on)
- Tracking: excluded IPs, plus a "this browser is me" cookie
- AI & API: connected OAuth clients (with revoke), API keys (create/revoke), `ai_can_publish`, `ai_can_email_client`
- Data export: download all proposals as JSON

---

## 8. Public Viewer (`/p/:slug`)

### 8.1 Rendering
- The Pages Function fetches minimal metadata from the Worker and injects `<title>`, OG tags (title, "Proposal for {client} from Bridger Digital", cover image), `X-Robots-Tag: noindex, nofollow`, and `Referrer-Policy: same-origin`.
- The SPA fetches `GET /api/public/proposals/:slug`. That returns the latest published version (never the draft), the theme, and the owner signature if it's included.
- Layout: responsive, fast, and on-brand, with a sticky mini-header (logo, "Accept proposal" button, running total). The pricing blocks are interactive for `optional` and `choose_one` sections.
- Selections update totals live and are sent to `pricing_interactions`.
- States:
  - **Draft or unpublished:** 404
  - **Expired:** a branded page with a "Request an extension" button, which sends John an email and logs an audit event
  - **Declined:** a message plus a contact link
  - **Signed:** read-only view of the signed snapshot, with the signature, a certificate link, and a signed PDF download
  - **Archived:** 404
- Print view: `/p/:slug?print=1` uses print CSS, honors `page_break` blocks, and has no tracking. The PDF renderer uses it.

### 8.2 Signing flow (by the book)
1. Client clicks **Accept**. The server confirms: the proposal isn't expired, signed, or declined, and the version the client is looking at matches `current_version`. If the version doesn't match, return 409, show "This proposal was updated — please review," and reload.
2. Modal step 1: **full name**, **email** (pre-filled from the client record, editable), **title**, and company (pre-filled). There's also a review list showing the selected options and final totals.
3. Modal step 2: **email verification** (when the setting is on). A 6-digit OTP is emailed. Limits: 5 attempts, 10-minute expiry, and at most 3 sends per 15 minutes.
4. Modal step 3: **signature**, typed (rendered in a script font) or drawn (canvas, saved as PNG). Then a **consent checkbox** with this exact stored text:
   > "By checking this box and clicking 'Sign & Accept', I agree that my electronic signature is the legal equivalent of my handwritten signature, that I am authorized to accept this proposal on behalf of {company}, and that I consent to conducting this transaction and receiving related records electronically. I can download a copy of this proposal and my signature at any time."
5. `POST /api/public/proposals/:slug/sign`. The server, in one transaction:
   - Re-validates status, version, expiry, and OTP
   - Recomputes totals from the selections with the shared engine
   - Builds the snapshot: `{ proposal metadata, content, pricing, selections, totals, signer, ownerSignature, version, signedAt, ip, userAgent, consentText }`
   - Canonicalizes it with RFC 8785, hashes it with SHA-256, and stores it in `signatures`
   - Inserts a `proposal_versions` row (`reason: signed`)
   - Sets the proposal to `status = signed`, `signed_at` (triggers now lock it)
   - Writes the `signed` audit event
6. Background work (`ctx.waitUntil`):
   - Generate the PDF: the proposal render **plus a Certificate of Completion page**. The certificate shows the certificate ID, document hash, signer details, IP, timestamps, and the audit trail (sent, each view, OTP verified, signed).
   - Store the PDF, compute `pdf_hash`, and save it.
   - Email the signed PDF to the signer, and email John the signed notification (§9).
7. Confirmation screen: thank-you message, PDF download (once ready), and the certificate ID.
8. **Verification page** (`/p/:slug/certificate`): shows the certificate details and lets anyone re-hash the stored snapshot to confirm it hasn't changed.

**Decline:** the client clicks "Decline" (a quieter secondary link), optionally gives a reason, and confirms. Status becomes `declined`, an audit event is written, and John gets an email.

---

## 9. Email Notifications (Resend)

Emails are sent from `proposals@bridgerdigital.com` with reply-to set to John's address. Every email is a simple branded HTML template with a plain-text fallback. Log each send to `email_log`. Each type below can be turned off in Settings.

### To John
| Event | Rules |
|---|---|
| **First view** | Sent when the first real (non-owner, non-bot) session reaches 5 s of active time |
| **Return visit** | A view after a gap of 12+ hours. At most 1 email per proposal per 12 hours. |
| **Signed** | Subject: `✅ Signed: {title} — {client}`. Body: signer name/title/email; the selected line items; discounts; totals by cadence; a **"Create invoice in QuickBooks"** checklist line with the one-time total and the recurring amounts; links to the signed PDF and certificate. **This email replaces any in-app invoice reminder.** |
| **Declined** | Includes the reason |
| **Expiring soon** | 3 days before `expires_at`, only if the proposal isn't signed |
| **Expired** | When the cron marks it expired |
| **Extension requested** | From the expired page |
| **AI draft created** | When an MCP client creates a draft (with a link to the editor) |
| **AI published** | When an MCP client publishes (with the link) |
| **Daily digest** (optional, default off) | Views, signings, and expiring proposals in the last 24 hours |

### To the client
| Event | Rules |
|---|---|
| **Proposal sent** | Only when John clicks "Send email", or when an MCP client calls `send_proposal_email` and `ai_can_email_client` is on. Has a custom message field. |
| **OTP code** | For signing |
| **Signed copy** | PDF attached (or linked if it's too large) plus the certificate link |

---

## 10. AI Integration

### 10.1 MCP server
- Endpoint `/mcp` using Streamable HTTP transport, built with the official MCP TypeScript SDK running inside the Worker.
- Auth: OAuth 2.1 (for Claude.ai and ChatGPT connectors) or a bearer API key (for Claude Code).
- Every tool validates its input with the shared Zod schemas and returns **specific, actionable errors** (for example "Block 3 (pricing) references unknown pricing section 'sec_retainer'"), so the model can fix its own mistakes.
- Every mutation writes an audit event with actor `ai:<client name>` and sets `created_via = mcp`.
- **No delete tools.** The AI can archive but never delete.

### 10.2 Tools
| Tool | Purpose |
|---|---|
| `get_workspace_context` | Brand info, company info, default terms, services/pricing catalog (pulled from templates), writing guidelines (a `guidelines_markdown` setting John edits) |
| `get_block_schema` | JSON Schema for `ProposalContent` and `Pricing`, with an example for each block type |
| `list_templates` / `get_template` | Browse and load templates |
| `list_clients` / `get_client` / `create_client` / `update_client` | Client management |
| `list_proposals` | Filter by status, client, or date |
| `get_proposal` | Full JSON plus status and computed totals |
| `create_proposal` | Input: clientId (or inline new client), title, optional templateId, optional full `content`/`pricing`, expiry. Returns the ID, editor URL, and preview URL. Always creates a **draft**. |
| `update_proposal_meta` | Title, client, expiry |
| `replace_content` | Replace all blocks (validated) |
| `insert_block` / `update_block` / `delete_block` / `move_block` | Targeted edits by block ID |
| `set_pricing` | Replace the pricing object. Returns the computed totals so the model can check its math. |
| `get_preview_url` | A signed preview link good for 1 hour (never tracked) |
| `publish_proposal` | Runs the pre-publish validation, then publishes (only if `ai_can_publish` is on). Returns the public link. |
| `send_proposal_email` | Only if `ai_can_email_client` is on. Input: optional custom message. |
| `get_proposal_analytics` | Overview, section times, pricing interactions, session list (summarized, no raw points) |
| `duplicate_proposal` | Optionally for a different client |
| `save_as_template` | Turns a proposal into a template |
| `archive_proposal` | Soft archive |

Editing tools return a clear error on signed proposals. They're locked.

### 10.3 REST API
REST under `/api/v1/*` mirrors the MCP tools one-to-one (same service layer, same validation). Include an OpenAPI 3.1 file (`/api/v1/openapi.json`) so ChatGPT Actions or Zapier can use it too.

### 10.4 "Write with AI" screen in the app
A help page reached from the "New proposal" menu:
- Connection instructions for Claude (custom connector URL) and ChatGPT (connector / developer mode), plus a Claude Code snippet (`claude mcp add ...` with a bearer key)
- A copyable **starter prompt**, for example: "Create a proposal for {client} for a Content War Chest package using the Content War Chest template. Here are my discovery call notes: …"

### 10.5 Service layer
All business logic (create, edit, publish, sign, pricing, validation) lives in `apps/api/src/services/*`. The REST routes, MCP tools, and admin actions all call the same services. There's no duplicated logic.

---

## 11. Tracking & Heatmaps

### 11.1 Client tracker (`apps/web/src/tracking/`)
It's only active on the public viewer. It's off in preview, in print, for owner sessions (owner cookie, or an admin session in the same browser), and when `navigator.webdriver` is set.

- **Session start:** `POST /t/session` returns a session ID. Send it only after the page has been **visible for 3 seconds with JavaScript running**. This filters out email-scanner link checks and link-preview bots, which Gmail, Outlook, and Slack all run.
- **Active time:** counts only while the tab is visible AND there was input (scroll, move, key, touch) in the last 30 seconds.
- **Block visibility:** an IntersectionObserver on each block (threshold 0.5). Visible time accumulates per block only while the session is active.
- **Scroll depth:** the maximum percentage of the document reached.
- **Clicks and taps:** position relative to the block's box → `x_pct`, `y_pct`, `block_id`.
- **Mouse movement:** desktop only, sampled every 150 ms, and only when the cursor has moved more than 20 px.
- **Pricing toggles:** logged as events.
- **Batching:** a queue flushed every 5 seconds to `POST /t/events`, plus a final flush on `visibilitychange: hidden` / `pagehide` using `navigator.sendBeacon`.
- **Payload** (validated by Zod): `{ sessionId, blockStats: [{blockId, visibleMsDelta, entered}], points: [...], pricing: [...], activeMsDelta, maxScrollPct }`

### 11.2 Worker ingest
- Rate limit per IP and per session (KV counters). Reject payloads over 64 KB.
- Detect bots by user agent (a known-bot list plus headless markers) → `is_bot = true`, and never notify on bot sessions.
- Owner detection: excluded IPs, the owner cookie, or a valid admin JWT → `is_owner = true`.
- Upsert `session_block_stats`, insert points (enforcing the per-session cap), and update the session totals.
- Fire notification checks (first view, return visit) with dedup rules.

### 11.3 Heatmap rendering
- Aggregate on read: `heatmap_cells` + raw points from the last 24 hours, bucketed into a 50×50 grid per block.
- Render: a `<canvas>` absolutely positioned over each block, with a radial gradient per cell weighted by count and normalized per block. Color ramp from transparent to blue to yellow to red. Opacity slider.
- Because coordinates are relative to each block, heatmaps stay accurate on different screen sizes and after editing other blocks. **Filter by device**, because mobile and desktop layouts differ.

---

## 12. PDF Export
- **Unsigned** (admin, any time): renders the print view of the current version. The file is named `{Client} - {Title} - v{n}.pdf`.
- **Signed:** generated at signing (§8.2) with the certificate page. Stored permanently; its hash is stored too.
- Rendering: Cloudflare Browser Rendering in the Worker loads `/p/:slug?print=1&token=<short-lived render token>`.
- Fallback if Browser Rendering's free limits are hit: queue the job and retry, and tell John by email if it fails after 3 attempts. If limits are a structural problem, flag it and propose switching to `pdf-lib`.

---

## 13. Scheduled Jobs (Worker cron triggers)
| Schedule | Job |
|---|---|
| Hourly | Mark proposals past `expires_at` as `expired` (with an audit event and email). Send "expiring in 3 days" emails (deduped). |
| Daily 03:00 | **Supabase keep-alive query**, so the free-tier project isn't paused after a week without activity. Also run the heatmap rollup, raw-point cleanup, and OTP cleanup. |
| Daily 07:00 (owner timezone) | Daily digest email (if enabled) |

---

## 14. Build Phases & Acceptance Criteria

### Phase 1: Foundation
- Monorepo, shared Zod schemas, block registry skeleton, pricing engine **with full unit tests**
- Supabase migrations: all tables, RLS, immutability triggers, seed data
- Worker (Hono) with health route; Pages app with Supabase login; routing on one hostname in local dev (`wrangler dev` + Vite proxy)
- ✅ Pricing tests pass. Signing up publicly is impossible. Updating a signed proposal in SQL raises an error.

### Phase 2: Editor, templates, clients
- Dashboard (list only), clients CRUD, templates CRUD
- Block editor with every v1 block type, the pricing editor, autosave, and mobile/desktop preview
- ✅ Can build a complete proposal from blank or from a template, and save it as a template

### Phase 3: Publish & public viewer
- Publish/versioning, slug links, Pages Function OG/noindex, the public renderer, interactive pricing, expired/declined/archived states, the print view
- ✅ Published link works in a private window. Editing and republishing bumps the version. A draft is never visible publicly.

### Phase 4: E-signature
- Signing modal, OTP, consent, the transactional sign endpoint, snapshot + hash, locking, PDF + certificate, verification page, decline flow
- ✅ Playwright end-to-end: publish → open → select options → OTP → sign → the proposal is locked, the PDF exists, and the hash verifies. A stale-version sign returns 409.

### Phase 5: Email
- Resend integration, every template in §9, notification preferences, email_log, and the cron jobs in §13
- ✅ Each email fires once under its rules. The signed email includes the QuickBooks invoice checklist.

### Phase 6: Tracking & analytics
- Tracker, ingest, bot/owner filtering, the analytics sidebar (every tab), heatmap overlay, rollups and retention
- ✅ Owner and bot visits never count. A 3-second-or-shorter bounce doesn't create a session. The heatmap shows clicks in the right spots on desktop and mobile.

### Phase 7: AI (MCP + REST)
- Service-layer refactor check, the REST v1 API + OpenAPI file, the MCP server with every §10.2 tool, OAuth 2.1 + API keys, settings UI, the "Write with AI" page
- ✅ From Claude Code (bearer key) and Claude.ai (OAuth connector): create a proposal from a template with custom pricing, preview it, and publish it. The AI can't edit a signed proposal. Invalid blocks return errors the model can act on.

### Phase 8: Polish
- Dashboard stats, version diff (nice-to-have), data export, empty states, loading and error states, accessibility pass (keyboard, contrast), Lighthouse ≥ 90 on the public viewer
- Deployment docs: Cloudflare Pages project, Worker routes, DNS for `proposals.bridgerdigital.com`, Resend domain verification, Supabase setup

---

## 15. Open Questions for John
1. **In-app AI writing:** should the editor also have a built-in "Generate with AI" button? That needs a paid Anthropic or OpenAI API key (pay per use). The MCP route costs nothing beyond John's existing subscriptions. Default: MCP only for v1.
2. **Client reminders:** automated "your proposal expires soon" emails to clients, or keep follow-ups manual? Default: manual for v1.
3. **Owner timezone:** use Pacific (Seattle) for digests and dates? Default: `America/Los_Angeles`, editable in Settings.
4. **Starter templates:** which packages should be seeded (Content War Chest, Authority Engine, website build, video production)? John to supply pricing and copy, or Claude drafts placeholders.
