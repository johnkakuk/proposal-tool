import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { createApp } from "./app.js";
import type { Env } from "./env.js";
import { resolveApiKey } from "./lib/apiKeys.js";
import { serviceClient } from "./lib/supabase.js";
import { mcpHandler, type McpProps } from "./mcp/server.js";
import { handleScheduled } from "./scheduled.js";

const app = createApp();

/**
 * The Worker entry (SPEC §2, §3, §10). The OAuth 2.1 provider wraps everything:
 *  - /.well-known/oauth-authorization-server, /.well-known/oauth-protected-resource
 *  - /oauth/register (dynamic client registration), /oauth/token
 *  - /mcp is protected: OAuth access tokens (Claude.ai, ChatGPT) or, via
 *    resolveExternalToken, `bdp_…` API keys (Claude Code, scripts)
 *  - everything else (REST, public viewer API, tracking, /oauth/authorize) goes to Hono
 */
const provider = new OAuthProvider<Env>({
  apiHandlers: { "/mcp": mcpHandler },
  defaultHandler: { fetch: (request, env, ctx) => app.fetch(request, env, ctx) },
  authorizeEndpoint: "/oauth/authorize",
  tokenEndpoint: "/oauth/token",
  clientRegistrationEndpoint: "/oauth/register",
  scopesSupported: ["proposals"],
  accessTokenTTL: 3600,
  resolveExternalToken: async ({ token, env }) => {
    const key = await resolveApiKey(serviceClient(env), token);
    if (!key) return null;
    const props: McpProps = { ownerId: key.ownerId, clientName: key.name, principal: "api_key" };
    return { props };
  },
});

export default {
  fetch: (request, env, ctx) => provider.fetch(request, env, ctx),
  scheduled(controller, env, ctx) {
    ctx.waitUntil(handleScheduled(controller, env));
  },
} satisfies ExportedHandler<Env>;

export { provider };
