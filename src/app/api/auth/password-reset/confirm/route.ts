import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { clientAddress } from '@/lib/client-ip';
import { guardRoute } from '@/lib/rate-limit-guard';
import { hashPassword } from '@/lib/password-hash';
import { PASSWORD_HASH_COST } from '@/lib/password-hash-cost';
import { passwordField } from '@/lib/password-schema';
import { verifyPasswordResetToken } from '@/lib/password-reset';

/**
 * Spends a password reset link (rilis-1 93). The signed token is the proof, so
 * no session is needed: the link may be opened on another device. Every token
 * that does not verify (malformed, tampered, expired, already used, for an
 * address the account no longer has) gets the same 400.
 *
 * - **Single use without a table.** The token is bound to the account's
 *   current password hash, and the write below is guarded on that same hash, so
 *   of two concurrent submissions of one link exactly one updates a row.
 * - **The mailed link proves control of the address**, so `emailVerifiedAt` is
 *   set when it is empty (never moved if already set). The token also carries
 *   the address's lookup HMAC, so it proves the address the account has NOW.
 * - **Other sessions end**: the JWT callback in src/lib/auth.ts compares the
 *   password claim a session was issued with against the stored hash.
 * - Nothing here is logged: not the token, the password nor the address.
 */

/** Per client per hour. Fail-open: no mail leaves from here, and a forged token cannot be guessed. */
const CONFIRM_LIMIT = 20;
const CONFIRM_WINDOW_SECONDS = 60 * 60;

const INVALID = 'Tautan tidak valid atau sudah kedaluwarsa. Minta tautan baru dari halaman Lupa Password.';

function invalid() {
  return NextResponse.json({ message: INVALID, error: INVALID }, { status: 400 });
}

export async function POST(request: NextRequest) {
  const refused = await guardRoute(
    {
      scope: 'password-reset-confirm',
      subject: clientAddress(request.headers),
      limit: CONFIRM_LIMIT,
      windowSeconds: CONFIRM_WINDOW_SECONDS,
      onUnavailable: 'open',
    },
    { limited: 'Terlalu banyak percobaan. Coba lagi nanti.' },
  );
  if (refused) return refused;

  let body: { token?: unknown; password?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return invalid();
  }
  if (typeof body !== 'object' || body === null) return invalid();

  const passwordResult = passwordField.safeParse(body.password);
  if (!passwordResult.success) {
    const message = passwordResult.error.issues[0]?.message ?? 'Password tidak valid';
    return NextResponse.json({ message: 'Validasi gagal', errors: { password: message } }, { status: 400 });
  }

  try {
    const account = await verifyPasswordResetToken(body.token);
    if (!account) return invalid();

    const hashed = await hashPassword(passwordResult.data, PASSWORD_HASH_COST);
    const updated = await prisma.user.updateMany({
      // Guarded on the hash and address the token was verified against: a
      // concurrent reset, password change or address change updates nothing.
      where: { id: account.id, password: account.password, emailHmac: account.emailHmac },
      data: { password: hashed, emailVerifiedAt: account.emailVerifiedAt ?? new Date() },
    });
    if (updated.count !== 1) return invalid();

    return NextResponse.json({ message: 'Password berhasil diubah. Silakan masuk dengan password baru.' }, { status: 200 });
  } catch (error) {
    console.error(JSON.stringify({ event: 'password_reset_confirm_failed', error: error instanceof Error ? error.name : 'UnknownError' }));
    return NextResponse.json({ message: 'Terjadi kesalahan server', error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}
