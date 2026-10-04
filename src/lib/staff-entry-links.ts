import type { Assignment } from "@/generated/prisma/client";
import { hasAssignment } from "@/lib/assignment";

export interface StaffEntryLink {
  href: string;
  label: string;
}

/**
 * The doors to /admin and /moderasi a person should see, from the same
 * assignment check each area's layout guards on (ADR 0005: assignments are
 * independent, not ranks). Holding both shows both; holding neither, none.
 */
export function staffEntryLinks(assignments: Assignment[] | undefined): StaffEntryLink[] {
  const links: StaffEntryLink[] = [];
  if (hasAssignment(assignments, "ADMIN")) {
    links.push({ href: "/admin", label: "Admin" });
  }
  if (hasAssignment(assignments, "VERIFIER")) {
    links.push({ href: "/moderasi", label: "Moderasi" });
  }
  return links;
}
