export { cn } from "cn";

/** Anything thrown, as an `Error`, so its message can be shown. */
export function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
