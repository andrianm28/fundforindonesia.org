import type { PrismaClient } from '@/generated/prisma/client';
import { hashSubject } from './client-ip';

/**
 * A fixed-window counter in Postgres, shared by every replica (csr-06b). One
 * statement does the work -- INSERT .. ON CONFLICT DO UPDATE .. RETURNING --
 * so two simultaneous requests cannot both read the same count: the row lock
 * the conflict takes serialises them and each gets its own number. Memory in
 * the process would not hold across instances; a read-then-write would race.
 *
 * Built for Partnership Inquiries first, but nothing here is specific to them:
 * the next public endpoint (guest Donation submission) takes a new `scope`.
 * Every attempt counts, allowed or not, so a flood stays refused.
 *
 * Fixed windows: a client can spend its limit at the end of one window and
 * again at the start of the next, so the real burst bound is up to 2x the
 * limit across a window boundary. Acceptable for spam control; a sliding
 * window would cost a read per request.
 */
export type RateLimitInput = {
  scope: string;
  /** Who is being counted, typically an address; stored only as a keyed hash. */
  subject: string;
  limit: number;
  windowSeconds: number;
  now?: Date;
};

export type RateLimitResult = { allowed: boolean; count: number; retryAfterSeconds: number };

const RETENTION_MS = 24 * 60 * 60 * 1000;

export async function consumeRateLimit(prisma: PrismaClient, input: RateLimitInput): Promise<RateLimitResult> {
  const now = input.now ?? new Date();
  const windowMs = input.windowSeconds * 1000;
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  const rows = await prisma.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimitBucket" ("scope", "subjectHash", "windowStart", "count")
    VALUES (${input.scope}, ${hashSubject(input.subject)}, ${windowStart}, 1)
    ON CONFLICT ("scope", "subjectHash", "windowStart")
    DO UPDATE SET "count" = "RateLimitBucket"."count" + 1
    RETURNING "count"`;
  const count = Number(rows[0].count);
  if (count === 1) {
    // A new bucket: the cheap moment to drop this scope's long-past windows.
    // Best-effort: the count is already settled, and a failed cleanup must
    // not turn a counted request into an error. The next new bucket retries.
    try {
      await prisma.$executeRaw`
        DELETE FROM "RateLimitBucket"
        WHERE "scope" = ${input.scope} AND "windowStart" < ${new Date(now.getTime() - RETENTION_MS)}`;
    } catch (error) {
      console.error(
        JSON.stringify({
          event: 'rate_limit_cleanup_failed',
          scope: input.scope,
          error: error instanceof Error ? error.name : 'UnknownError',
        }),
      );
    }
  }
  const retryAfterSeconds = Math.max(1, Math.ceil((windowStart.getTime() + windowMs - now.getTime()) / 1000));
  return { allowed: count <= input.limit, count, retryAfterSeconds };
}
