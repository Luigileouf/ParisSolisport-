import { AppError } from "./errors.js";

export function requireIdempotencyKey(request) {
  const value = request.headers["idempotency-key"];
  if (!value || typeof value !== "string") {
    throw new AppError("Missing Idempotency-Key header", 400, "MISSING_IDEMPOTENCY_KEY");
  }
  return value.trim();
}
