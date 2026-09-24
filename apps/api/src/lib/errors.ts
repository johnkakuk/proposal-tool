import type { Issue } from "@bridger/shared";

/** An error with an HTTP status and a stable code, rendered as JSON by the app's error handler. */
export class ApiError extends Error {
  constructor(
    public readonly status: 400 | 401 | 403 | 404 | 409 | 410 | 413 | 422 | 429 | 500 | 503,
    public readonly code: string,
    message: string,
    public readonly issues?: Issue[],
  ) {
    super(message);
    this.name = "ApiError";
  }
}
