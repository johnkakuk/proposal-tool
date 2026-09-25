# Bridger Digital Proposals: conventions

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
apps/api        Cloudflare Worker (Hono): /api/*, /mcp, /oauth/*, /.well-known/*, /t/*, cron (reached via the Pages proxy)
packages/shared Zod schemas, block registry, pricing engine, canonical hashing, ids, validation
supabase/       migrations, seed/, tests/ (PGlite)
scripts/        starter-templates.ts + gen-seed-templates.ts
```
`@bridger/shared` is source-only (`exports` points at `src/index.ts`). Vite, Wrangler, and Vitest bundle it directly, with no build step.

## Data access model
- **Browser:** anon key + John's JWT, limited by RLS to `owner_id = auth.uid()`. It reads settings directly. All writes (proposals, templates, clients) go through the Worker's `/api/v1/*` with the JWT in `Authorization: Bearer`. The only exception is settings, which the Settings screen writes directly (brand, defaults, owner signature, signing, notifications, AI, tracking).
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
- Text fields inside objects must use the `fields.tsx` kit (`TextInput`, `TextArea`, `BufferedInput`, `useBufferedText`), never a raw `value`/`onChange` input. Object edits go through a ProseMirror transaction and re-render late, so a directly bound input makes the caret jump to the end on every keystroke.
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

## Email & notifications (SPEC §9, §13)
- **Templates:** `apps/api/src/emails/templates.ts`, one function per email, on a branded table layout (`layout.ts`) with an HTML and a plain-text body. Escape all user content (`e()`/`table()`).
- **`services/notify.ts`** holds the rules:
  - Owner emails go to `OWNER_EMAIL` via `notifyOwner()`, which checks `settings.notification_prefs`. PDF failure always sends.
  - Client emails (proposal sent, OTP, signed copy) always go, with reply-to John.
- **Fire once:** pass a `dedupeKey`. `sendEmail` claims it in `email_log` (unique index) *before* sending; a duplicate returns `{ skipped: true }`. Key patterns: `owner_signed:{sigId}`, `expiring_soon:{id}:{expires_at}` (re-armed by extending), `daily_digest:{owner}:{localDate}`, `return_visit:{id}:{12h window}`, `first_view:{id}`.
- **Cron (hourly):** expire, 3-day reminder, digest (sends only at 07:00 in the owner's timezone, so it's DST-safe), signed-PDF retries. **Daily (10:00 UTC):** keep-alive, OTP cleanup. Each job is isolated with try/catch.
- `onViewActivity()` (first view / return visit) is ready for Phase 6 tracking to call for real sessions only.
- **Settings → Notifications** writes `notification_prefs` directly (RLS).

## Tracking & analytics (SPEC §11, §7.3)
- **Tracker** (`apps/web/src/tracking/tracker.ts`) runs on the public viewer only. It's off in print, under `navigator.webdriver`, and when an admin session exists in localStorage.
  - The session starts after 3 s visible; active time requires input in the last 30 s.
  - Block visibility uses IntersectionObserver ≥50%. Points are block-relative (0–1); mouse movement is desktop-only (150 ms / 20 px).
  - Flushes every 5 s, plus a `sendBeacon` (text/plain) on hide.
- **Ingest** (`/t/session`, `/t/events`, `services/tracking.ts`) caps payloads at 64 KB and rate-limits.
  - Bots: `isBotUserAgent` (shared). Owner: admin-session hint, `settings.excluded_ips`, or the signed HttpOnly `bdp_owner` cookie. Owner/bot sessions are stored flagged but hold **no events** and never touch status or notifications.
  - IPs are only stored as a salted SHA-256; the referrer is reduced to its hostname.
- **DB:** `ingest_tracking` (atomic batch; 3,000 points/session), `rollup_heatmaps` (nightly: >24 h → `heatmap_cells`; raw deleted after 90 d), `heatmap_grid` (cells + fresh raw; bucket via `::numeric` to avoid float edge cases).
- **Analytics** (`services/analytics.ts`) always filters `is_owner = false and is_bot = false`. The drawer can switch the editor canvas to a version render or a heatmap (`VersionCanvas`). The heatmap uses a single warm hue normalized per block, not a rainbow.
- **E2E tracking tests** need a real-looking client: a normal user agent plus an init script that sets `navigator.webdriver` to false. Playwright's default headless UA is (correctly) a bot.

## AI: MCP, OAuth, API keys, REST (SPEC §10)
- **`src/index.ts`:** `OAuthProvider` wraps the Worker.
  - It serves `/.well-known/oauth-*`, `/oauth/register` (dynamic client registration), and `/oauth/token`, and it protects `/mcp`.
  - API keys reach `/mcp` via `resolveExternalToken`.
  - Everything else goes to the Hono app.
- **Consent:** `/oauth/authorize` (routes/oauth.ts) parks the request in `OAUTH_KV` for 10 min and redirects to `/app/connect/:id`. The owner approves via `/api/v1/oauth/consent/:id`, which calls `completeAuthorization` with props `{ ownerId, clientName, principal: "oauth" }`.
- **`middleware/auth.ts` `requireAuth`** accepts three credential types:
  - a Supabase session, which gives `principal: owner`;
  - a `bdp_…` API key (SHA-256 at rest), which gives `api_key` with actor `ai:<key name>`;
  - an OAuth token (`OAUTH_PROVIDER.unwrapToken`), which gives `oauth` with actor `ai:<client>`.

  `requireHuman` guards deletes and credential management.
- **MCP** (`src/mcp/server.ts`): the official SDK with `WebStandardStreamableHTTPServerTransport`, stateless. Tools call the same services as REST v1 (`created_via = mcp`). There are **no delete tools**. Tool inputs are lean (big JSON is `z.any()`) and are validated by the real schemas inside, so errors name blocks and fields.
- **Permissions:** `ai_can_publish` / `ai_can_email_client` are enforced in `publish.ts` / `sendProposal.ts` for automated callers. AI creates and publishes notify John.
- **OpenAPI 3.1** is at `/api/v1/openapi.json`, generated from the shared Zod schemas.
- **Tests:** integration tests run `provider.fetch` in-process with an in-memory KV. `cloudflare:workers` is aliased to a stub, and the OAuth package is inlined in vitest. E2E runs the real runtime via `wrangler dev`. The login helper waits for the persisted Supabase session before any full page load.

## Theming & accessibility
- Brand colors are John's choice, so `themeToCssVars` (shared `schemas/theme.ts`) derives legible text tokens from them (WCAG AA 4.5:1): `--color-on-primary` / `--color-on-accent` for text on fills, `--color-primary-text` / `--color-accent-text` / `--color-accent-on-primary` for colored text, and `--color-muted` for secondary text. **Never put `text-white` on a brand fill or use opacity for secondary text in blocks/public UI**; use the tokens. Emails use `textOn` / `readableOn` the same way.
- Logos: `theme.logoUrl` (main, for light backgrounds) and optional `theme.logoOnDarkUrl`. Always render the owner logo through `pickLogo(theme, surfaceColor)` (web: `<BrandLogo>`), which picks the version for that background and falls back to a contrasting plate.
- Portaled UI (`PublicModal`) sits outside the `ThemeScope` div, so it gets the variables through `useThemeVars()`.
- Admin UI: secondary text is `text-slate-500` minimum (never `-400`). `e2e/a11y.spec.ts` runs axe (WCAG 2.1 A/AA) on the main screens and fails on serious or critical violations.
- Vertical rhythm: `--space-block` (2rem between objects) and `--space-h2` (~50px above H2s) on `.proposal-theme` apply to both the editor canvas and the rendered proposal (`index.css`). Adjust spacing there, not per block.
- Route errors (including stale chunks after a deploy) render `RouteError`.

## Deployment
- **Branches:** work happens on `dev`; merging `dev` into `main` (and pushing) is the release. Pushing `dev` doesn't deploy.
- **Pushing to `main` deploys** via `.github/workflows/deploy.yml` (typecheck + unit tests → Worker → Pages → health check). Don't push unless John approved it. Migrations are never automatic: `pnpm deploy:db` before pushing code that needs them.
- Step by step: `docs/DEPLOYMENT.md`. `pnpm deploy:db` / `deploy:api` / `deploy:web` / `deploy:all`. Don't name a script plain `deploy` at the root, because `pnpm deploy` is a built-in.
- The production web build reads `apps/web/.env.production.local`.
- **The domain's DNS isn't on Cloudflare** (SiteGround DNS, GoDaddy registrar), so there are no Worker routes. `proposals.bridgerdigital.com` is a CNAME to the Pages project. `apps/web/functions/_middleware.ts` forwards `/api`, `/mcp`, `/oauth`, `/.well-known`, `/t` to the Worker over the `API` service binding, and `public/_routes.json` limits Functions to those paths plus `/p/*`. The Worker has `workers_dev: false`.
- Visitor geo: `request.cf` describes the internal hop after the binding, so the proxy sends `X-Bridger-Geo` (always overwritten) and the Worker reads it with `requestGeo()` (`lib/geo.ts`), falling back to `request.cf` in local dev. Add any new Worker path prefix to both `isWorkerPath` and `_routes.json`.

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
