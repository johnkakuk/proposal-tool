# Bridger Digital Proposals

Self-hosted proposal software for Bridger Digital, replacing Prospero. It builds, publishes, tracks, and e-signs client proposals. Claude and ChatGPT can also write and publish proposals directly through an MCP server.

Everything runs on free tiers: Cloudflare Pages + Workers, Supabase, and Resend.

- **Product and technical spec:** [SPEC.md](SPEC.md)
- **Conventions for contributors (and Claude Code):** [CLAUDE.md](CLAUDE.md)
- **What's next:** [docs/ROADMAP.md](docs/ROADMAP.md)

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
| 8 | Polish & deployment docs | ✅ Done |

## Production

Live at **https://proposals.bridgerdigital.com/app** (clients see proposals at `/p/:slug`).

| Piece | Where |
|---|---|
| Web app | Cloudflare Pages project `bridger-proposals-web` |
| API, MCP, tracking, PDFs, cron | Cloudflare Worker `bridger-proposals-api`. It has no public URL; the Pages project forwards `/api`, `/mcp`, `/oauth`, `/.well-known`, and `/t` to it over a service binding. |
| Database, auth, file storage | Supabase project `xqluwzjdxzsabqtyysha` (US West) |
| Email | Resend, sending from `proposals@bridgerdigital.com` |
| DNS | SiteGround (GoDaddy is only the registrar). `proposals` is a CNAME to `bridger-proposals-web.pages.dev`. Resend's records are on `send` and `resend._domainkey`. The website and Microsoft 365 email records are untouched. |

**Pushing to `main` deploys.** [.github/workflows/deploy.yml](.github/workflows/deploy.yml) runs the typecheck and unit tests, then deploys the Worker and the web app, then checks `/api/health`. A failing test stops the release. Watch runs under the repo's **Actions** tab. Database migrations stay manual (`pnpm deploy:db`, run *before* pushing code that needs them), and so do the integration and e2e suites, which need Docker. `pnpm deploy:api` / `deploy:web` still work from a laptop for hotfixes.

First-time setup, secrets (`scripts/set-worker-secrets.sh`), and first-run checks are in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Open items

- Replace the starter templates' placeholder prices with real rates.
- Upload a light version of the logo (Settings → Brand → Light logo). Until then, emails show the main logo on a white plate in the navy header.
- Add writing guidelines (Settings → AI & API) so Claude and ChatGPT match Bridger's tone.
- Turn on "This browser is me" (Settings → Tracking) on each device, so your own views aren't counted.
- Send Supabase login emails (magic links, password resets) through Resend: Supabase → Authentication → Emails → SMTP (see DEPLOYMENT.md §2). Until then, Supabase's built-in mailer only delivers to members of the Supabase organization, so magic links to `john@bridgerdigital.com` may not arrive. Password login works either way.

## Known limits

- The owner's signature is **typed only**; drawing it isn't supported. Clients can type or draw.
- The Worker's `SUPABASE_JWT_SECRET` is a random value, because this Supabase project signs sessions with ES256 (verified via JWKS). HS256 tokens are never accepted.
- Browser Rendering's free tier (10 browser-minutes/day) limits signed-PDF generation. Failures are retried hourly.
- Microsoft 365 DKIM isn't set up for bridgerdigital.com. It predates this project and doesn't affect proposal emails (those are signed by Resend), but setting it up would help regular Outlook mail reach inboxes.

## Stack

- **Web:** React, Vite, Tailwind, TipTap (`apps/web`), deployed to Cloudflare Pages
- **API:** Cloudflare Worker with Hono (`apps/api`), which serves REST, MCP, OAuth, tracking, and cron jobs, reached through the Pages project
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
| `pnpm test:e2e` | Runs Playwright browser tests against the full local stack (starts the dev servers if they aren't running), including an axe accessibility audit (`e2e/a11y.spec.ts`). |
| `pnpm typecheck` | Type-checks every package. |
| `pnpm db:start` / `pnpm db:reset` | Starts local Supabase / re-applies migrations and seeds. |
| `pnpm deploy:db` / `deploy:api` / `deploy:web` / `deploy:all` | Deploys migrations, the Worker, the web app, or all three ([docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)). |
| `pnpm gen:seed` | Regenerates the starter-template seed from `scripts/starter-templates.ts`. |

## Repository layout

```
apps/web          Admin app (/app) and public viewer (/p/:slug)
apps/api          Cloudflare Worker: REST, MCP, OAuth, tracking, cron
packages/shared   Schemas, block registry, pricing engine, hashing
supabase/         Migrations, seeds, database tests
scripts/          Seed generation
```
