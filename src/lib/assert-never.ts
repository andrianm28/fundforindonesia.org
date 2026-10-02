/**
 * Closes an exhaustive `switch`: the argument is `never` while every variant is
 * handled, so a variant added later is a compile error at the call site. It
 * throws at runtime for a value that slipped past the types (a JSON body, a
 * cast), using `error` when the caller has a more specific one to refuse with.
 */
export function assertNever(value: never, error?: Error): never {
  throw error ?? new Error(`Unexpected value: ${JSON.stringify(value)}`);
}
