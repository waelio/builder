/**
 * Extracts a message string from a thrown value.
 * Avoids any/unknown leaking into call sites.
 */
export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * Wraps a thrown value as an Error.
 */
export function toError(err: unknown): Error {
  if (err instanceof Error) return err;
  return new Error(String(err));
}
