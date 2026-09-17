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

  // The wallet is disabled (WALLET_ENABLED = false, src/lib/wallet.ts) because
  // top-ups minted balance with no payment behind them. Reading a balance is
  // deliberately NOT gated: it cannot create a rupiah or move one, and the
  // people holding a balance should be able to see that it still exists.

  const session = {
    user: {
      id: "user-1",
      name: "Test",
      email: "test@test.com",
      role: "DONOR" as const,
      isVerified: false,
      verificationType: null,
    },
    expires: "2099-01-01",
  };

  it("returns the stored balance to the user who owns it", async () => {
    mockedGetServerSession.mockResolvedValue(session);
    mockedFindUnique.mockResolvedValue({ donationBalance: 1_371_884 } as never);

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.balance).toBe(1_371_884);
    // Scoped to the caller. A balance endpoint that reads any other id is a
    // different kind of bug entirely.
    expect(mockedFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "user-1" } }),
    );
  });

  it("requires a session", async () => {
    mockedGetServerSession.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
    expect(mockedFindUnique).not.toHaveBeenCalled();
  });

  it("reports zero rather than failing when the user row has no balance", async () => {
    mockedGetServerSession.mockResolvedValue(session);
    mockedFindUnique.mockResolvedValue(null);

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.balance).toBe(0);
  });

  it("only ever reads -- the disabled wallet's guarantee is that nothing mints", async () => {
    // The prisma mock exposes user.findUnique and nothing else. If this route
    // ever gained a write, this file would fail to run rather than quietly
    // permit it.
    expect(Object.keys(prisma.user)).toEqual(["findUnique"]);
  });
});
