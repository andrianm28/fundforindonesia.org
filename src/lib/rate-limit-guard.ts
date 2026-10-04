import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { consumeRateLimit, type RateLimitInput } from '@/lib/rate-limit';

/**
 * The route-side half of the rate limit (csr-06b, ticket rilis-1-benda 58):
 * counts one attempt and says whether to go on. The policy when the limiter
 * itself is down is chosen per endpoint:
 *
 * - `open`: serve the request. For spam control and for paths where refusing
 *   would lock a person out (login, register, donation, upload).
 * - `closed`: refuse with 503. For paths that send email, where a limiter
 *   outage must not become an open mail relay.
 *
 * Failures are logged by class only: no address, no subject.
 */
export type GuardInput = RateLimitInput & { onUnavailable: 'open' | 'closed' };

export type GuardResult =
  | { ok: true }
  | { ok: false; reason: 'limited'; retryAfterSeconds: number }
  | { ok: false; reason: 'unavailable' };

export async function checkRateLimit(input: GuardInput): Promise<GuardResult> {
  const { onUnavailable, ...limit } = input;
  try {
    const result = await consumeRateLimit(prisma, limit);
    if (result.allowed) return { ok: true };
    return { ok: false, reason: 'limited', retryAfterSeconds: result.retryAfterSeconds };
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'rate_limit_unavailable',
        scope: input.scope,
        policy: onUnavailable,
        error: error instanceof Error ? error.name : 'UnknownError',
      }),
    );
    return onUnavailable === 'open' ? { ok: true } : { ok: false, reason: 'unavailable' };
  }
}

/** A refusal response for a failed check, or null when the request may proceed. */
export async function guardRoute(
  input: GuardInput,
  messages: { limited: string; unavailable?: string },
): Promise<NextResponse | null> {
  const result = await checkRateLimit(input);
  if (result.ok) return null;
  if (result.reason === 'limited') {
    return NextResponse.json(
      { error: messages.limited, message: messages.limited },
      { status: 429, headers: { 'Retry-After': String(result.retryAfterSeconds) } },
    );
  }
  const unavailable = messages.unavailable ?? 'Layanan sedang tidak dapat memproses permintaan ini. Coba lagi nanti.';
  return NextResponse.json({ error: unavailable, message: unavailable }, { status: 503 });
}
