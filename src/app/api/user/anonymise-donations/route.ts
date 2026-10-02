import { NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { anonymiseRegisteredDonor } from '@/lib/donor-anonymisation';
import { refusalResponse } from '@/lib/refusal-response';

/**
 * A registered Donor removes their identity from their own Donations (PRD
 * FFI-16; ticket 36), from account settings. The user is the session's, never
 * a field of the request, so nobody can anonymise someone else's Donations;
 * Admin does not get this power (the ticket does not ask for it).
 *
 * Unlinks the Donations from the account and keeps the account. Idempotent and
 * not undoable.
 */
export async function POST() {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await anonymiseRegisteredDonor(prisma, { userId: session.user.id });
    return NextResponse.json({ status: result.status, anonymisedCount: result.anonymisedCount }, { status: 200 });
  } catch (error) {
    const refusal = refusalResponse(error);
    if (refusal) return refusal;
    console.error('[user/anonymise-donations] failed', error);
    return NextResponse.json({ error: 'Gagal menganonimkan identitas Donor' }, { status: 500 });
  }
}
