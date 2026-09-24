import { createApp } from "./app.js";
import type { Env } from "./env.js";
import { handleScheduled } from "./scheduled.js";

const app = createApp();

export default {
  fetch: app.fetch,
  scheduled(controller, env, ctx) {
    ctx.waitUntil(handleScheduled(controller, env));
  },
} satisfies ExportedHandler<Env>;
