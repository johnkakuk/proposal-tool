import { zodIssues } from "@bridger/shared";
import type { Context } from "hono";
import type { z } from "zod";
import { ApiError } from "./errors.js";

export function parseOr422<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const r = schema.safeParse(value);
  if (!r.success) {
    const issues = zodIssues(r.error, value);
    throw new ApiError(422, "invalid_input", issues.map((i) => i.message).join("; "), issues);
  }
  return r.data;
}

export async function body<S extends z.ZodType>(c: Context, schema: S): Promise<z.output<S>> {
  let json: unknown;
  try {
    json = await c.req.json();
  } catch {
    throw new ApiError(400, "invalid_json", "Request body must be JSON");
  }
  return parseOr422(schema, json);
}
