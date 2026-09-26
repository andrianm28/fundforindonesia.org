import { NextResponse } from 'next/server';
import { StatusChangeCapacity, type Assignment, type Role } from '@/generated/prisma/client';
import { domainErrorToHttp } from '@/lib/domain-errors';
import { fundraiserOnlyRefusal, judgeCapacity, type CapacitySubject } from '@/lib/capacity';
import { isAtLeast } from '@/lib/roles';

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

/**
 * The edit routes' one question (Campaign PATCH, Trip PATCH, Batch create
 * and Batch actions): may this signed-in person act here as the subject's
 * Fundraiser or as an Admin? Asked of the Capacity judgement as
 * FUNDRAISER_OR_ADMIN, so Admin power comes only from the ADMIN
 * assignment, never the Role (ADR 0005), and an Admin who owns the subject
 * acts as its Fundraiser (CONTEXT.md, Capacity).
 *
 * Null when they may. Otherwise a 403:
 * - `{ error: 'Forbidden' }` for anyone not acting as Admin who lacks the
 *   legacy CAMPAIGN_CREATOR Role. That gate stays until who may create a
 *   Campaign or Volunteer Trip is decided (prd-compliance tickets 06-08).
 * - `NOT_AUTHORIZED`, "Hanya Fundraiser {Campaign|Volunteer Trip} ini yang
 *   dapat melakukan tindakan ini.", for anyone else who is neither.
 */
export function refuseUnlessFundraiserOrAdmin(
  subject: CapacitySubject,
  user: { id?: string | null; role?: Role | null; assignments?: readonly Assignment[] },
): NextResponse | null {
  let capacity: StatusChangeCapacity | null = null;
  let refusal: NextResponse | null = null;
  try {
    capacity = judgeCapacity(
      subject,
      { userId: user.id ?? '', assignments: user.assignments ?? [] },
      'FUNDRAISER_OR_ADMIN',
      fundraiserOnlyRefusal(subject.kind),
    );
  } catch (error) {
    refusal = refusalResponse(error);
    if (!refusal) throw error;
  }
  if (capacity !== StatusChangeCapacity.ADMIN && !isAtLeast(user.role, 'CAMPAIGN_CREATOR')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return refusal;
}
