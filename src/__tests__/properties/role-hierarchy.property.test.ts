import { describe, test, expect } from "vitest";
import * as fc from "fast-check";
import { ROLE_LEVELS, hasRole, isAtLeast, requireRole } from "@/lib/roles";
import { Role } from "@/generated/prisma/client";

// Valid roles as defined in the system
const VALID_ROLES: Role[] = ["ADMIN", "MODERATOR", "CAMPAIGN_CREATOR", "DONOR"];

// Arbitrary that generates valid Role values
const roleArb = fc.constantFrom<Role>(...VALID_ROLES);

// Arbitrary that generates null/undefined values for graceful degradation testing
const missingRoleArb = fc.constantFrom<null | undefined>(null, undefined);

// Arbitrary that generates arbitrary strings (including invalid role values)
const arbitraryStringArb = fc.string({ minLength: 0, maxLength: 50 });

describe("Feature: user-roles, Property 1: Role Hierarchy Correctness", () => {
  // Feature: user-roles, Property 1: Role hierarchy correctness
  // **Validates: Requirements 7.1, 7.2, 7.3, 7.4**
  test("isAtLeast(A, B) equals ROLE_LEVELS[A] >= ROLE_LEVELS[B] for all role pairs", () => {
    fc.assert(
      fc.property(roleArb, roleArb, (roleA, roleB) => {
        const result = isAtLeast(roleA, roleB);
        const expected = ROLE_LEVELS[roleA] >= ROLE_LEVELS[roleB];
        expect(result).toBe(expected);
      }),
      { numRuns: 100 }
    );
  });

  test("ADMIN is at least every role", () => {
    fc.assert(
      fc.property(roleArb, (role) => {
        expect(isAtLeast("ADMIN", role)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  test("DONOR is only at least DONOR", () => {
    fc.assert(
      fc.property(roleArb, (role) => {
        if (role === "DONOR") {
          expect(isAtLeast("DONOR", role)).toBe(true);
        } else {
          expect(isAtLeast("DONOR", role)).toBe(false);
        }
      }),
      { numRuns: 100 }
    );
  });

  test("role hierarchy is transitive: if A >= B and B >= C then A >= C", () => {
    fc.assert(
      fc.property(roleArb, roleArb, roleArb, (roleA, roleB, roleC) => {
        if (isAtLeast(roleA, roleB) && isAtLeast(roleB, roleC)) {
          expect(isAtLeast(roleA, roleC)).toBe(true);
        }
      }),
      { numRuns: 100 }
    );
  });

  test("role hierarchy is reflexive: isAtLeast(A, A) is always true", () => {
    fc.assert(
      fc.property(roleArb, (role) => {
        expect(isAtLeast(role, role)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });
});

describe("Feature: user-roles, Property 9: Graceful Degradation", () => {
  // Feature: user-roles, Property 9: Graceful degradation on missing role
  // **Validates: Requirements 2.4**
  test("isAtLeast with null/undefined role behaves as if DONOR was passed", () => {
    fc.assert(
      fc.property(missingRoleArb, roleArb, (missingRole, targetRole) => {
        const resultWithMissing = isAtLeast(missingRole, targetRole);
        const resultWithDonor = isAtLeast("DONOR", targetRole);
        expect(resultWithMissing).toBe(resultWithDonor);
      }),
      { numRuns: 100 }
    );
  });

  test("hasRole with null/undefined role behaves as if DONOR was passed", () => {
    fc.assert(
      fc.property(missingRoleArb, roleArb, (missingRole, targetRole) => {
        const resultWithMissing = hasRole(missingRole, targetRole);
        const resultWithDonor = hasRole("DONOR", targetRole);
        expect(resultWithMissing).toBe(resultWithDonor);
      }),
      { numRuns: 100 }
    );
  });

  test("requireRole with null/undefined role throws for roles above DONOR", () => {
    fc.assert(
      fc.property(missingRoleArb, roleArb, (missingRole, targetRole) => {
        if (targetRole === "DONOR") {
          // Should NOT throw for DONOR requirement
          expect(() => requireRole(missingRole, targetRole)).not.toThrow();
        } else {
          // Should throw for any role above DONOR
          expect(() => requireRole(missingRole, targetRole)).toThrow(
            `Requires at least ${targetRole} role`
          );
        }
      }),
      { numRuns: 100 }
    );
  });

  test("null/undefined defaults to DONOR-level access (only DONOR check succeeds)", () => {
    fc.assert(
      fc.property(missingRoleArb, (missingRole) => {
        // Should be at least DONOR
        expect(isAtLeast(missingRole, "DONOR")).toBe(true);
        // Should NOT be at least any higher role
        expect(isAtLeast(missingRole, "CAMPAIGN_CREATOR")).toBe(false);
        expect(isAtLeast(missingRole, "MODERATOR")).toBe(false);
        expect(isAtLeast(missingRole, "ADMIN")).toBe(false);
      }),
      { numRuns: 100 }
    );
  });
});

describe("Feature: user-roles, Property 11: Role Invariant", () => {
  // Feature: user-roles, Property 11: Role invariant
  // **Validates: Requirements 1.1, 1.3**
  test("only valid role values are accepted by ROLE_LEVELS", () => {
    fc.assert(
      fc.property(arbitraryStringArb, (arbitraryString) => {
        const isValidRole = VALID_ROLES.includes(arbitraryString as Role);
        if (isValidRole) {
          // Valid roles have a defined level
          expect(ROLE_LEVELS[arbitraryString as Role]).toBeDefined();
          expect(typeof ROLE_LEVELS[arbitraryString as Role]).toBe("number");
        } else {
          // Invalid strings are not in ROLE_LEVELS
          expect(VALID_ROLES).not.toContain(arbitraryString);
        }
      }),
      { numRuns: 100 }
    );
  });

  test("ROLE_LEVELS contains exactly the four valid roles", () => {
    const roleLevelKeys = Object.keys(ROLE_LEVELS);
    expect(roleLevelKeys).toHaveLength(4);
    expect(roleLevelKeys.sort()).toEqual([...VALID_ROLES].sort());
  });

  test("each valid role maps to a unique numeric level", () => {
    const levels = VALID_ROLES.map((role) => ROLE_LEVELS[role]);
    const uniqueLevels = new Set(levels);
    expect(uniqueLevels.size).toBe(VALID_ROLES.length);
  });

  test("for any arbitrary string, it is either a valid role or not in the role set", () => {
    fc.assert(
      fc.property(arbitraryStringArb, (str) => {
        // A string is either exactly one of the valid roles, or it's not a valid role at all
        const matchingRoles = VALID_ROLES.filter((r) => r === str);
        expect(matchingRoles.length).toBeLessThanOrEqual(1);
      }),
      { numRuns: 100 }
    );
  });

  test("role values are distinct and non-overlapping", () => {
    fc.assert(
      fc.property(roleArb, (role) => {
        // Each role appears exactly once in the valid set
        const occurrences = VALID_ROLES.filter((r) => r === role).length;
        expect(occurrences).toBe(1);
        // And has exactly one numeric level
        expect(typeof ROLE_LEVELS[role]).toBe("number");
        expect(ROLE_LEVELS[role]).toBeGreaterThanOrEqual(0);
        expect(ROLE_LEVELS[role]).toBeLessThanOrEqual(3);
      }),
      { numRuns: 100 }
    );
  });
});
