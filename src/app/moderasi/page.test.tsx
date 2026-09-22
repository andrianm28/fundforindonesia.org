import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

vi.mock("@/lib/auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    campaign: {
      count: vi.fn(),
    },
  },
}));

import { getServerSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import ModerasiPage from "./page";

const mockGetServerSession = getServerSession as unknown as Mock;
const mockCampaignCount = prisma.campaign.count as unknown as Mock;

describe("ModerasiPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCampaignCount.mockResolvedValue(0);
  });

  it("redirects home when unauthenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);
    await expect(ModerasiPage()).rejects.toThrow("NEXT_REDIRECT:/");
    expect(mockCampaignCount).not.toHaveBeenCalled();
  });

  it("redirects home for an ADMIN-ranked user who does not hold the Verifier assignment", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN", assignments: [] } });
    await expect(ModerasiPage()).rejects.toThrow("NEXT_REDIRECT:/");
    expect(mockCampaignCount).not.toHaveBeenCalled();
  });

  it("renders for a user who holds the Verifier assignment", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "mod-1", role: "MODERATOR", assignments: ["VERIFIER"] } });
    const result = await ModerasiPage();
    expect(result).toBeDefined();
    expect(mockCampaignCount).toHaveBeenCalledOnce();
  });
});
