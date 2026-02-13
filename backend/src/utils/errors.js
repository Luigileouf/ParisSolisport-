export class AppError extends Error {
  constructor(message, statusCode = 400, code = "BAD_REQUEST", details = undefined) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export function assert(condition, message, statusCode = 400, code = "BAD_REQUEST") {
  if (!condition) {
    throw new AppError(message, statusCode, code);
  }
}
