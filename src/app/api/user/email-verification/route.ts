import { NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth';
import { guardRoute } from '@/lib/rate-limit-guard';
import { requestEmailVerification } from '@/lib/email-verification';

/**
 * Sends the signed-in account a link to confirm its own email address
 * (prd-compliance 23). No body is read: there is nowhere to name another
 * address, and the response never reveals whether guest history matches.
 */
/** Per account per hour. */
const RESEND_LIMIT = 5;
const RESEND_WINDOW_SECONDS = 60 * 60;

export async function POST() {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // This path sends email, so the limiter FAILS CLOSED: if the counter
  // cannot be read, no mail goes out (503) rather than an unbounded stream.
  const refused = await guardRoute(
    {
      scope: 'email-verification-resend',
      subject: session.user.id,
      limit: RESEND_LIMIT,
      windowSeconds: RESEND_WINDOW_SECONDS,
      onUnavailable: 'closed',
    },
    { limited: 'Terlalu banyak permintaan tautan konfirmasi. Coba lagi nanti.' },
  );
  if (refused) return refused;

  const result = await requestEmailVerification(session.user.id);
  switch (result.status) {
    case 'sent':
      return NextResponse.json({ sent: true }, { status: 200 });
    case 'already-verified':
      return NextResponse.json({ verified: true }, { status: 200 });
    case 'too-soon':
      return NextResponse.json(
        { error: 'Mohon tunggu sebentar sebelum meminta tautan konfirmasi lagi' },
        { status: 429 },
      );
    case 'not-found':
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    case 'send-failed':
      return NextResponse.json({ error: 'Tautan konfirmasi gagal dikirim' }, { status: 502 });
  }
}
