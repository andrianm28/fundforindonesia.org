import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { anonymiseGuestDonor } from '@/lib/donor-anonymisation';
import { refusalResponse } from '@/lib/refusal-response';

/**
 * A Guest Donor removes their identity from their Donations (PRD FFI-16;
 * ticket 36), from the link in their Receipt. The token in the URL is the
 * only gate, same as the print page and the resend route: a Guest Donor has no
 * account, and holding the link is proof of the inbox the Receipt went to.
 *
 * A Donation that belongs to an account is not this route's to anonymise: its
 * owner does that from account settings, with a session.
 *
 * Idempotent and not undoable: a repeat answers 200 and changes nothing.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  try {
    const result = await anonymiseGuestDonor(prisma, { token });

    if (result.status === 'not-found') {
      return NextResponse.json({ error: 'Bukti donasi tidak ditemukan' }, { status: 404 });
    }
    if (result.status === 'account-owned') {
      return NextResponse.json(
        { error: 'Donasi ini tercatat pada sebuah akun. Masuk ke akun tersebut lalu anonimkan dari Pengaturan.' },
        { status: 403 },
      );
    }
    return NextResponse.json({ status: result.status, anonymisedCount: result.anonymisedCount }, { status: 200 });
  } catch (error) {
    const refusal = refusalResponse(error);
    if (refusal) return refusal;
    console.error(`[receipts/${token}/anonymise] failed`, error);
    return NextResponse.json({ error: 'Gagal menganonimkan identitas Donor' }, { status: 500 });
  }
}
