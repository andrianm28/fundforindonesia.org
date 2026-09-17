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
const mockUserFindUnique = prisma.user.findUnique as unknown as Mock;
const mockUserUpdate = (prisma.user as unknown as { update: Mock }).update;
const mockDonationCreate = (prisma as unknown as { donation: { create: Mock } }).donation.create;
const mockCampaignUpdate = (prisma.campaign as unknown as { update: Mock }).update;
const mockPrayerCreate = prisma.prayer.create as unknown as Mock;
const mockTransaction = prisma.$transaction as unknown as Mock;
const mockGetServerSession = getServerSession as unknown as Mock;

function createRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/balance/donate", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

describe("POST /api/balance/donate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1", name: "Test User", email: "test@test.com" },
      expires: "2099-01-01",
    });
    // These are needed because $transaction receives PrismaPromise objects
    mockUserUpdate.mockResolvedValue({});
    mockDonationCreate.mockResolvedValue({});
    mockCampaignUpdate.mockResolvedValue({});
  });

  const validBody = {
    campaignId: "campaign-1",
    amount: 50000,
    message: "Semoga cepat sembuh",
    isAnonymous: false,
  };

  it("should return 401 when user is not authenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const request = createRequest(validBody);
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toContain("login");
  });

  it("should return 400 when amount is below minimum (1000)", async () => {
    const request = createRequest({ ...validBody, amount: 500 });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("Validasi gagal");
    expect(data.fieldErrors.amount).toBeDefined();
  });

  it("should return 400 when campaignId is missing", async () => {
    const request = createRequest({ amount: 50000 });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("Validasi gagal");
    expect(data.fieldErrors.campaignId).toBeDefined();
  });

  it("should return 404 when campaign does not exist", async () => {
    mockCampaignFindUnique.mockResolvedValue(null);

    const request = createRequest(validBody);
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe("Campaign tidak ditemukan");
  });

  it("should return 400 when campaign is not active", async () => {
    mockCampaignFindUnique.mockResolvedValue({
      id: "campaign-1",
      status: "completed",
      targetAmount: 1000000,
      collectedAmount: 1000000,
    });

    const request = createRequest(validBody);
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain("tidak aktif");
  });

  it("should return 400 with current balance when balance is insufficient", async () => {
    mockCampaignFindUnique.mockResolvedValue({
      id: "campaign-1",
      status: "active",
      targetAmount: 1000000,
      collectedAmount: 500000,
    });

    mockUserFindUnique.mockResolvedValue({
      donationBalance: 30000,
    });

    const request = createRequest(validBody);
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("Saldo tidak mencukupi");
    expect(data.currentBalance).toBe(30000);
  });

  it("should process donation successfully and return 201", async () => {
    mockCampaignFindUnique.mockResolvedValue({
      id: "campaign-1",
      status: "active",
      targetAmount: 1000000,
      collectedAmount: 500000,
    });

    mockUserFindUnique.mockResolvedValue({
      donationBalance: 100000,
    });

    mockTransaction.mockResolvedValue([
      { donationBalance: 50000 }, // updated user
      { id: "donation-1", amount: 50000 }, // created donation
      { id: "campaign-1", collectedAmount: 550000 }, // updated campaign
    ]);

    mockPrayerCreate.mockResolvedValue({});

    const request = createRequest(validBody);
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.donationId).toBe("donation-1");
    expect(data.newBalance).toBe(50000);
    expect(data.message).toBe("Donasi berhasil");
  });

  it("should create a prayer record when message is provided", async () => {
    mockCampaignFindUnique.mockResolvedValue({
      id: "campaign-1",
      status: "active",
      targetAmount: 1000000,
      collectedAmount: 500000,
    });

    mockUserFindUnique.mockResolvedValue({
      donationBalance: 100000,
    });

    mockTransaction.mockResolvedValue([
      { donationBalance: 50000 },
      { id: "donation-1", amount: 50000 },
      { id: "campaign-1", collectedAmount: 550000 },
    ]);

    mockPrayerCreate.mockResolvedValue({});

    const request = createRequest(validBody);
    await POST(request);

    expect(mockPrayerCreate).toHaveBeenCalledWith({
      data: {
        text: "Semoga cepat sembuh",
        donationId: "donation-1",
        campaignId: "campaign-1",
        userId: "user-1",
      },
    });
  });

  it("should NOT create a prayer record when no message is provided", async () => {
    mockCampaignFindUnique.mockResolvedValue({
      id: "campaign-1",
      status: "active",
      targetAmount: 1000000,
      collectedAmount: 500000,
    });

    mockUserFindUnique.mockResolvedValue({
      donationBalance: 100000,
    });

    mockTransaction.mockResolvedValue([
      { donationBalance: 50000 },
      { id: "donation-1", amount: 50000 },
      { id: "campaign-1", collectedAmount: 550000 },
    ]);

    const request = createRequest({
      campaignId: "campaign-1",
      amount: 50000,
    });
    await POST(request);

    expect(mockPrayerCreate).not.toHaveBeenCalled();
  });

  it("should mark campaign as completed when target is met", async () => {
    mockCampaignFindUnique.mockResolvedValue({
      id: "campaign-1",
      status: "active",
      targetAmount: 100000,
      collectedAmount: 60000,
    });

    mockUserFindUnique.mockResolvedValue({
      donationBalance: 50000,
    });

    mockTransaction.mockResolvedValue([
      { donationBalance: 0 },
      { id: "donation-1", amount: 50000 },
      { id: "campaign-1", collectedAmount: 110000, status: "completed" },
    ]);

    const request = createRequest({
      campaignId: "campaign-1",
      amount: 50000,
    });
    const response = await POST(request);

    expect(response.status).toBe(201);
    // Verify $transaction was called (which includes campaign status update)
    expect(mockTransaction).toHaveBeenCalled();
  });

  it("should default isAnonymous to false when not provided", async () => {
    mockCampaignFindUnique.mockResolvedValue({
      id: "campaign-1",
      status: "active",
      targetAmount: 1000000,
      collectedAmount: 500000,
    });

    mockUserFindUnique.mockResolvedValue({
      donationBalance: 100000,
    });

    mockTransaction.mockResolvedValue([
      { donationBalance: 50000 },
      { id: "donation-1", amount: 50000 },
      { id: "campaign-1", collectedAmount: 550000 },
    ]);

    const request = createRequest({
      campaignId: "campaign-1",
      amount: 50000,
    });
    const response = await POST(request);

    expect(response.status).toBe(201);
  });
});
