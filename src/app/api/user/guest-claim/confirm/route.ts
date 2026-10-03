import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth';
import { confirmGuestClaimLink, GUEST_CLAIM_TOKEN_LENGTH } from '@/lib/guest-claim-link';

/**
 * Spends a claim token (prd-audit 08). Unlike the email confirmation link this
 * needs the session: the token claims only for the account it was issued to,
 * and every token that does not claim gets the same answer. It is a POST so a
 * mail scanner that merely fetches the link cannot spend it.
 */
export async function POST(request: NextRequest) {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let token: unknown;
  try {
    ({ token } = (await request.json()) as { token?: unknown });
  } catch {
    return NextResponse.json({ error: 'Tautan tidak valid' }, { status: 400 });
  }
  if (typeof token !== 'string' || token.length !== GUEST_CLAIM_TOKEN_LENGTH) {
    return NextResponse.json({ error: 'Tautan tidak valid' }, { status: 400 });
  }

  const result = await confirmGuestClaimLink(session.user.id, token);
  if (!result.ok) {
    return NextResponse.json({ error: 'Tautan tidak valid atau sudah kedaluwarsa' }, { status: 400 });
  }
  return NextResponse.json({ claimed: result.claimed }, { status: 200 });
}
