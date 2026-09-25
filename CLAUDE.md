# Bridger Proposals: conventions

Self-hosted proposal builder (Prospero replacement) for Bridger Digital. The full spec is in [SPEC.md](SPEC.md). Build in the §14 phases and stop after each one to summarize.

## Hard rules
- **Free tiers only.** No paid services or paid-plan features. If something seems to need one, stop and flag it.
- **TypeScript `strict` everywhere.** Validate every external input (API, MCP, tracking, forms) with Zod schemas from `@bridger/shared`.
- **Money is integer cents.** Never use floats for money. Quantities and percents allow at most 2 decimals and are converted to integer hundredths (`toHundredths`) before any math.
- **Pricing math lives only in `packages/shared/src/pricing.ts`.** The client and server both use it. The server always recomputes and never trusts client totals.
- **Signed proposals are immutable**, enforced by DB triggers (`supabase/migrations/*_immutability.sql`) *and* in app code. The only way forward is "Duplicate as new revision".
- **Service-role key stays in Worker secrets.** It must never reach the browser.
- **The AI never deletes.** MCP tools can archive, not delete.

## Layout
```
apps/web        React + Vite SPA (admin /app/*, public viewer /p/:slug) + /functions (Pages Functions, Phase 3)
apps/api        Cloudflare Worker (Hono): /api/*, /mcp, /oauth/*, /.well-known/*, /t/*, cron
packages/shared Zod schemas, block registry, pricing engine, canonical hashing, ids, validation
supabase/       migrations, seed/, tests/ (PGlite)
scripts/        starter-templates.ts + gen-seed-templates.ts
```
`@bridger/shared` is source-only (`exports` points at `src/index.ts`). Vite, Wrangler, and Vitest bundle it directly, with no build step.

## Data access model
- **Browser:** anon key + John's JWT, limited by RLS to `owner_id = auth.uid()`. It reads settings directly. All writes (proposals, templates, clients) go through the Worker's `/api/v1/*` with the JWT in `Authorization: Bearer`. The only exception is settings, which the Settings screen (Phase 8) may write directly.
- **Worker:** `middleware/auth.ts` verifies Supabase JWTs (JWKS for ES256/RS256; HS256 via `SUPABASE_JWT_SECRET` on legacy projects). Routes validate input with shared Zod schemas (`schemas/api.ts`), then call `apps/api/src/services/*` with a `ServiceContext`. Services use the service role, so **every query must filter by `ownerId`**. REST, MCP, and admin actions share these services, so no logic is duplicated.
- **Autosave** sends `baseUpdatedAt`. The server rejects stale writes with 409 `conflict` and signed proposals with 409 `locked`. `edited` audit events are coalesced to one per 15 minutes.
- **anon role:** no table access. The public viewer only talks to the Worker.
- **Immutable tables:** `proposal_versions`, `audit_events`. `signatures` is immutable except for `pdf_path`/`pdf_hash`, which can be set **once** (from NULL) by the background PDF job. A signed proposal can only toggle `status` between `signed` and `archived`. The lock is keyed on `signed_at`, so archiving doesn't unlock it.

## Editor (apps/web)
- Writing is Markdown-style prose in TipTap (`editor/prose.ts`: the limited subset only). Everything else is an **object** inserted with `/`. Objects all use one generic node (`proposalObject`) with attrs `{blockId, blockType, props, hidden, aux}`.
- `editor/convert.ts` maps stored blocks to and from the editor doc, losslessly (tested). A run of prose becomes one `text` block whose ID is on the run's first node. Headings become `heading` blocks. Hidden prose stays an object.
- **Pricing tables own their sections** in `aux.sections`, so pricing edits are undoable. On save, sections are collected into `pricing.sections`. Proposal-level discounts, tax, and notes live in the sidebar (outside undo).
- `extensions/blockIds.ts` keeps top-level block IDs present and unique. Copies get new IDs plus the block type's `onDuplicate`.
- Block renderers use **container queries** (`@lg:`, `@2xl:`), not viewport breakpoints, so the mobile preview is accurate.
- Effects: always use braces (`useEffect(() => { … })`). Newer browsers return a Promise from `scrollIntoView`, which React treats as a cleanup function.

## Publishing & the public viewer
- **Publish** = `services/publish.ts` → `publish_proposal` RPC (one transaction). It snapshots `{content, pricing}` into `proposal_versions` with a canonical SHA-256 `content_hash`, bumps `current_version`, moves draft → sent, sets expiry (default from settings), and freezes the owner signature into the version. Republishing with no changes is a no-op. The link (slug) never changes.
- `ProposalDetail.has_unpublished_changes` compares the draft's hash to the current version's hash.
- **Public API** (`/api/public/*`, no auth) only ever serves `proposal_versions`, never the working draft. Drafts and archived proposals return 404. State is derived: `signed` > `declined` > `expired` (status or past `expires_at`) > `active`. Expired and declined responses carry no document. Never add private fields (notes, decline reason, audit, emails other than the contact address) to public payloads.
- **Viewer:** `src/public/*`, code-split. It must not import admin pages, TipTap, or the Supabase SDK. `?print=1` is the print/PDF view (no header, no interaction, no tracking).
- **Link previews:** `apps/web/functions/p/[slug].ts` (Pages Function) injects OG tags via the `API` service binding (`apps/web/wrangler.toml`). Tag building is in `src/lib/ogMeta.ts` (escaped, tested). `public/_headers` is the noindex fallback.

## E-signature (SPEC §8.2)
- **Flow:** details + review → email OTP (if `require_signer_email_otp`) → typed/drawn signature + the exact consent text (`consentText()` in shared) → `POST /api/public/proposals/:slug/sign`.
- **`services/signing.ts`:** validates input *before* checking verification. It recomputes totals from the client's selections on the **published** pricing, then builds the `SignatureSnapshot`. The snapshot is RFC 8785 canonical, hashed with SHA-256, and committed via the `sign_proposal` RPC (one transaction: version check → 409 `stale_version`, OTP consumed, `signed` version row, signature row, lock, audit).
- **Snapshot privacy:** raw IP / user agent / geo are *not* in the snapshot, only `evidenceHash`. That lets the public verification page (`/p/:slug/certificate`) serve the full snapshot for in-browser re-hashing with the email masked. Full evidence and the audit trail appear only with a 5-minute render token (the PDF's certificate page). Certificate times are UTC.
- **OTP:** CSPRNG 6-digit, salted hash only, 10 min, 5 attempts, 3 sends/15 min.
- **PDF:** `services/pdf.ts` uses Cloudflare Browser Rendering (`BROWSER` binding; works locally in `wrangler dev`) to load `/p/:slug?print=1&token=…` and waits for `[data-print-ready]`. `pdf_path`/`pdf_hash` are write-once. The first attempt runs in `waitUntil`; the hourly cron retries (max 3, counted in KV), then signed-copy emails go out.
- **Email:** `lib/email.ts` supports `EMAIL_TRANSPORT` = resend (prod) | mailpit (local, http://127.0.0.1:54324, read codes there) | memory (integration tests). Every send is logged to `email_log`.
- **Decline:** status → declined with a private reason (never in public payloads).

## Documents
- `ProposalContent = { schemaVersion: 1, theme?, blocks: Block[] }`. Block IDs are stable (nanoid 10 for new blocks) because analytics and heatmaps attach to them.
- **To add a block/object type** (a developer task, not a user one):
  1. `packages/shared/src/blocks/definitions.ts`: props schema
  2. `packages/shared/src/blocks/registry.ts`: entry (label, AI-facing description, defaults, example, requiredProps) + add to the `BlockSchema` union
  3. `apps/web/src/blocks/<type>.tsx`: a `BlockUI` (slash-menu entry, `Renderer`, `Editor` built from `fields.tsx`; optional `singleton`, `create`, `onDuplicate`)
  4. Register it in `apps/web/src/blocks/index.ts`. The `BlockUIRegistry` type fails until every shared type has UI. It then appears in the `/` menu automatically.
- Validation messages name blocks by position and type ("Block 3 (pricing) references unknown pricing section 'sec_retainer'"), so an AI author can fix its own mistakes. Use `zodIssues()` and `checkPublishable()`.
- Starter templates use `{{client_name}}` and `{{default_terms}}` placeholders, which are substituted when a proposal is created from a template.

## Pricing engine order
line subtotal `round(qty × unit)` → line discount → section subtotal per cadence → section discounts (in array order, on running buckets) → proposal discounts (same) → tax last (display only). Rounding is half-up at every step. An amount discount is capped at its targeted total and split in proportion to bucket size, with the remainder on the largest bucket (ties go to the first in cadence order: one_time, monthly, quarterly, yearly).

## Database
- Migrations live in `supabase/migrations`. SQL enum values are mirrored in `packages/shared/src/schemas/db.ts`, and a test keeps them in sync.
- Creating a user in `auth.users` fires a trigger that creates the settings row with Bridger defaults. Public signups are off (`supabase/config.toml` + dashboard).
- Seeds: `seed/01_dev_owner.sql` (**local only**; dev login `owner@bridger.local` / `bridger-dev-password`) and `seed/02_starter_templates.sql` (generated: edit `scripts/starter-templates.ts`, then run `pnpm gen:seed`. A test fails if it's stale).

## Commands (Node 22: `nvm use`)
```
pnpm install
pnpm test            # vitest: shared, web, api, db (PGlite, no Docker needed)
pnpm test:integration  # Worker routes against local Supabase (needs pnpm db:start)
pnpm test:e2e        # Playwright against the full local stack
pnpm typecheck
pnpm dev             # wrangler dev :8787 + vite :5173 (Vite proxies Worker paths → single origin)
pnpm db:start        # supabase start (needs Docker)
pnpm db:reset        # re-run migrations + seeds locally
pnpm gen:seed
pnpm --filter @bridger/web pages:dev   # build + wrangler pages dev :8788 (tests the Pages Function; needs the API worker running)
```
Local env: `apps/api/.dev.vars` (from `.dev.vars.example`) and `apps/web/.env.local` (from `.env.example`).

## Testing
- Pricing changes need unit tests in `packages/shared/test/pricing.test.ts`.
- DB behavior (triggers, RLS, grants) is tested in `supabase/tests` against the real migrations on PGlite, with a thin Supabase shim (`harness.ts`). Run `supabase db reset` against the real stack before deploying migrations.
- Worker routes are tested with `createApp().request(path, init, env)`. Unit tests live in `apps/api/test`; integration tests in `apps/api/test/integration`.
- Pricing names, section titles, and discount labels may be blank in drafts; `checkPublishable` requires them.
