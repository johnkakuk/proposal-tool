import type { AuditActor, CreatedVia } from "@bridger/shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "../lib/errors.js";

/**
 * Everything a service needs to act on the owner's behalf. `db` is the service-role
 * client, so every query MUST filter by `ownerId`.
 */
export interface ServiceContext {
  db: SupabaseClient;
  ownerId: string;
  actor: AuditActor;
  /** How new proposals are attributed: manual (admin app), mcp, or api. */
  createdVia: Exclude<CreatedVia, "template">;
  /** e.g. "Claude", "ChatGPT" for MCP clients. */
  createdViaClient?: string;
  ip?: string;
  userAgent?: string;
}

interface PgResult<T> {
  data: T | null;
  error: { message: string; code?: string; details?: string | null } | null;
}

/** Unwraps a Supabase result, turning database errors into 500s (details logged, not leaked). */
export function must<T>(res: PgResult<T>, what: string): T {
  if (res.error) {
    // P0001 = raised by our immutability triggers: surface as a conflict, not a crash.
    if (res.error.code === "P0001") throw new ApiError(409, "locked", res.error.message);
    if (res.error.code === "40001") throw new ApiError(409, "conflict", res.error.message);
    if (res.error.code === "P0002") throw new ApiError(404, "not_found", res.error.message);
    console.error(`DB error (${what})`, res.error);
    throw new ApiError(500, "db_error", `Database error while trying to ${what}`);
  }
  return res.data as T;
}

/** Like must(), but a missing row becomes a 404. */
export function found<T>(res: PgResult<T>, what: string, label: string): T {
  const row = must(res, what);
  if (row === null) throw new ApiError(404, "not_found", `${label} not found`);
  return row;
}
