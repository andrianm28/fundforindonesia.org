import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { stopRecurringDonationByToken } from '@/lib/recurring-donations/service';
import { recurringStopPath } from '@/lib/recurring-donations/stop-token';

export const dynamic = 'force-dynamic';

/**
 * Stops a recurring donation through the signed link in its bill email (PKS
 * pasal 4.7), with no login: the token, bound to the recurring donation id, is
 * the whole credential, and all it can do is stop.
 *
 * A POST, not a GET, on purpose: mail scanners and link previewers open every
 * link in an email, and a GET that stopped the donation would be stopped by the
 * scanner. The page behind the link (/donasi-rutin/berhenti/[token]) shows a
 * confirm button that posts here.
 *
 * Every refusal (bad, expired, unknown) answers the same 404, so the response
 * does not say which of them it was.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const stopped = await stopRecurringDonationByToken(prisma, token);
  if (!stopped.ok) {
    return NextResponse.json({ error: 'Tautan tidak valid atau sudah kedaluwarsa.' }, { status: 404 });
  }
  // 303: the browser follows a form POST with a GET of the confirmation page.
  return NextResponse.redirect(new URL(`${recurringStopPath(token)}?selesai=1`, request.url), 303);
}
