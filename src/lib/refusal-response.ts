import { NextResponse } from 'next/server';
import type { Assignment } from '@/generated/prisma/client';
import { domainErrorToHttp } from '@/lib/domain-errors';
import { judgeCapacity, type CapacitySubject } from '@/lib/capacity';

/**
 * The HTTP answer for a typed refusal (its status, Indonesian message and
 * code, through `domainErrorToHttp`), or null for anything else, which the
 * route logs and answers as its own 500. Shared by the Payout and Refund
 * routes so none of them maps a money error by hand.
 */
export function refusalResponse(error: unknown): NextResponse | null {
  const refusal = domainErrorToHttp(error);
  return refusal ? NextResponse.json(refusal.body, { status: refusal.status }) : null;
}

/**
 * The owner-only routes' one question, asked of the Capacity judgement:
 * may this signed-in person act as this Campaign's or Volunteer Trip's
 * Fundraiser? Null when they may; otherwise the 403 `NOT_AUTHORIZED`
 * answer, "Hanya Fundraiser {Campaign|Volunteer Trip} ini yang dapat
 * melakukan tindakan ini.", the same on every such route.
 *
 * Pass the subject as the route already read it. A route that goes on to
 * a money operation still has that operation's own check under its lock.
 */
export function refuseUnlessFundraiser(
  subject: CapacitySubject,
  user: { id?: string | null; assignments?: readonly Assignment[] },
): NextResponse | null {
  try {
    judgeCapacity(subject, { userId: user.id ?? '', assignments: user.assignments ?? [] }, 'FUNDRAISER');
    return null;
  } catch (error) {
    const refusal = refusalResponse(error);
    if (refusal) return refusal;
    throw error;
  }
}
