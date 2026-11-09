import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { clientAddress } from '@/lib/client-ip';
import { guardRoute } from '@/lib/rate-limit-guard';
import { currentEmailHmac } from '@/lib/contact-fields';
import { issueLoginCode } from '@/lib/login-code';
import { LOGIN_CODE_REQUESTED_MESSAGE } from '@/lib/login-code-copy';

/**
 * Asks for a sign-in code mailed to an address (login OTP; src/lib/login-code.ts).
 * Public, because the person asking cannot sign in yet.
 *
 * - **No enumeration.** A known and an unknown address, a cooldown and a failed
 *   send all get the same status and body. The issue is not awaited, so the
 *   response does not take longer for an address that has an account.
 * - **Counted first.** Per client and per email lookup key, before any lookup
 *   or mail; the per-address bucket counts the same whether or not an account
 *   exists, so a stranger cannot flood one person's inbox.
 * - **Fails closed.** This path sends email (src/lib/rate-limit-guard.ts).
 */
const requestSchema = z.object({ email: z.string().trim().max(254).email() });

/** Per client per hour. */
const CLIENT_LIMIT = 10;
/** Per address per hour. */
const EMAIL_LIMIT = 5;
const WINDOW_SECONDS = 60 * 60;

export async function POST(request: NextRequest) {
  const limited = 'Terlalu banyak permintaan kode masuk. Coba lagi nanti.';
  const unavailable = 'Layanan sedang tidak dapat memproses permintaan ini. Coba lagi nanti.';
  const invalid = 'Format email tidak valid';

  try {
    const clientRefused = await guardRoute(
      {
        scope: 'login-code-request',
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
      return NextResponse.json({ message: invalid, error: invalid }, { status: 400 });
    }
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ message: invalid, error: invalid }, { status: 400 });
    const { email } = parsed.data;

    const emailRefused = await guardRoute(
      {
        scope: 'login-code-request-email',
        subject: currentEmailHmac(email),
        limit: EMAIL_LIMIT,
        windowSeconds: WINDOW_SECONDS,
        onUnavailable: 'closed',
      },
      { limited, unavailable },
    );
    if (emailRefused) return emailRefused;

    // Not awaited: see the note on timing above. A failure is logged without
    // the address.
    void issueLoginCode(email).catch((error: unknown) => {
      console.error(
        JSON.stringify({ event: 'login_code_issue_failed', error: error instanceof Error ? error.name : 'UnknownError' }),
      );
    });

    return NextResponse.json({ message: LOGIN_CODE_REQUESTED_MESSAGE }, { status: 200 });
  } catch (error) {
    console.error(JSON.stringify({ event: 'login_code_request_failed', error: error instanceof Error ? error.name : 'UnknownError' }));
    return NextResponse.json({ message: 'Terjadi kesalahan server', error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}
