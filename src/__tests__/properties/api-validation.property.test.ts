import { describe, test, expect, vi, beforeEach } from "vitest";
import * as fc from "fast-check";
import { NextRequest } from "next/server";

// Feature: platform-polish, Properties 4-5: API Validation
// **Validates: Requirements 2.5, 6.5**

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

// Helper: create a session for an authenticated user
function mockAuthSession(overrides?: Record<string, unknown>) {
  return {
    user: {
      id: "user-123",
      name: "Test User",
      email: "test@example.com",
      assignments: [],
      ...overrides,
    },
    expires: new Date(Date.now() + 86400000).toISOString(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
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
  const MAGIC_BYTES: Record<string, number[]> = {
    "image/jpeg": [0xff, 0xd8, 0xff],
    "image/png": [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    "image/webp": [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50],
  };

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
            // Real magic bytes for the declared type: the route sniffs content (audit SEC-02).
            arrayBuffer: async () => {
              const buf = new Uint8Array(fileSize);
              buf.set(MAGIC_BYTES[mimeType]);
              return buf.buffer;
            },
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
