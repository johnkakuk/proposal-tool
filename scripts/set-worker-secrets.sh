#!/usr/bin/env bash
# Sets the API Worker's production secrets (docs/DEPLOYMENT.md §3) without writing them to disk.
#
#   scripts/set-worker-secrets.sh <supabase-project-ref>              # first time: all secrets
#   scripts/set-worker-secrets.sh <supabase-project-ref> --resend     # later: only RESEND_API_KEY (prompts)
#
# Needs `supabase login` and `wrangler login`. TRACKING_SALT, SIGNING_SECRET, and
# SUPABASE_JWT_SECRET are generated fresh, so re-running the first form rotates them
# (owner cookies and preview links stop working; returning-visitor matching resets).
set -euo pipefail
cd "$(dirname "$0")/.."

REF="${1:?usage: $0 <supabase-project-ref> [--resend]}"

if [[ "${2:-}" == "--resend" ]]; then
  read -rsp "Resend API key: " KEY && echo
  printf '%s' "$KEY" | (cd apps/api && npx wrangler secret put RESEND_API_KEY)
  exit 0
fi

SERVICE_ROLE=$(npx supabase projects api-keys --project-ref "$REF" -o json 2>/dev/null |
  node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const k=JSON.parse(s).find(k=>k.name==="service_role");if(!k)process.exit(1);process.stdout.write(k.api_key)})')

REF="$REF" SERVICE_ROLE="$SERVICE_ROLE" node -e '
  const r = () => require("crypto").randomBytes(48).toString("base64url");
  process.stdout.write(JSON.stringify({
    SUPABASE_URL: `https://${process.env.REF}.supabase.co`,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SERVICE_ROLE,
    SUPABASE_JWT_SECRET: r(), // ES256 projects verify via JWKS; this only gates legacy HS256 tokens
    TRACKING_SALT: r(),
    SIGNING_SECRET: r(),
    RESEND_API_KEY: "pending-resend-setup",
  }));
' | (cd apps/api && npx wrangler secret bulk)

echo "Done. Set the real Resend key later with: $0 $REF --resend"
