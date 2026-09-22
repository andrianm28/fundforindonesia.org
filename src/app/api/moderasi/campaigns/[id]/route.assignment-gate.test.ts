import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    campaign: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    notification: {
      create: vi.fn(),
    },
  },
}));

vi.mock("@/lib/campaign-lifecycle", () => ({
  toLifecycleStatus: vi.fn(() => "ACTIVE"),
}));

import { getServerSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PATCH } from "./route";

const mockGetServerSession = getServerSession as unknown as Mock;
const mockCampaignFindUnique = prisma.campaign.findUnique as unknown as Mock;
const mockCampaignUpdate = prisma.campaign.update as unknown as Mock;
const mockNotificationCreate = prisma.notification.create as unknown as Mock;

function createRequest(): NextRequest {
  return new NextRequest("http://localhost:3000/api/moderasi/campaigns/campaign-1", {
    method: "PATCH",
    body: JSON.stringify({ action: "approve" }),
    headers: { "Content-Type": "application/json" },
  });
}

function routeContext() {
  return { params: Promise.resolve({ id: "campaign-1" }) };
}

describe("PATCH /api/moderasi/campaigns/[id] -- the real assignment gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCampaignFindUnique.mockResolvedValue({ id: "campaign-1", creatorId: "creator-1", title: "Test" });
    mockCampaignUpdate.mockResolvedValue({ id: "campaign-1" });
    mockNotificationCreate.mockResolvedValue({});
  });

  it("returns 401 when unauthenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);
    const response = await PATCH(createRequest(), routeContext());
    expect(response.status).toBe(401);
    expect(mockCampaignUpdate).not.toHaveBeenCalled();
  });

  it("returns 403 for an ADMIN-ranked user who does not hold the Verifier assignment", async () => {
    // The exact scenario ADR 0005 exists to fix: rank alone must never
    // substitute for the assignment this route requires.
    mockGetServerSession.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN", assignments: [] } });
    const response = await PATCH(createRequest(), routeContext());
    expect(response.status).toBe(403);
    expect(mockCampaignUpdate).not.toHaveBeenCalled();
  });

  it("passes a MODERATOR-ranked user who holds the Verifier assignment", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "mod-1", role: "MODERATOR", assignments: ["VERIFIER"] } });
    const response = await PATCH(createRequest(), routeContext());
    expect(response.status).toBe(200);
    expect(mockCampaignUpdate).toHaveBeenCalledOnce();
  });

  it("passes an ADMIN-ranked user who also holds the Verifier assignment", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN", assignments: ["ADMIN", "VERIFIER"] } });
    const response = await PATCH(createRequest(), routeContext());
    expect(response.status).toBe(200);
    expect(mockCampaignUpdate).toHaveBeenCalledOnce();
  });
});
