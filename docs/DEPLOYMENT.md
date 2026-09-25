# Deploying Bridger Digital Proposals

Everything runs on free tiers: Supabase Free, Cloudflare Workers + Pages Free (including Browser Rendering and KV), and Resend Free. Plan on about an hour the first time.

The app lives on one hostname, `proposals.bridgerdigital.com`:

| Path | Served by |
| --- | --- |
| `/api/*`, `/mcp`, `/oauth/*`, `/.well-known/*`, `/t/*` | Worker `bridger-proposals-api` (routes in `apps/api/wrangler.jsonc`) |
| everything else (`/app`, `/p/:slug`, assets) | Pages project `bridger-proposals-web` |

**Before you start:** the `bridgerdigital.com` DNS zone must be on Cloudflare (free plan is fine). Worker routes only work on zones Cloudflare manages.

## 1. Supabase

1. Create a project at [supabase.com](https://supabase.com) (Free). Save the database password.
2. Link and push the schema from the repo root:
   ```sh
   pnpm exec supabase login
   pnpm exec supabase link --project-ref <project-ref>
   pnpm deploy:db          # supabase db push: applies supabase/migrations
   ```
3. **Authentication → Sign In / Providers:** turn **off** "Allow new users to sign up". Leave Email enabled.
4. **Authentication → URL Configuration:**
   - Site URL: `https://proposals.bridgerdigital.com/app`
   - Redirect URLs: `https://proposals.bridgerdigital.com/app/**`
5. **Authentication → Users → Add user → Create new user:** your email and a strong password, with **Auto Confirm** checked. The owner-bootstrap trigger creates your settings row.
6. **SQL Editor:** paste and run `supabase/seed/02_starter_templates.sql` once to load the starter templates. It's safe to re-run. Don't run `01_dev_owner.sql` in production.
7. **Project Settings → API Keys**, note:
   - Project URL
   - the publishable (anon) key, for the web build
   - the secret (service_role) key, for the Worker
   - **JWT Keys → Legacy JWT secret**. The Worker verifies sessions with the project's JWKS and falls back to this secret.

The Free plan pauses projects after a week without activity. The Worker's hourly cron queries the database, so the project stays awake.

## 2. Resend

1. Create an account at [resend.com](https://resend.com) (Free: 3,000 emails/month, 100/day).
2. **Domains → Add domain** `bridgerdigital.com`. Add the DNS records it lists in Cloudflare DNS, then click Verify.
3. **API Keys → Create** with "Sending access". Save it.
4. Optional: to send Supabase password-reset emails through Resend as well, go to **Supabase → Authentication → Emails → SMTP Settings** and use host `smtp.resend.com`, port 465, user `resend`, and the API key as the password.

`EMAIL_FROM` defaults to `Bridger Digital <proposals@bridgerdigital.com>` and `OWNER_EMAIL` to `john@bridgerdigital.com`. Change both in `apps/api/wrangler.jsonc` under `vars` if needed.

## 3. Cloudflare Worker (API, MCP, tracking, PDFs, cron)

```sh
cd apps/api
pnpm exec wrangler login
pnpm exec wrangler kv namespace create OAUTH_KV
pnpm exec wrangler kv namespace create RATE_KV
```

Paste the two ids into `apps/api/wrangler.jsonc`, replacing `REPLACE_WITH_OAUTH_KV_ID` and `REPLACE_WITH_RATE_KV_ID`. Then set the secrets:

```sh
pnpm exec wrangler secret put SUPABASE_URL               # https://<ref>.supabase.co
pnpm exec wrangler secret put SUPABASE_SERVICE_ROLE_KEY
pnpm exec wrangler secret put SUPABASE_JWT_SECRET
pnpm exec wrangler secret put RESEND_API_KEY
pnpm exec wrangler secret put TRACKING_SALT              # openssl rand -base64 48
pnpm exec wrangler secret put SIGNING_SECRET             # openssl rand -base64 48 (a different value)
```

Keep `TRACKING_SALT` and `SIGNING_SECRET` in a password manager. Changing `SIGNING_SECRET` invalidates owner cookies and preview links. Changing `TRACKING_SALT` breaks returning-visitor matching.

Deploy from the repo root:

```sh
pnpm deploy:api
```

The first deploy creates the routes, the two crons (hourly jobs and the 10:00 UTC nightly job), and the Browser Rendering binding. Browser Rendering's free allowance (10 browser-minutes/day) is plenty for PDFs, and failed renders are retried hourly.

## 4. Cloudflare Pages (web app)

Create `apps/web/.env.production.local` (gitignored):

```sh
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<publishable key>
```

Deploy from the repo root:

```sh
pnpm deploy:web     # builds, then `wrangler pages deploy` (creates the project the first time)
```

`apps/web/wrangler.toml` also binds the Pages project to the Worker (`API`), which the `/p/:slug` function uses for link-preview metadata. Deploy the Worker first so the binding resolves.

Then, in the Cloudflare dashboard: **Workers & Pages → bridger-proposals-web → Custom domains →** add `proposals.bridgerdigital.com`. Cloudflare creates the DNS record.

`pnpm deploy:all` runs migrations, the Worker, and Pages in that order for later releases.

## 5. First-run checks

1. Open `https://proposals.bridgerdigital.com/app` and sign in.
2. **Settings:** upload the logo, set colors and fonts, company info, default terms, timezone, and your typed signature. Turn on the email code for signers if you want it.
3. **Settings → Tracking:** turn on "This browser is me" on each browser and device you use, so your own views aren't counted.
4. Create a test client with your own email address, make a proposal from a template, **Publish**, then **Send**. Confirm that:
   - the email arrives from Resend
   - the link opens with its title in the preview card (paste it in iMessage or Slack)
   - viewing it from a private window shows up in analytics, and viewing it signed in doesn't
   - signing it produces the signed PDF and certificate, and both emails arrive
5. **AI connectors** (Settings → AI & API → "Connect an app" has both URLs with copy buttons):
   - **Claude.ai:** Settings → Connectors → Add custom connector → `https://proposals.bridgerdigital.com/mcp`. Approve on the consent screen.
   - **ChatGPT:** Settings → Connectors (developer mode) → add the same MCP URL. For a Custom GPT, add an Action that imports `https://proposals.bridgerdigital.com/api/v1/openapi.json` and uses an API key from Settings as the Bearer token.
   - Ask each one to "create a draft proposal for a test client from the Website Build template". It should appear in your dashboard as a draft.
6. Archive or hard-delete the test proposal from its ⋮ menu.

## Updating

- **Schema changes:** add a migration under `supabase/migrations`, then `pnpm deploy:db`.
- **Code:** `pnpm deploy:api` and/or `pnpm deploy:web`. Both are zero-downtime.
- **Logs:** Workers & Pages → bridger-proposals-api → Logs (observability is on). Emails appear in Resend → Emails and in the app's `email_log` table.

## Free-tier limits worth knowing

| Service | Limit | What happens if you exceed it |
| --- | --- | --- |
| Workers | 100k requests/day | Requests fail until the daily reset |
| Browser Rendering | 10 min/day, 3 concurrent | PDFs queue and are retried hourly |
| KV | 1k writes/day | Rate limiting and OAuth use very few writes |
| Supabase | 500 MB database, 1 GB storage | Plenty for years of proposals |
| Resend | 100 emails/day, 3,000/month | Sends fail and are logged in `email_log` |
