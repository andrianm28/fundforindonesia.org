import { NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth';
import { requestEmailVerification } from '@/lib/email-verification';

/**
 * Sends the signed-in account a link to confirm its own email address
 * (prd-compliance 23). No body is read: there is nowhere to name another
 * address, and the response never reveals whether guest history matches.
 */
export async function POST() {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

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
