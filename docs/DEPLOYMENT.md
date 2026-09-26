# Deploying Bridger Digital Proposals

Everything runs on free tiers: Supabase Free, Cloudflare Workers + Pages Free (including Browser Rendering and KV), and Resend Free. Plan on about an hour the first time.

The app lives on one hostname, `proposals.bridgerdigital.com`:

| Path | Served by |
| --- | --- |
| `/api/*`, `/mcp`, `/oauth/*`, `/.well-known/*`, `/t/*` | Worker `bridger-proposals-api`, reached through the Pages project (`apps/web/functions/_middleware.ts` forwards these over a service binding) |
| everything else (`/app`, `/p/:slug`, assets) | Pages project `bridger-proposals-web` |

**DNS stays where it is.** `bridgerdigital.com` DNS is hosted at SiteGround (GoDaddy is the registrar), and the website and Microsoft 365 email are unaffected. You add one CNAME for `proposals` plus Resend's records. The Worker has no public URL of its own (`workers_dev: false`); only the Pages project can reach it.

## 1. Supabase

1. Create a project at [supabase.com](https://supabase.com) (Free). Save the database password.
2. Link and push the schema from the repo root:
   ```sh
   pnpm exec supabase login
   pnpm exec supabase link --project-ref <project-ref>
   pnpm deploy:db          # supabase db push: applies supabase/migrations
   ```
3. Turn off signups and set the login URLs. Either use the dashboard (**Authentication → Sign In / Providers**: turn off "Allow new users to sign up"; **URL Configuration**: Site URL `https://proposals.bridgerdigital.com/app`, Redirect URL `https://proposals.bridgerdigital.com/app/**`), or push just those three settings from a minimal `config.toml` in a scratch folder:
   ```toml
   # <scratch>/supabase/config.toml
   project_id = "bridger-proposals"
   [auth]
   site_url = "https://proposals.bridgerdigital.com/app"
   additional_redirect_urls = ["https://proposals.bridgerdigital.com/app", "https://proposals.bridgerdigital.com/app/**"]
   enable_signup = false
   ```
   Run `supabase config diff --workdir <scratch> --project-ref <ref>` first, then `config push`. Don't push the repo's own `config.toml`, because its URLs are for local dev.
4. **Authentication → Users → Add user → Create new user** (or `POST /auth/v1/admin/users` with the service key): your email and a strong password, with **Auto Confirm** checked. The owner-bootstrap trigger creates your settings row.
5. Load the starter templates with `pnpm exec supabase db query --linked -f supabase/seed/02_starter_templates.sql` (or paste the file into the SQL Editor). It's safe to re-run. Don't run `01_dev_owner.sql` in production.
6. **Project Settings → API Keys**, note:
   - Project URL
   - the publishable (anon) key, for the web build
   - the secret (service_role) key, for the Worker
   - For `SUPABASE_JWT_SECRET`: new projects sign sessions with ES256, which the Worker verifies through the project's JWKS. The secret is only used for HS256 tokens from legacy projects. On a new project, set it to a random string (`openssl rand -base64 48`), which means HS256 tokens are never accepted.

The Free plan pauses projects after a week without activity. The Worker's hourly cron queries the database, so the project stays awake.

## 2. Resend

1. Create an account at [resend.com](https://resend.com) (Free: 3,000 emails/month, 100/day).
2. **Domains → Add domain** `bridgerdigital.com`. Add the records it lists in **SiteGround → Site Tools → Domain → DNS Zone Editor**, then click Verify.
   - Resend's records sit on a `send` subdomain and a `resend._domainkey` DKIM record, so they don't touch the Microsoft 365 MX or SPF records on the root domain. Don't edit those.
3. **API Keys → Create** with "Sending access". Save it.
4. **Recommended:** send Supabase login emails (magic links, password resets) through Resend as well. Supabase's built-in mailer only delivers to members of the Supabase organization and is limited to a few emails an hour. Create a separate Resend key for it, then go to **Supabase → Authentication → Emails → SMTP Settings** and use host `smtp.resend.com`, port 465, user `resend`, and the API key as the password.

`EMAIL_FROM` defaults to `Bridger Digital <proposals@bridgerdigital.com>` and `OWNER_EMAIL` to `john@bridgerdigital.com`. Change both in `apps/api/wrangler.jsonc` under `vars` if needed.

## 3. Cloudflare Worker (API, MCP, tracking, PDFs, cron)

```sh
cd apps/api
pnpm exec wrangler login
pnpm exec wrangler kv namespace create OAUTH_KV
pnpm exec wrangler kv namespace create RATE_KV   # signed-PDF retry counts
```

Paste the two ids into `apps/api/wrangler.jsonc` (production ids are already filled in for Bridger's account).

A new Cloudflare account needs a `workers.dev` subdomain before cron triggers can be saved, even though this Worker doesn't use one. Open **Workers & Pages** in the dashboard once to create it.

Set the secrets with `scripts/set-worker-secrets.sh <supabase-project-ref>`. It pulls the service key from the Supabase CLI, generates the random values, and pipes everything to `wrangler secret bulk` without writing to disk. Add the Resend key later with `--resend`. To set them by hand instead:

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

The first deploy creates the two crons (hourly jobs and the 10:00 UTC nightly job), and the Browser Rendering binding. Browser Rendering's free allowance (10 browser-minutes/day) is plenty for PDFs, and failed renders are retried hourly.

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

`apps/web/wrangler.toml` binds the Pages project to the Worker (`API`). The proxy middleware and the `/p/:slug` link-preview function both use it, so deploy the Worker first. Check that `https://bridger-proposals-web.pages.dev/api/health` returns `{"ok":true,…}`.

Then connect the domain:

1. **Cloudflare → Workers & Pages → bridger-proposals-web → Custom domains → Set up a custom domain:** enter `proposals.bridgerdigital.com`. Cloudflare will show a CNAME to add. Choose the option to configure DNS yourself.
2. **SiteGround → Site Tools → Domain → DNS Zone Editor → CNAME:** name `proposals`, target `bridger-proposals-web.pages.dev`.
3. Back in Cloudflare, wait for the domain to show **Active**. The TLS certificate is issued automatically, usually within 15 minutes.

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

- **Code:** push to `main`. The **Deploy** GitHub Actions workflow (`.github/workflows/deploy.yml`) runs typecheck and unit tests, deploys the Worker, then the web app, then checks `/api/health`. Both deploys are zero-downtime. `pnpm deploy:api` / `deploy:web` still work locally for a hotfix.
- **Schema changes:** add a migration under `supabase/migrations`, run it with `pnpm deploy:db` **before** pushing code that depends on it. The workflow never touches the database.

### One-time: push-to-deploy setup

1. **Cloudflare → My Profile → API Tokens → Create Token → "Edit Cloudflare Workers"** template. Under Account Resources, pick your account. Add the permission **Account → Cloudflare Pages → Edit**. Create it and copy the token.
2. **GitHub → the repo → Settings → Secrets and variables → Actions:**
   - **Secrets** tab: `CLOUDFLARE_API_TOKEN` = the token.
   - **Variables** tab: `CLOUDFLARE_ACCOUNT_ID` = the account ID (`npx wrangler whoami` shows it), `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` = the same values as `apps/web/.env.production.local`.
3. Push (or run the workflow from the Actions tab with **Run workflow**) and watch it go green.
- **Logs:** Workers & Pages → bridger-proposals-api → Logs (observability is on). Emails appear in Resend → Emails and in the app's `email_log` table.

## Free-tier limits worth knowing

| Service | Limit | What happens if you exceed it |
| --- | --- | --- |
| Workers | 100k requests/day | Requests fail until the daily reset |
| Browser Rendering | 10 min/day, 3 concurrent | PDFs queue and are retried hourly |
| KV | 1k writes/day | Only OAuth grants and signed-PDF retries write to KV (a handful a day). Rate limiting uses the Workers Rate Limiting binding, which doesn't touch KV |
| Supabase | 500 MB database, 1 GB storage | Plenty for years of proposals |
| Resend | 100 emails/day, 3,000/month | Sends fail and are logged in `email_log` |
