import type { Assignment } from "@/generated/prisma/client";

/**
 * True if the given assignments include the required one. Treats a
 * missing list as no assignments -- deny by default, never assume.
 *
 * Lives apart from `withAssignmentCheck` (which imports the server session)
 * so a client component can use the same check the page guards use.
 */
export function hasAssignment(
  assignments: Assignment[] | undefined,
  required: Assignment
): boolean {
  return (assignments ?? []).includes(required);
}
