import { hash, verify } from "@node-rs/bcrypt";

/**
 * Password hashing and verification, off the main thread (ADR 0019).
 *
 * `@node-rs/bcrypt` runs bcrypt in Rust on the libuv threadpool, so a burst of
 * logins queues behind four worker threads instead of freezing the event loop
 * the way pure-JS bcryptjs did. The stored format is unchanged ($2a$/$2b$, the
 * cost in the prefix), so existing hashes verify with no migration.
 *
 * Server-only: never import this from client code.
 */

/** Hash `password` at `cost`. The caller passes `PASSWORD_HASH_COST`. */
export async function hashPassword(password: string, cost: number): Promise<string> {
  return hash(password, cost);
}

const INVALID_HASH_ERROR = /invalid\s+(bcrypt\s+)?(hash|salt|prefix|cost|format)/i;

/**
 * Whether `password` matches `storedHash`. The comparison is the binding's own
 * (constant-time over the digest). A stored value the binding rejects as not a bcrypt hash
 * (a corrupt row, a plaintext leftover) is a non-match, not an exception,
 * so a login against it fails the same way a wrong password does. Neither the
 * password nor the hash is ever logged here.
 */
export async function verifyPassword(
  password: string,
  storedHash: string
): Promise<boolean> {
  try {
    return await verify(password, storedHash);
  } catch (error) {
    // Only "this stored value is not a usable bcrypt hash" is a non-match.
    // A binding that fails to load, or anything unexpected, must surface
    // loudly (ADR 0019) instead of turning every login into a wrong password.
    const message = (error as { message?: unknown } | null)?.message;
    if (typeof message === "string" && INVALID_HASH_ERROR.test(message)) {
      return false;
    }
    throw error;
  }
}
