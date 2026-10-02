import { NextRequest, NextResponse } from 'next/server';
import { confirmEmailVerification } from '@/lib/email-verification';

/**
 * Spends a confirmation token (prd-compliance 23). The token is the proof, so
 * no session is needed -- the link may be opened on another device -- and every
 * token that does not confirm gets the same answer.
 */
export async function POST(request: NextRequest) {
  let token: unknown;
  try {
    ({ token } = (await request.json()) as { token?: unknown });
  } catch {
    return NextResponse.json({ error: 'Tautan konfirmasi tidak valid' }, { status: 400 });
  }
  if (typeof token !== 'string' || token.length === 0 || token.length > 200) {
    return NextResponse.json({ error: 'Tautan konfirmasi tidak valid' }, { status: 400 });
  }

  const result = await confirmEmailVerification(token);
  if (!result.ok) {
    return NextResponse.json({ error: 'Tautan konfirmasi tidak valid atau sudah kedaluwarsa' }, { status: 400 });
  }
  return NextResponse.json({ verified: true, claimed: result.claimed }, { status: 200 });
}
