import { describe, test, expect, vi, beforeEach } from "vitest";
import * as fc from "fast-check";
import { NextRequest } from "next/server";

// Feature: platform-polish, Properties 3-5: API Validation
// **Validates: Requirements 2.7, 2.5, 6.5**

// Mock dependencies
vi.mock("@/lib/auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

// The cost factors come from one module; the property tests set them low so
// real bcryptjs still proves a wrong password is rejected, without the tests'
// wall-clock time depending on production's cost or on machine load.
const TEST_HASH_COST = 4;
vi.mock("@/lib/password-hash-cost", () => ({
  REGISTRATION_HASH_COST: 4,
  PASSWORD_CHANGE_HASH_COST: 4,
}));

const fsMocks = vi.hoisted(() => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("fs/promises", () => ({
  ...fsMocks,
  default: fsMocks,
}));

import { getServerSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const mockedGetServerSession = vi.mocked(getServerSession);
const mockedPrisma = vi.mocked(prisma);
const mockedWriteFile = fsMocks.writeFile;
const mockedMkdir = fsMocks.mkdir;

// Helper: create a session for an authenticated user
function mockAuthSession(overrides?: Record<string, unknown>) {
  return {
    user: {
      id: "user-123",
      name: "Test User",
      email: "test@example.com",
      role: "DONOR",
      isVerified: false,
      verificationType: null,
      ...overrides,
    },
    expires: new Date(Date.now() + 86400000).toISOString(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ============================================================
// Property 3: Password Security
// Wrong current password always returns 400, never modifies stored hash
// **Validates: Requirements 2.7**
// ============================================================
describe("Feature: platform-polish, Property 3: Password Security", () => {
  // Arbitrary for random wrong passwords (guaranteed not to match the bcrypt hash)
  const wrongPasswordArb = fc.string({ minLength: 1, maxLength: 64 });
  const validNewPasswordArb = fc.string({ minLength: 8, maxLength: 64 });

  test("wrong current password always returns 400 and never modifies stored hash", async () => {
    const { PATCH } = await import("@/app/api/user/password/route");

    // The actual stored hash for "correct-password-123"
    const bcrypt = await import("bcryptjs");
    const storedHash = await bcrypt.hash("correct-password-123", TEST_HASH_COST);

    await fc.assert(
      fc.asyncProperty(
        wrongPasswordArb,
        validNewPasswordArb,
        async (wrongPassword, newPassword) => {
          // Skip when the random wrong password happens to be the actual password
          if (wrongPassword === "correct-password-123") return;

          mockedGetServerSession.mockResolvedValue(mockAuthSession());
          mockedPrisma.user.findUnique.mockResolvedValue({
            id: "user-123",
            password: storedHash,
          } as any);

          const request = new NextRequest(
            new URL("http://localhost:3000/api/user/password"),
            {
              method: "PATCH",
              body: JSON.stringify({
                currentPassword: wrongPassword,
                newPassword: newPassword,
                confirmPassword: newPassword,
              }),
              headers: { "Content-Type": "application/json" },
            }
          );

          const response = await PATCH(request);

          // Must always return 400
          expect(response.status).toBe(400);

          const body = await response.json();
          expect(body.error).toBe("Password saat ini salah");

          // Must never call user.update (hash never modified)
          expect(mockedPrisma.user.update).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 50 }
    );
    // 50 runs x one real bcryptjs compare at TEST_HASH_COST. Real hashing is
    // the point -- it proves a wrong password is actually rejected -- but at
    // production cost the property was ~7s of pure-JS key derivation and
    // timed out whenever the machine was busy.
    expect(bcrypt.getRounds(storedHash)).toBe(TEST_HASH_COST);
  });

  test("correct current password with valid new password succeeds and updates hash", async () => {
    const { PATCH } = await import("@/app/api/user/password/route");

    const bcrypt = await import("bcryptjs");
    const storedHash = await bcrypt.hash("correct-password-123", TEST_HASH_COST);

    await fc.assert(
      fc.asyncProperty(validNewPasswordArb, async (newPassword) => {
        vi.clearAllMocks();

        mockedGetServerSession.mockResolvedValue(mockAuthSession());
        mockedPrisma.user.findUnique.mockResolvedValue({
          id: "user-123",
          password: storedHash,
        } as any);
        mockedPrisma.user.update.mockResolvedValue({} as any);

        const request = new NextRequest(
          new URL("http://localhost:3000/api/user/password"),
          {
            method: "PATCH",
            body: JSON.stringify({
              currentPassword: "correct-password-123",
              newPassword: newPassword,
              confirmPassword: newPassword,
            }),
            headers: { "Content-Type": "application/json" },
          }
        );

        const response = await PATCH(request);

        // Must succeed
        expect(response.status).toBe(200);

        const body = await response.json();
        expect(body.message).toBe("Password berhasil diubah");

        // Must call user.update with a hashed password, hashed at the
        // configured cost factor rather than one hard-coded in the route
        expect(mockedPrisma.user.update).toHaveBeenCalledTimes(1);
        const [updateArgs] = vi.mocked(mockedPrisma.user.update).mock.calls[0];
        const { password: newHash } = updateArgs.data as { password: string };
        expect(bcrypt.getRounds(newHash)).toBe(TEST_HASH_COST);
        expect(await bcrypt.compare(newPassword, newHash)).toBe(true);
      }),
      { numRuns: 20 }
    );
  });
});

// ============================================================
// Property 4: Avatar Size Constraint
// Files >2MB always rejected before writing to disk
// **Validates: Requirements 2.5**
// ============================================================
describe("Feature: platform-polish, Property 4: Avatar Size Constraint", () => {
  const MAX_SIZE = 2 * 1024 * 1024; // 2MB

  // Use sizes just over 2MB (not too large to avoid memory issues in tests)
  const oversizedFileSizeArb = fc.constantFrom(
    MAX_SIZE + 1,
    MAX_SIZE + 100,
    MAX_SIZE + 1024,
    MAX_SIZE + 10240
  );

  // Valid MIME types for avatar
  const validMimeArb = fc.constantFrom("image/jpeg", "image/png", "image/webp");

  test("files exceeding 2MB are always rejected before writing to disk", async () => {
    const { POST } = await import("@/app/api/user/avatar/route");

    await fc.assert(
      fc.asyncProperty(
        oversizedFileSizeArb,
        validMimeArb,
        async (fileSize, mimeType) => {
          vi.clearAllMocks();

          mockedGetServerSession.mockResolvedValue(mockAuthSession());

          // Create a mock file object with the oversized reported size
          const mockFile = {
            name: "avatar.jpg",
            type: mimeType,
            size: fileSize,
            arrayBuffer: async () => new ArrayBuffer(10),
          };

          // Create a custom request that returns our mock file from formData
          const request = {
            formData: async () => ({
              get: (key: string) => (key === "file" ? mockFile : null),
            }),
          } as unknown as NextRequest;

          const response = await POST(request);

          // Must reject with 400
          expect(response.status).toBe(400);

          const body = await response.json();
          expect(body.error).toContain("2MB");

          // Must never write to disk
          expect(mockedWriteFile).not.toHaveBeenCalled();

          // Must never update user in DB
          expect(mockedPrisma.user.update).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 20 }
    );
  });

  test("files within 2MB with valid type are accepted", async () => {
    const { POST } = await import("@/app/api/user/avatar/route");

    // Arbitrary for file sizes ≤ 2MB (use small sizes to keep tests fast)
    const validFileSizeArb = fc.integer({ min: 100, max: 1024 });

    await fc.assert(
      fc.asyncProperty(
        validFileSizeArb,
        validMimeArb,
        async (fileSize, mimeType) => {
          vi.clearAllMocks();

          mockedGetServerSession.mockResolvedValue(mockAuthSession());
          mockedPrisma.user.update.mockResolvedValue({
            avatar: "/uploads/test.jpg",
          } as any);

          // Create a mock file object within size limit
          const mockFile = {
            name: "avatar.jpg",
            type: mimeType,
            size: fileSize,
            arrayBuffer: async () => new ArrayBuffer(fileSize),
          };

          const request = {
            formData: async () => ({
              get: (key: string) => (key === "file" ? mockFile : null),
            }),
          } as unknown as NextRequest;

          const response = await POST(request);

          // Must succeed
          expect(response.status).toBe(200);

          const body = await response.json();
          expect(body.avatar).toBeDefined();
          expect(body.avatar).toContain("/uploads/");
        }
      ),
      { numRuns: 20 }
    );
  });
});
