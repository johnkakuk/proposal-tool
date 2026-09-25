/**
 * Test-only stand-in for the `cloudflare:workers` module, which exists only in the
 * Workers runtime. The OAuth provider imports WorkerEntrypoint for class-based handlers;
 * this app uses plain object handlers. E2E tests run the real runtime via wrangler dev.
 */
export class WorkerEntrypoint<Env = unknown> {
  constructor(
    public ctx: ExecutionContext,
    public env: Env,
  ) {}
}
