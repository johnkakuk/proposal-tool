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
- **Browser:** anon key + John's JWT, limited by RLS to `owner_id = auth.uid()`. It reads everything it owns. It writes directly only to `settings`, `clients`, and `templates`.
- **Worker:** all other writes (proposals, versions, signatures, audit, API keys, email log, analytics) go through `apps/api/src/services/*` with the service role. REST, MCP, and admin actions share these services, so no logic is duplicated.
- **anon role:** no table access. The public viewer only talks to the Worker.
- **Immutable tables:** `proposal_versions`, `audit_events`. `signatures` is immutable except for `pdf_path`/`pdf_hash`, which can be set **once** (from NULL) by the background PDF job. A signed proposal can only toggle `status` between `signed` and `archived`. The lock is keyed on `signed_at`, so archiving doesn't unlock it.

## Documents
- `ProposalContent = { schemaVersion: 1, theme?, blocks: Block[] }`. Block IDs are stable (nanoid 10 for new blocks) because analytics and heatmaps attach to them.
- **To add a block type:** props schema in `packages/shared/src/blocks/definitions.ts` → entry in `blocks/registry.ts` (label, AI-facing description, defaults, example, requiredProps) → add it to the `BlockSchema` union → Editor/Renderer in `apps/web/src/blocks/registry.tsx`.
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
pnpm test            # vitest: shared, api, db (PGlite, no Docker needed)
pnpm typecheck
pnpm dev             # wrangler dev :8787 + vite :5173 (Vite proxies Worker paths → single origin)
pnpm db:start        # supabase start (needs Docker)
pnpm db:reset        # re-run migrations + seeds locally
pnpm gen:seed
```
Local env: `apps/api/.dev.vars` (from `.dev.vars.example`) and `apps/web/.env.local` (from `.env.example`).

## Testing
- Pricing changes need unit tests in `packages/shared/test/pricing.test.ts`.
- DB behavior (triggers, RLS, grants) is tested in `supabase/tests` against the real migrations on PGlite, with a thin Supabase shim (`harness.ts`). Run `supabase db reset` against the real stack before deploying migrations.
- Worker routes are tested with `createApp().request(path, init, env)`.
