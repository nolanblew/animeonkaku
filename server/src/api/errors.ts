/** Structured API error → `{ error: { code, message } }` envelope (doc 04). */
export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function errorEnvelope(code: string, message: string) {
  return { error: { code, message } };
}
