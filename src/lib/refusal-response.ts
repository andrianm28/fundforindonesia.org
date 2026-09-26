import { NextResponse } from 'next/server';
import type { Assignment, StatusChangeCapacity } from '@/generated/prisma/client';
import { domainErrorToHttp } from '@/lib/domain-errors';
import { fundraiserOnlyRefusal, judgeCapacity, type CapacitySubject, type RequestedCapacity } from '@/lib/capacity';
import { BatchFieldsInvalidError } from '@/lib/volunteer-trip-errors';

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
 * `refusalResponse`, plus the form-shaped `fieldErrors` the Batch routes
 * have always answered with when the refusal names a field
 * (BatchFieldsInvalidError): `{ [field]: [message] }`.
 */
export function batchRefusalResponse(error: unknown): NextResponse | null {
  const refusal = domainErrorToHttp(error);
  if (!refusal) return null;
  const fieldErrors = error instanceof BatchFieldsInvalidError ? { [error.field]: [error.message] } : undefined;
  return NextResponse.json({ ...refusal.body, ...(fieldErrors && { fieldErrors }) }, { status: refusal.status });
}

/** A signed-in user as the session gives them, for the judgement. */
type SessionUser = { id?: string | null; assignments?: readonly Assignment[] };

/**
 * Ask the Capacity judgement for a signed-in user: the Capacity they act
 * in, or the HTTP answer for its typed refusal. Anything else is rethrown.
 */
function judgeForRoute(
  subject: CapacitySubject,
  user: SessionUser,
  requested: RequestedCapacity,
  refusal?: string,
): { capacity: StatusChangeCapacity } | { refusal: NextResponse } {
  try {
    const actor = { userId: user.id ?? '', assignments: user.assignments ?? [] };
    return { capacity: judgeCapacity(subject, actor, requested, refusal) };
  } catch (error) {
    const response = refusalResponse(error);
    if (response) return { refusal: response };
    throw error;
  }
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
export function refuseUnlessFundraiser(subject: CapacitySubject, user: SessionUser): NextResponse | null {
  const judged = judgeForRoute(subject, user, 'FUNDRAISER');
  return 'refusal' in judged ? judged.refusal : null;
}

/**
 * The edit routes' one question (Campaign PATCH, Trip PATCH, Batch create
 * and Batch actions): may this signed-in person act here as the subject's
 * Fundraiser or as an Admin? Asked of the Capacity judgement as
 * FUNDRAISER_OR_ADMIN, so Admin power comes only from the ADMIN
 * assignment, never the Role (ADR 0005), and an Admin who owns the subject
 * acts as its Fundraiser (CONTEXT.md, Capacity).
 *
 * Null when they may. Otherwise the 403 `NOT_AUTHORIZED` answer, "Hanya
 * Fundraiser {Campaign|Volunteer Trip} ini yang dapat melakukan tindakan
 * ini." No Role is asked for: ownership or the ADMIN assignment decides.
 */
export function refuseUnlessFundraiserOrAdmin(subject: CapacitySubject, user: SessionUser): NextResponse | null {
  const judged = judgeForRoute(subject, user, 'FUNDRAISER_OR_ADMIN', fundraiserOnlyRefusal(subject.kind));
  return 'refusal' in judged ? judged.refusal : null;
}
