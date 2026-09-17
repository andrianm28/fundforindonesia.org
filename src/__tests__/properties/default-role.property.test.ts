import { describe, test, expect, vi, beforeEach } from "vitest";
import * as fc from "fast-check";

// Mock bcrypt to avoid slow hashing in property tests
vi.mock("bcryptjs", () => ({
  default: {
    hash: vi.fn().mockResolvedValue("$2a$12$hashedpassword"),
  },
}));

// Mock prisma
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/prisma";
import { POST } from "@/app/api/auth/register/route";
import { NextRequest } from "next/server";

const mockedFindUnique = vi.mocked(prisma.user.findUnique);
const mockedCreate = vi.mocked(prisma.user.create);

beforeEach(() => {
  vi.clearAllMocks();
});

// Arbitraries for generating valid registration data
const emailArb = fc
  .tuple(
    fc.stringMatching(/^[a-z][a-z0-9]{1,10}$/),
    fc.constantFrom("gmail.com", "yahoo.com", "outlook.com", "email.co.id", "test.org")
  )
  .map(([local, domain]) => `${local}@${domain}`);

const nameArb = fc.stringMatching(/^[A-Za-z][A-Za-z0-9]{0,19}$/);

const passwordArb = fc.stringMatching(/^[A-Za-z0-9!@#$%^&*]{8,20}$/);

// Helper to create a NextRequest with JSON body
function createRegisterRequest(body: { name: string; email: string; password: string }): NextRequest {
  return new NextRequest(new URL("http://localhost:3000/api/auth/register"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Feature: user-roles, Property 2: Default Role Assignment", () => {
  // Feature: user-roles, Property 2: Default Role Assignment
  // **Validates: Requirements 1.2**

  test("any new user registration results in DONOR role (no explicit role in create call)", async () => {
    await fc.assert(
      fc.asyncProperty(nameArb, emailArb, passwordArb, async (name, email, password) => {
        // Reset mocks for each iteration
        mockedFindUnique.mockReset();
        mockedCreate.mockReset();

        // User does not exist yet
        mockedFindUnique.mockResolvedValue(null);

        // Mock create to return a user with DONOR role (database default)
        mockedCreate.mockResolvedValue({
          id: "test-id",
          name,
          email,
          password: "$2a$12$hashedpassword",
          avatar: null,
          phone: null,
          isVerified: false,
          verificationType: null,
          role: "DONOR",
          donationBalance: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as any);

        const req = createRegisterRequest({ name, email, password });
        const response = await POST(req);

        expect(response.status).toBe(201);

        // Verify prisma.user.create was called exactly once
        expect(mockedCreate).toHaveBeenCalledTimes(1);

        // Get the data passed to prisma.user.create
        const createCallArgs = mockedCreate.mock.calls[0][0] as any;
        const createData = createCallArgs.data;

        // The registration endpoint should NOT explicitly set a role
        // (it relies on the database default of DONOR)
        // This means either role is absent from the data, or if present, it must be "DONOR"
        if ("role" in createData) {
          expect(createData.role).toBe("DONOR");
        }
        // If role is not in the create data, the DB default (DONOR) applies — this is correct
      }),
      { numRuns: 100 }
    );
  });

  test("registration never assigns ADMIN, MODERATOR, or CAMPAIGN_CREATOR role", async () => {
    await fc.assert(
      fc.asyncProperty(nameArb, emailArb, passwordArb, async (name, email, password) => {
        // Reset mocks for each iteration
        mockedFindUnique.mockReset();
        mockedCreate.mockReset();

        mockedFindUnique.mockResolvedValue(null);

        mockedCreate.mockResolvedValue({
          id: "test-id",
          name,
          email,
          password: "$2a$12$hashedpassword",
          avatar: null,
          phone: null,
          isVerified: false,
          verificationType: null,
          role: "DONOR",
          donationBalance: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as any);

        const req = createRegisterRequest({ name, email, password });
        const response = await POST(req);

        expect(response.status).toBe(201);

        // Verify the create call data does not assign any privileged role
        const createCallArgs = mockedCreate.mock.calls[0][0] as any;
        const createData = createCallArgs.data;

        expect(createData.role).not.toBe("ADMIN");
        expect(createData.role).not.toBe("MODERATOR");
        expect(createData.role).not.toBe("CAMPAIGN_CREATOR");
      }),
      { numRuns: 100 }
    );
  });

  test("registration does not include a role field in user creation data (relies on DB default)", async () => {
    await fc.assert(
      fc.asyncProperty(nameArb, emailArb, passwordArb, async (name, email, password) => {
        // Reset mocks for each iteration
        mockedFindUnique.mockReset();
        mockedCreate.mockReset();

        mockedFindUnique.mockResolvedValue(null);

        mockedCreate.mockResolvedValue({
          id: "test-id",
          name,
          email,
          password: "$2a$12$hashedpassword",
          avatar: null,
          phone: null,
          isVerified: false,
          verificationType: null,
          role: "DONOR",
          donationBalance: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as any);

        const req = createRegisterRequest({ name, email, password });
        const response = await POST(req);

        expect(response.status).toBe(201);

        const createCallArgs = mockedCreate.mock.calls[0][0] as any;
        const createData = createCallArgs.data;

        // The registration endpoint should only pass name, email, and password.
        // No role field should be set — the Prisma schema @default(DONOR) handles it.
        const dataKeys = Object.keys(createData);
        expect(dataKeys).not.toContain("role");
      }),
      { numRuns: 100 }
    );
  });
});
