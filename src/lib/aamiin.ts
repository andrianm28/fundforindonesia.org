import { randomBytes } from 'node:crypto';
import type { NextRequest, NextResponse } from 'next/server';
import { createResultTokenCodec } from '@/lib/money/result-token-codec';
import { getServerSession } from '@/lib/auth';

/**
 * Who gave an Aamiin (PKS pemenuhan 15, Pasal 3.7(5)): the "marker" that, with
 * the Prayer, makes an Aamiin unique.
 *
 *   signed in -> "u:<userId>"           (the same on every device)
 *   guest     -> "a:<anonymousId>"      (from a signed cookie, so it cannot be
 *                                        forged to count as someone else)
 *
 * The cookie holds the anonymous id signed under a key derived from
 * NEXTAUTH_SECRET (result-token-codec.ts), so no new secret is introduced. A
 * guest who clears cookies is a new guest: no stronger identity is possible
 * without an account, which is the accepted limit of the rule.
 */
export const AAMIIN_COOKIE = 'ffi_aamiin';
const TTL_SECONDS = 400 * 24 * 60 * 60;
const codec = createResultTokenCodec('fund-for-indonesia:aamiin-anonymous:v1', TTL_SECONDS);

export interface AamiinVisitor {
  marker: string;
  /** Set only when a new anonymous id was minted: the response must carry it. */
  newCookie?: string;
}

/** The visitor's marker; a guest with no valid cookie gets a fresh anonymous id. */
export async function resolveAamiinVisitor(request: NextRequest, nowMs = Date.now()): Promise<AamiinVisitor> {
  const session = await getServerSession();
  const userId = session?.user?.id as string | undefined;
  if (userId) return { marker: `u:${userId}` };

  const existing = codec.verify(request.cookies.get(AAMIIN_COOKIE)?.value, nowMs);
  if (existing) return { marker: `a:${existing}` };

  const anonymousId = randomBytes(16).toString('hex');
  return { marker: `a:${anonymousId}`, newCookie: codec.sign(anonymousId, nowMs) };
}

/** The visitor's marker without minting anything: null for a guest with no valid cookie. */
export async function readAamiinMarker(request: NextRequest, nowMs = Date.now()): Promise<string | null> {
  const session = await getServerSession();
  const userId = session?.user?.id as string | undefined;
  if (userId) return `u:${userId}`;
  const existing = codec.verify(request.cookies.get(AAMIIN_COOKIE)?.value, nowMs);
  return existing ? `a:${existing}` : null;
}

export function setAamiinCookie(response: NextResponse, value: string): void {
  response.cookies.set(AAMIIN_COOKIE, value, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: TTL_SECONDS,
  });
}
