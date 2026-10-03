import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { anonymiseGuestDonor } from '@/lib/donor-anonymisation';
import { clientAddress } from '@/lib/client-ip';
import { consumeRateLimit } from '@/lib/rate-limit';
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
 * Email guesses are rate limited per Receipt token and client address (429).
 *
 * Idempotent and not undoable: a repeat answers 200 and changes nothing.
 */
const RATE_SCOPE = 'receipt-anonymise';
/** Email guesses per Receipt token per client per window: small, since a Donor needs one. */
const ANONYMISE_GUESS_LIMIT = 5;
const ANONYMISE_WINDOW_SECONDS = 60 * 60;

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

  // The link plus a guessed address erases an identity, so guesses are bounded
  // per token and client (stored only as a keyed hash, see rate-limit.ts).
  // Fail-open like the partnership form (PR #161): a store outage must not
  // lock a Donor out of removing their own identity.
  try {
    const attempt = await consumeRateLimit(prisma, {
      scope: RATE_SCOPE,
      subject: `${token}|${clientAddress(request.headers)}`,
      limit: ANONYMISE_GUESS_LIMIT,
      windowSeconds: ANONYMISE_WINDOW_SECONDS,
    });
    if (!attempt.allowed) {
      return NextResponse.json(
        { error: 'Terlalu banyak percobaan. Coba lagi nanti.' },
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
