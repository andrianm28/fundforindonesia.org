import { Role } from "@/generated/prisma/client";

/**
 * Numeric level mapping for role hierarchy.
 * Higher number = more privilege.
 * ADMIN > MODERATOR > CAMPAIGN_CREATOR > DONOR
 */
export const ROLE_LEVELS: Record<Role, number> = {
  DONOR: 0,
  CAMPAIGN_CREATOR: 1,
  MODERATOR: 2,
  ADMIN: 3,
};

/**
 * Normalize a role value, defaulting to DONOR for null/undefined.
 */
function normalizeRole(role: Role | null | undefined): Role {
  return role ?? "DONOR";
}

/**
 * Check if user has a specific role (exact match).
 */
export function hasRole(
  userRole: Role | null | undefined,
  requiredRole: Role
): boolean {
  return normalizeRole(userRole) === requiredRole;
}

/**
 * Check if user's role is at least the required level (hierarchy comparison).
 * Higher roles inherit all permissions of lower roles.
 */
export function isAtLeast(
  userRole: Role | null | undefined,
  minimumRole: Role
): boolean {
  return ROLE_LEVELS[normalizeRole(userRole)] >= ROLE_LEVELS[minimumRole];
}

/**
 * Throw an error if user doesn't meet the minimum role requirement.
 */
export function requireRole(
  userRole: Role | null | undefined,
  minimumRole: Role
): void {
  if (!isAtLeast(userRole, minimumRole)) {
    throw new Error(
      `Requires at least ${minimumRole} role`
    );
  }
}
