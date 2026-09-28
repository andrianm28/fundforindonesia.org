import { createHash, timingSafeEqual } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { runScheduledJobs } from '@/lib/scheduled-jobs';

// Ticket 45: the production trigger for runScheduledJobs. Before this route
// existed, nothing in the repo called that function -- matured escrow was
// released only when a Fundraiser happened to ask for a Payout, and the two
// reminder sweeps never sent anything at all.
//
// The secret lives only in the production host's .env and, if the owner wires
// a GitHub Actions schedule instead of a host cron, in that repository's
// Actions secrets. It is never in the repo: an unconfigured secret is a
// refusal (see JOBS_SECRET below), never "no auth required".
export const dynamic = 'force-dynamic';

const SECRET_HEADER = 'x-jobs-secret';
const NO_STORE = { 'Cache-Control': 'no-store' };

/**
 * Compares a presented secret against the configured one in constant time.
 *
 * Both sides are hashed to a fixed 32 bytes first, so a presented value of a
 * different length is compared as a whole digest instead of being rejected
 * on length: `timingSafeEqual` throws on buffers of unequal length, and
 * branching on length before comparing would leak the secret's length
 * anyway. The header is attacker-controlled and this route is unauthenticated
 * at the framework level (the proxy matcher does not cover /api/internal),
 * so the comparison itself is the whole access control.
 */
function secretMatches(presented: string, expected: string): boolean {
  const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest();
  return timingSafeEqual(digest(presented), digest(expected));
}

export async function POST(request: NextRequest) {
  const expected = process.env.JOBS_SECRET;

  // Fail closed. An unset secret must never be read as "no secret required":
  // that would put a route which releases money and sends email behind no
  // authentication at all, on a URL anyone can reach.
  if (!expected) {
    console.error('POST /api/internal/jobs/run: JOBS_SECRET is not set; refusing to run the jobs');
    return NextResponse.json({ error: 'Scheduled jobs are not configured.' }, { status: 503, headers: NO_STORE });
  }

  const presented = request.headers.get(SECRET_HEADER);
  if (!presented || !secretMatches(presented, expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE });
  }

  const result = await runScheduledJobs();
  return NextResponse.json({ ok: true, result }, { headers: NO_STORE });
}
