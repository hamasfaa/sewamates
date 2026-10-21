export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
// Drizzle wraps driver errors; the PostgreSQL code is on the error or its cause.
export function isUniqueViolation(error: unknown) {
  const value = error as { code?: string; cause?: { code?: string } } | undefined;
  return (value?.code ?? value?.cause?.code) === "23505";
}
export function assert(
  condition: unknown,
  code: string,
  message: string,
  status = 400,
): asserts condition {
  if (!condition) throw new AppError(code, message, status);
}
