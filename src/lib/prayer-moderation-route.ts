import { Assignment } from '@/generated/prisma/client';
import { withHiddenAnyAssignmentCheck } from '@/lib/withAssignmentCheck';
import { hasAssignment } from '@/lib/assignment';

/**
 * Who may moderate Prayers (PKS Pasal 3.7c): a Verifier or an Admin, each on
 * their own assignment (ADR 0005), and nobody else. Anyone else is answered
 * with the same 404 as a page or route that does not exist (ticket 90, "yang
 * lain 404"), so neither the API nor the screens confirm the panel is there.
 */
const MODERATORS = [Assignment.VERIFIER, Assignment.ADMIN] as const;

/** Wraps a moderation route handler: 401 signed out, 404 for anyone who is neither Verifier nor Admin. */
export const prayerModerationRoute = (handler: Parameters<typeof withHiddenAnyAssignmentCheck>[1]) =>
  withHiddenAnyAssignmentCheck(MODERATORS, handler);

/** The same question for a page, which answers `notFound()` when this is false. */
export function canModeratePrayers(assignments: Assignment[] | undefined): boolean {
  return MODERATORS.some((a) => hasAssignment(assignments, a));
}
