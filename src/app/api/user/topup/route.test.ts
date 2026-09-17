import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";

// Mock prisma
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: vi.fn(),
    topUp: {
      create: vi.fn(),
    },
    user: {
      update: vi.fn(),
    },
  },
}));

// Mock auth
vi.mock("@/lib/auth", () => ({
  getServerSession: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { getServerSession } from "@/lib/auth";

const mockedGetServerSession = vi.mocked(getServerSession);
const mockedTransaction = vi.mocked(prisma.$transaction);

function createRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/user/topup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// The wallet is disabled (WALLET_ENABLED = false, src/lib/wallet.ts). This
// endpoint used to mint donationBalance with no payment behind it at all -
// any authenticated user could call it repeatedly for up to Rp10.000.000 a
// time. It must now refuse every request, before touching the session, the
// body, or the database, and it must never create a TopUp or credit a
// balance again.
describe("POST /api/user/topup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 503 even for a valid, authenticated top-up request", async () => {
    mockedGetServerSession.mockResolvedValue({
      user: { id: "user-1", name: "Test", email: "test@test.com" },
      expires: "2099-01-01",
    } as any);

    const request = createRequest({ amount: 50000, paymentMethod: "BCA" });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(typeof data.error).toBe("string");
    expect(data.error.length).toBeGreaterThan(0);
  });

  it("returns 503 when there is no session at all", async () => {
    mockedGetServerSession.mockResolvedValue(null);

    const request = createRequest({ amount: 50000, paymentMethod: "BCA" });
    const response = await POST(request);

    expect(response.status).toBe(503);
  });

  it("returns 503 for a malformed body, without ever validating it", async () => {
    const request = createRequest({ amount: "not-a-number" });
    const response = await POST(request);

    expect(response.status).toBe(503);
  });

  it("never creates a TopUp or credits a balance while disabled", async () => {
    mockedGetServerSession.mockResolvedValue({
      user: { id: "user-1", name: "Test", email: "test@test.com" },
      expires: "2099-01-01",
    } as any);

    const request = createRequest({ amount: 10000000, paymentMethod: "BCA" });
    await POST(request);

    expect(mockedTransaction).not.toHaveBeenCalled();
    expect(mockedGetServerSession).not.toHaveBeenCalled();
  });
});
