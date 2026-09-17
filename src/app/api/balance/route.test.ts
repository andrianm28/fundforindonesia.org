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

  it("returns 401 when not authenticated", async () => {
    mockedGetServerSession.mockResolvedValue(null);

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.message).toBe("Anda harus login terlebih dahulu");
  });

  it("returns user donation balance when authenticated", async () => {
    mockedGetServerSession.mockResolvedValue({
      user: { id: "user-1", name: "Test", email: "test@test.com", role: "DONOR" as const, isVerified: false, verificationType: null },
      expires: "2099-01-01",
    });
    mockedFindUnique.mockResolvedValue({ donationBalance: 50000 } as any);

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.balance).toBe(50000);
    expect(mockedFindUnique).toHaveBeenCalledWith({
      where: { id: "user-1" },
      select: { donationBalance: true },
    });
  });

  it("returns 0 balance when user not found in database", async () => {
    mockedGetServerSession.mockResolvedValue({
      user: { id: "user-missing", name: "Test", email: "test@test.com", role: "DONOR" as const, isVerified: false, verificationType: null },
      expires: "2099-01-01",
    });
    mockedFindUnique.mockResolvedValue(null);

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.balance).toBe(0);
  });
});
