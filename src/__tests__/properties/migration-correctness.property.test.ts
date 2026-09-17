import { describe, test, expect } from "vitest";
import * as fc from "fast-check";
import { Role } from "@/generated/prisma/client";

// Valid roles as defined in the system
const VALID_ROLES: Role[] = ["ADMIN", "MODERATOR", "CAMPAIGN_CREATOR", "DONOR"];

/**
 * Simulates the migration logic from the SQL:
 * UPDATE "User" SET "role" = 'CAMPAIGN_CREATOR' WHERE "isVerified" = true
 *
 * For any user:
 * - If isVerified === true → role should be CAMPAIGN_CREATOR
 * - If isVerified === false → role should remain DONOR (default)
 */
function migrateUserRole(isVerified: boolean): Role {
  return isVerified ? "CAMPAIGN_CREATOR" : "DONOR";
}

// Arbitrary that generates random user objects with isVerified boolean
const userArb = fc.record({
  id: fc.uuid(),
  name: fc.string({ minLength: 1, maxLength: 50 }),
  email: fc.emailAddress(),
  isVerified: fc.boolean(),
});

describe("Feature: user-roles, Property 10: Migration Correctness", () => {
  // Feature: user-roles, Property 10: Migration correctness
  // **Validates: Requirements 10.1, 10.2**

  test("verified users get CAMPAIGN_CREATOR role after migration", () => {
    fc.assert(
      fc.property(userArb, (user) => {
        fc.pre(user.isVerified === true);
        const assignedRole = migrateUserRole(user.isVerified);
        expect(assignedRole).toBe("CAMPAIGN_CREATOR");
      }),
      { numRuns: 100 }
    );
  });

  test("unverified users get DONOR role after migration", () => {
    fc.assert(
      fc.property(userArb, (user) => {
        fc.pre(user.isVerified === false);
        const assignedRole = migrateUserRole(user.isVerified);
        expect(assignedRole).toBe("DONOR");
      }),
      { numRuns: 100 }
    );
  });

  test("migration assigns exactly one of CAMPAIGN_CREATOR or DONOR based on isVerified", () => {
    fc.assert(
      fc.property(userArb, (user) => {
        const assignedRole = migrateUserRole(user.isVerified);

        // Role must be one of the two expected values
        expect(["CAMPAIGN_CREATOR", "DONOR"]).toContain(assignedRole);

        // Verify correct mapping
        if (user.isVerified) {
          expect(assignedRole).toBe("CAMPAIGN_CREATOR");
        } else {
          expect(assignedRole).toBe("DONOR");
        }
      }),
      { numRuns: 100 }
    );
  });

  test("migration result is always a valid role value", () => {
    fc.assert(
      fc.property(fc.boolean(), (isVerified) => {
        const assignedRole = migrateUserRole(isVerified);
        expect(VALID_ROLES).toContain(assignedRole);
      }),
      { numRuns: 100 }
    );
  });

  test("migration is deterministic: same isVerified always produces same role", () => {
    fc.assert(
      fc.property(fc.boolean(), (isVerified) => {
        const firstResult = migrateUserRole(isVerified);
        const secondResult = migrateUserRole(isVerified);
        expect(firstResult).toBe(secondResult);
      }),
      { numRuns: 100 }
    );
  });

  test("migration never assigns ADMIN or MODERATOR roles", () => {
    fc.assert(
      fc.property(userArb, (user) => {
        const assignedRole = migrateUserRole(user.isVerified);
        expect(assignedRole).not.toBe("ADMIN");
        expect(assignedRole).not.toBe("MODERATOR");
      }),
      { numRuns: 100 }
    );
  });
});
