# Bridger Digital Proposals

Self-hosted proposal software for Bridger Digital, replacing Prospero. It builds, publishes, tracks, and e-signs client proposals. Claude and ChatGPT can also write and publish proposals directly through an MCP server.

Everything runs on free tiers: Cloudflare Pages + Workers, Supabase, and Resend.

- **Product and technical spec:** [SPEC.md](SPEC.md)
- **Conventions for contributors (and Claude Code):** [CLAUDE.md](CLAUDE.md)

## Status

| Phase | Scope | State |
|---|---|---|
| 1 | Foundation: monorepo, schemas, pricing engine, database, Worker, login | ✅ Done |
| 2 | Editor, templates, clients | ✅ Done |
| 3 | Publish & public viewer | ✅ Done |
| 4 | E-signature | ✅ Done |
| 5 | Email | ✅ Done |
| 6 | Tracking & analytics | ✅ Done |
| 7 | AI (MCP + REST) | ✅ Done |
| 8 | Polish & deployment docs | — |

## Stack

- **Web:** React, Vite, Tailwind, TipTap (`apps/web`), deployed to Cloudflare Pages
- **API:** Cloudflare Worker with Hono (`apps/api`), which serves REST, MCP, OAuth, tracking, and cron jobs
- **Database, auth, storage:** Supabase (`supabase/`)
- **Shared code:** Zod schemas, block registry, and pricing engine (`packages/shared`)

## Getting started

Requirements: Node 22 (`nvm use`), pnpm, and Docker (for local Supabase).

```sh
pnpm install
pnpm db:start                     # starts local Supabase in Docker; prints URLs and keys
cp apps/api/.dev.vars.example apps/api/.dev.vars    # fill in from `supabase status`
cp apps/web/.env.example apps/web/.env.local        # fill in from `supabase status`
pnpm db:reset                     # applies migrations and seeds
pnpm dev                          # Worker on :8787, app on http://localhost:5173/app
```

Local login: `owner@bridger.local` / `bridger-dev-password`. All local email (magic links, signing codes, signed copies) lands in Mailpit at http://127.0.0.1:54324.

## Writing proposals

Type into the document the way you'd write Markdown: `## ` makes a heading, `- ` a list, `**bold**`, `> ` a quote. Type `/` to insert an object: a pricing table, deliverables, timeline, testimonial, case study, FAQ, terms, a call to action, the signature block, and more. Use ↑/↓ and Enter to pick from the menu. Click an object (or select it and press Enter) to edit it in place, and press Esc when done. Changes autosave.

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Runs the Worker and the Vite dev server together. Vite proxies `/api`, `/mcp`, `/oauth`, `/.well-known`, and `/t` to the Worker, so the app runs on one origin. |
| `pnpm test` | Runs all unit and database tests. The database tests use PGlite and don't need Docker. |
| `pnpm test:integration` | Runs Worker API tests against the local Supabase stack. |
| `pnpm test:e2e` | Runs Playwright browser tests against the full local stack (starts the dev servers if they aren't running). |
| `pnpm typecheck` | Type-checks every package. |
| `pnpm db:start` / `pnpm db:reset` | Starts local Supabase / re-applies migrations and seeds. |
| `pnpm gen:seed` | Regenerates the starter-template seed from `scripts/starter-templates.ts`. |

## Repository layout

```
apps/web          Admin app (/app) and public viewer (/p/:slug)
apps/api          Cloudflare Worker: REST, MCP, OAuth, tracking, cron
packages/shared   Schemas, block registry, pricing engine, hashing
supabase/         Migrations, seeds, database tests
scripts/          Seed generation
```
