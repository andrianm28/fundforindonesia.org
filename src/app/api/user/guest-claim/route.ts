import { NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { consumeRateLimit } from '@/lib/rate-limit';
import { requestGuestClaimLink } from '@/lib/guest-claim-link';

/**
 * Mails the signed-in account a one-use link to claim the Guest Donations made
 * under its own verified address (prd-audit 08). No body is read, and the
 * answer never says whether any Donation matches.
 *
 * Rate limited per account. Unlike the guess limits elsewhere this one fails
 * closed: it bounds outgoing mail, so a store outage must not lift it.
 */
const RATE_SCOPE = 'guest-claim-link';
const REQUEST_LIMIT = 3;
const WINDOW_SECONDS = 60 * 60;

export async function POST() {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const userId = session.user.id;

  try {
    const attempt = await consumeRateLimit(prisma, {
      scope: RATE_SCOPE,
      subject: userId,
      limit: REQUEST_LIMIT,
      windowSeconds: WINDOW_SECONDS,
    });
    if (!attempt.allowed) {
      return NextResponse.json(
        { error: 'Terlalu banyak permintaan. Coba lagi nanti.' },
        { status: 429, headers: { 'Retry-After': String(attempt.retryAfterSeconds) } },
      );
    }
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'rate_limit_unavailable',
        scope: RATE_SCOPE,
        error: error instanceof Error ? error.name : 'UnknownError',
      }),
    );
    return NextResponse.json({ error: 'Layanan sedang sibuk. Coba lagi nanti.' }, { status: 503 });
  }

  const result = await requestGuestClaimLink(userId);
  switch (result.status) {
    case 'sent':
      return NextResponse.json({ sent: true }, { status: 200 });
    case 'unverified':
      return NextResponse.json({ error: 'Konfirmasi email akun Anda terlebih dahulu' }, { status: 403 });
    case 'not-found':
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    case 'send-failed':
      return NextResponse.json({ error: 'Tautan gagal dikirim' }, { status: 502 });
  }
}
