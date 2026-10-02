/**
 * `process.env` typed as a plain record. `NODE_ENV` is declared read-only on
 * `NodeJS.ProcessEnv`, so a test that needs to set or delete it goes through
 * this view instead of repeating the cast.
 */
export const mutableEnv = process.env as Record<string, string | undefined>;

/** Set `key`, or delete it when `value` is undefined. */
export function setEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete mutableEnv[key];
  else mutableEnv[key] = value;
}
