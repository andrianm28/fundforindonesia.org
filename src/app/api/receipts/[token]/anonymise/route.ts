import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { anonymiseGuestDonor } from '@/lib/donor-anonymisation';
import { refusalResponse } from '@/lib/refusal-response';

/**
 * A Guest Donor removes their identity from the Donation of this Receipt (PRD
 * FFI-16; ticket 36; ADR 0023, decision e). The link alone is not enough, as it
 * is for the print page: it must come with the Donation's email address, typed
 * in the request body as `{ "email": "..." }`. The module compares it by HMAC,
 * so a forwarded link cannot erase a Donor's identity. A missing email is a
 * 400; a wrong one is a 403 that does not say whether the address was close.
 *
 * A Donation that belongs to an account is not this route's to anonymise: its
 * owner does that from account settings, with a session.
 *
 * Idempotent and not undoable: a repeat answers 200 and changes nothing.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  let email: unknown;
  try {
    email = ((await request.json()) as { email?: unknown } | null)?.email;
  } catch {
    email = undefined;
  }
  if (typeof email !== 'string' || email.trim() === '') {
    return NextResponse.json({ error: 'Masukkan email yang dipakai pada donasi ini.' }, { status: 400 });
  }

  try {
    const result = await anonymiseGuestDonor(prisma, { token, email });

    if (result.status === 'not-found') {
      return NextResponse.json({ error: 'Bukti donasi tidak ditemukan' }, { status: 404 });
    }
    if (result.status === 'email-mismatch') {
      return NextResponse.json({ error: 'Email tidak cocok dengan donasi ini.' }, { status: 403 });
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
