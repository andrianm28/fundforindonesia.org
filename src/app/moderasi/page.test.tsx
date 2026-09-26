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

import { render, screen, cleanup } from "@testing-library/react";
import { campaignRow, makeCampaignDb } from "../../../tests/support/in-memory-campaign-db";
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
    mockGetServerSession.mockResolvedValue({ user: { id: "admin-1", assignments: [] } });
    await expect(ModerasiPage()).rejects.toThrow("NEXT_REDIRECT:/");
    expect(mockCampaignCount).not.toHaveBeenCalled();
  });

  it("renders for a user who holds the Verifier assignment", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "mod-1", assignments: ["VERIFIER"] } });
    const result = await ModerasiPage();
    expect(result).toBeDefined();
    expect(mockCampaignCount).toHaveBeenCalledOnce();
  });

  it("counts only the Submitted Campaigns as awaiting review", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "mod-1", assignments: ["VERIFIER"] } });
    const db = makeCampaignDb({
      campaigns: [
        campaignRow({ id: "a", slug: "a", lifecycleStatus: "SUBMITTED" }),
        campaignRow({ id: "b", slug: "b", lifecycleStatus: "SUBMITTED" }),
        campaignRow({ id: "c", slug: "c", lifecycleStatus: "ACTIVE" }),
        campaignRow({ id: "d", slug: "d", lifecycleStatus: "DRAFT" }),
      ],
    });
    mockCampaignCount.mockImplementation((args) => db.prisma.campaign.count(args));

    render(await ModerasiPage());

    const card = screen.getByText("Kampanye Menunggu Review").parentElement!;
    expect(card.textContent).toContain("2");
    cleanup();
  });
});
