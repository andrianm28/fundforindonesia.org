import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";

// Mock prisma
vi.mock("@/lib/prisma", () => ({
  prisma: {
    campaign: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    donation: {
      create: vi.fn(),
    },
    prayer: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

// Mock auth
vi.mock("@/lib/auth", () => ({
  getServerSession: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { getServerSession } from "@/lib/auth";

const mockCampaignFindUnique = prisma.campaign.findUnique as unknown as Mock;
const mockCampaignUpdate = (prisma.campaign as unknown as { update: Mock }).update;
const mockTransaction = prisma.$transaction as unknown as Mock;
const mockGetServerSession = getServerSession as unknown as Mock;

function createRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/balance/donate", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

// The wallet is disabled (WALLET_ENABLED = false, src/lib/wallet.ts). This
// endpoint spent minted balance and wrote straight to
// Campaign.collectedAmount - a second, uncontrolled writer of the field the
// settled-payment webhook is supposed to own alone. It must now refuse
// every request up front and must never touch collectedAmount or a user's
// balance again.
describe("POST /api/balance/donate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const validBody = {
    campaignId: "campaign-1",
    amount: 50000,
    message: "Semoga cepat sembuh",
    isAnonymous: false,
  };

  it("returns 503 even for an authenticated user with a valid, well-funded request", async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1", name: "Test User", email: "test@test.com" },
      expires: "2099-01-01",
    });
    mockCampaignFindUnique.mockResolvedValue({
      id: "campaign-1",
      status: "active",
      targetAmount: 1000000,
      collectedAmount: 0,
    });

    const request = createRequest(validBody);
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(typeof data.error).toBe("string");
    expect(data.error.length).toBeGreaterThan(0);
  });

  it("returns 503 when there is no session at all", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const request = createRequest(validBody);
    const response = await POST(request);

    expect(response.status).toBe(503);
  });

  it("never increments campaign.collectedAmount or touches a user's balance while disabled", async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1", name: "Test User", email: "test@test.com" },
      expires: "2099-01-01",
    });

    const request = createRequest(validBody);
    await POST(request);

    expect(mockCampaignFindUnique).not.toHaveBeenCalled();
    expect(mockCampaignUpdate).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockGetServerSession).not.toHaveBeenCalled();
  });
});
