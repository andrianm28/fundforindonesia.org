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
    const storedHash = await bcrypt.hash("correct-password-123", 10);

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
    // 50 runs x one real bcryptjs compare. bcryptjs is the pure-JS
    // implementation, so a cost-10 compare is ~130ms here: the property is
    // genuinely ~7s of key-derivation work, not a hang. Real hashing is the
    // point -- it is what proves a wrong password is actually rejected -- so
    // the timeout is raised rather than numRuns cut or bcrypt mocked.
  }, 30_000);

  test("correct current password with valid new password succeeds and updates hash", async () => {
    const { PATCH } = await import("@/app/api/user/password/route");

    const bcrypt = await import("bcryptjs");
    const storedHash = await bcrypt.hash("correct-password-123", 10);

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

        // Must call user.update with a hashed password
        expect(mockedPrisma.user.update).toHaveBeenCalledTimes(1);
      }),
      { numRuns: 20 }
    );
    // 20 runs x (compare + hash) at ~270ms per run: ~5.4s, just over the 5s
    // default. Same reasoning as the property above.
  }, 30_000);
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

// ============================================================
// Property 5: Verification Role Upgrade
// Successful verification always upgrades DONOR to CAMPAIGN_CREATOR
// **Validates: Requirements 6.5**
// ============================================================
describe("Feature: platform-polish, Property 5: Verification Role Upgrade", () => {
  // Arbitrary for valid KTP names (2-100 chars)
  const validNameArb = fc.string({ minLength: 2, maxLength: 100 }).filter(
    (s) => s.trim().length >= 2
  );

  // Arbitrary for valid NIK (exactly 16 digits)
  const validNikArb = fc
    .array(fc.constantFrom("0", "1", "2", "3", "4", "5", "6", "7", "8", "9"), {
      minLength: 16,
      maxLength: 16,
    })
    .map((chars) => chars.join(""));

  // Arbitrary for valid organization names (2-100 chars)
  const validOrgNameArb = fc.string({ minLength: 2, maxLength: 100 }).filter(
    (s) => s.trim().length >= 2
  );

  // Arbitrary for valid registration numbers (min 5 chars)
  const validRegNumberArb = fc.string({ minLength: 5, maxLength: 50 }).filter(
    (s) => s.trim().length >= 5
  );

  test("KTP verification always upgrades user role to CAMPAIGN_CREATOR", async () => {
    const { POST } = await import("@/app/api/user/verify/route");

    await fc.assert(
      fc.asyncProperty(validNameArb, validNikArb, async (fullName, nik) => {
        vi.clearAllMocks();

        mockedGetServerSession.mockResolvedValue(mockAuthSession());
        mockedPrisma.user.update.mockResolvedValue({
          id: "user-123",
          isVerified: true,
          verificationType: "ktp",
          role: "CAMPAIGN_CREATOR",
        } as any);

        const request = new NextRequest(
          new URL("http://localhost:3000/api/user/verify"),
          {
            method: "POST",
            body: JSON.stringify({
              type: "ktp",
              fullName,
              nik,
            }),
            headers: { "Content-Type": "application/json" },
          }
        );

        const response = await POST(request);

        // Must succeed
        expect(response.status).toBe(200);

        const body = await response.json();
        expect(body.user.role).toBe("CAMPAIGN_CREATOR");
        expect(body.user.isVerified).toBe(true);

        // Must update user with role upgrade
        expect(mockedPrisma.user.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              isVerified: true,
              verificationType: "ktp",
              role: "CAMPAIGN_CREATOR",
            }),
          })
        );
      }),
      { numRuns: 30 }
    );
  });

  test("Organization verification always upgrades user role to CAMPAIGN_CREATOR", async () => {
    const { POST } = await import("@/app/api/user/verify/route");

    await fc.assert(
      fc.asyncProperty(
        validOrgNameArb,
        validRegNumberArb,
        async (orgName, regNumber) => {
          vi.clearAllMocks();

          mockedGetServerSession.mockResolvedValue(mockAuthSession());
          mockedPrisma.user.update.mockResolvedValue({
            id: "user-123",
            isVerified: true,
            verificationType: "organization",
            role: "CAMPAIGN_CREATOR",
          } as any);

          const request = new NextRequest(
            new URL("http://localhost:3000/api/user/verify"),
            {
              method: "POST",
              body: JSON.stringify({
                type: "organization",
                orgName,
                regNumber,
              }),
              headers: { "Content-Type": "application/json" },
            }
          );

          const response = await POST(request);

          // Must succeed
          expect(response.status).toBe(200);

          const body = await response.json();
          expect(body.user.role).toBe("CAMPAIGN_CREATOR");
          expect(body.user.isVerified).toBe(true);

          // Must update user with role upgrade
          expect(mockedPrisma.user.update).toHaveBeenCalledWith(
            expect.objectContaining({
              data: expect.objectContaining({
                isVerified: true,
                verificationType: "organization",
                role: "CAMPAIGN_CREATOR",
              }),
            })
          );
        }
      ),
      { numRuns: 30 }
    );
  });
});
