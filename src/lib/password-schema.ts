import { z } from "zod";

/**
 * bcrypt only reads the first 72 BYTES of a password; anything after is
 * silently ignored (two long passwords sharing a 72-byte prefix would collide).
 * So the limit is in bytes, not characters (a multibyte character costs 2-4),
 * and an over-long password is rejected rather than truncated without the user
 * knowing. Also bounds the work a single request can hand the hasher.
 */
export const PASSWORD_MAX_BYTES = 72;

export const passwordField = z
  .string()
  .min(8, "Password minimal 8 karakter")
  .refine((value) => Buffer.byteLength(value, "utf8") <= PASSWORD_MAX_BYTES, {
    message: `Password maksimal ${PASSWORD_MAX_BYTES} byte`,
  });
