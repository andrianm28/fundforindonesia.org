import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { clientAddress } from '@/lib/client-ip';
import { guardRoute } from '@/lib/rate-limit-guard';
import { lookupUserEmail, readUserEmail, SELECT_USER_EMAIL } from '@/lib/contact-fields';
import { signPasswordResetToken } from '@/lib/password-reset';
import { passwordResetEmail } from '@/lib/mail/password-reset';
import { sendReportingFailure } from '@/lib/mail';
import { publicUrl } from '@/lib/public-url';
import { RESET_REQUESTED_MESSAGE } from '@/lib/password-reset-copy';

/**
 * Asks for a link to set a new password (rilis-1 93). Public, because the
 * person asking cannot sign in.
 *
 * - **No enumeration.** A known and an unknown address get the same status and
 *   body. The mail is sent without waiting for it, so the response does not
 *   take longer for an address that has an account either.
 * - **Counted first.** Per client address and per email lookup key, both
 *   before any lookup or mail. The per-address bucket is keyed on the HMAC of
 *   the typed address, so it counts the same whether or not an account exists,
 *   and a stranger cannot flood one person's inbox.
 * - **Fails closed.** This path sends email, so a limiter outage is a 503
 *   rather than an unbounded stream (src/lib/rate-limit-guard.ts).
 * - **Nothing sensitive is logged.** Not the address, not the token; a mail
 *   that cannot go out is logged by sendReportingFailure under the user's id.
 */
const requestSchema = z.object({ email: z.string().trim().max(254).email() });

/** Per client per hour. */
const CLIENT_LIMIT = 10;
/** Per address per hour. */
const EMAIL_LIMIT = 3;
const WINDOW_SECONDS = 60 * 60;

export async function POST(request: NextRequest) {
  const limited = 'Terlalu banyak permintaan atur ulang password. Coba lagi nanti.';
  const unavailable = 'Layanan sedang tidak dapat memproses permintaan ini. Coba lagi nanti.';

  try {
    const clientRefused = await guardRoute(
      {
        scope: 'password-reset-request',
        subject: clientAddress(request.headers),
        limit: CLIENT_LIMIT,
        windowSeconds: WINDOW_SECONDS,
        onUnavailable: 'closed',
      },
      { limited, unavailable },
    );
    if (clientRefused) return clientRefused;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ message: 'Format email tidak valid', error: 'Format email tidak valid' }, { status: 400 });
    }
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ message: 'Format email tidak valid', error: 'Format email tidak valid' }, { status: 400 });
    }
    const { email } = parsed.data;

    const lookup = lookupUserEmail(email);
    const emailRefused = await guardRoute(
      {
        scope: 'password-reset-request-email',
        subject: lookup.emailHmac,
        limit: EMAIL_LIMIT,
        windowSeconds: WINDOW_SECONDS,
        onUnavailable: 'closed',
      },
      { limited, unavailable },
    );
    if (emailRefused) return emailRefused;

    const account = await prisma.user.findFirst({
      where: lookup,
      select: { id: true, name: true, password: true, emailHmac: true, ...SELECT_USER_EMAIL },
    });
    const to = account ? readUserEmail(account) : null;
    if (account && to) {
      const token = signPasswordResetToken(account, Date.now());
      // Not awaited: see the note on timing above. sendReportingFailure does
      // not throw, and logs a refusal itself; the catch is for a bug in it.
      void sendReportingFailure(
        passwordResetEmail({ to, name: account.name, resetUrl: publicUrl(`/reset-password?token=${token}`) }),
        { mail: 'password_reset', userId: account.id },
      ).catch((error: unknown) => {
        console.error(
          JSON.stringify({ event: 'password_reset_mail_failed', userId: account.id, error: error instanceof Error ? error.name : 'UnknownError' }),
        );
      });
    }

    return NextResponse.json({ message: RESET_REQUESTED_MESSAGE }, { status: 200 });
  } catch (error) {
    console.error(JSON.stringify({ event: 'password_reset_request_failed', error: error instanceof Error ? error.name : 'UnknownError' }));
    return NextResponse.json({ message: 'Terjadi kesalahan server', error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}
