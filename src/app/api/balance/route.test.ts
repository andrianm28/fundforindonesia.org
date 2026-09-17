import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "./route";

// Mock dependencies
vi.mock("@/lib/auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
  },
}));

import { getServerSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const mockedGetServerSession = vi.mocked(getServerSession);
const mockedFindUnique = vi.mocked(prisma.user.findUnique);

describe("GET /api/balance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // The wallet is disabled (WALLET_ENABLED = false, src/lib/wallet.ts) while
  // top-ups mint balance with no payment behind them. Every request now gets
  // a 503 before session or database access happen at all.

  it("returns 503 regardless of authentication", async () => {
    mockedGetServerSession.mockResolvedValue(null);

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(typeof data.error).toBe("string");
    expect(data.error.length).toBeGreaterThan(0);
  });

  it("returns 503 even for an authenticated user with a stored balance", async () => {
    mockedGetServerSession.mockResolvedValue({
      user: { id: "user-1", name: "Test", email: "test@test.com", role: "DONOR" as const, isVerified: false, verificationType: null },
      expires: "2099-01-01",
    });

    const response = await GET();

    expect(response.status).toBe(503);
  });

  it("never reads the session or the database while disabled", async () => {
    await GET();

    expect(mockedGetServerSession).not.toHaveBeenCalled();
    expect(mockedFindUnique).not.toHaveBeenCalled();
  });
});
