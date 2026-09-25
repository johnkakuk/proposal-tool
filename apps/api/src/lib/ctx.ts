import type { Context } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env.js";
import type { ServiceContext } from "../services/context.js";
import { serviceClient } from "./supabase.js";
import { parseOr422 } from "./validate.js";

/** Builds the service context for an authenticated request. */
export function ctx(c: Context<AppEnv>, createdVia?: ServiceContext["createdVia"]): ServiceContext {
  return {
    db: serviceClient(c.env),
    ownerId: c.get("ownerId"),
    actor: c.get("actor"),
    principal: c.get("principal"),
    createdVia: createdVia ?? c.get("createdVia"),
    createdViaClient: c.get("clientName"),
    ip: c.req.header("CF-Connecting-IP"),
    userAgent: c.req.header("User-Agent"),
  };
}

export const uuidParam = (c: Context<AppEnv>, name = "id") => parseOr422(z.uuid({ message: `Invalid ${name}` }), c.req.param(name));
