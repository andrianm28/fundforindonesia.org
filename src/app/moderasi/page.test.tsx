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
    verificationRequest: {
      count: vi.fn(),
    },
    partnerOrganisation: {
      findMany: vi.fn(),
    },
  },
}));

import { render, screen, cleanup } from "@testing-library/react";
import {
  campaignRow,
  makeCampaignDb,
  verificationRequestRow,
} from "../../../tests/support/in-memory-campaign-db";
import { getServerSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import ModerasiPage from "./page";

const mockGetServerSession = getServerSession as unknown as Mock;
const mockRequestCount = prisma.verificationRequest.count as unknown as Mock;
const mockOrganisationFindMany = prisma.partnerOrganisation.findMany as unknown as Mock;

describe("ModerasiPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequestCount.mockResolvedValue(0);
    mockOrganisationFindMany.mockResolvedValue([]);
  });

  it("redirects home when unauthenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);
    await expect(ModerasiPage()).rejects.toThrow("NEXT_REDIRECT:/");
    expect(mockRequestCount).not.toHaveBeenCalled();
  });

  it("redirects home for an ADMIN-ranked user who does not hold the Verifier assignment", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "admin-1", assignments: [] } });
    await expect(ModerasiPage()).rejects.toThrow("NEXT_REDIRECT:/");
    expect(mockRequestCount).not.toHaveBeenCalled();
  });

  it("renders for a user who holds the Verifier assignment", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "mod-1", assignments: ["VERIFIER"] } });
    const result = await ModerasiPage();
    expect(result).toBeDefined();
    expect(mockRequestCount).toHaveBeenCalledOnce();
  });

  it("counts only the PENDING Verification Requests as waiting for a Verifier", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "mod-1", assignments: ["VERIFIER"] } });
    const db = makeCampaignDb({
      campaigns: [
        campaignRow({ id: "a", slug: "a", lifecycleStatus: "SUBMITTED" }),
        campaignRow({ id: "b", slug: "b", lifecycleStatus: "SUBMITTED" }),
        campaignRow({ id: "c", slug: "c", lifecycleStatus: "ACTIVE" }),
        campaignRow({ id: "d", slug: "d", lifecycleStatus: "DRAFT" }),
      ],
      verificationRequests: [
        verificationRequestRow({ id: "a1", campaignId: "a" }),
        verificationRequestRow({ id: "b0", campaignId: "b", outcome: "REJECTED" }),
        verificationRequestRow({ id: "b1", campaignId: "b" }),
        verificationRequestRow({ id: "c1", campaignId: "c", outcome: "APPROVED" }),
        verificationRequestRow({ id: "d1", campaignId: "d", outcome: "WITHDRAWN" }),
      ],
    });
    mockRequestCount.mockImplementation((args) => db.prisma.verificationRequest.count(args));

    render(await ModerasiPage());

    const card = screen.getByText("Kampanye Menunggu Review").parentElement!;
    expect(card.textContent).toContain("2");
    cleanup();
  });

  it("counts and names Fundraising Permits and Kind Authorisations expiring within 30 days (prd-compliance 11)", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "mod-1", assignments: ["VERIFIER"] } });
    mockOrganisationFindMany.mockResolvedValue([
      {
        id: "partner-1",
        name: "Yayasan Contoh Peduli",
        permits: [
          {
            kinds: ["DONATION"],
            validFrom: new Date("2026-01-01T00:00:00Z"),
            validTo: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
          },
        ],
        kindAuthorisations: [
          {
            kind: "ZAKAT",
            validFrom: new Date("2026-01-01T00:00:00Z"),
            validTo: new Date(Date.now() + 400 * 24 * 60 * 60 * 1000),
          },
        ],
      },
    ]);

    render(await ModerasiPage());

    const card = screen.getByText("Izin Akan Berakhir").parentElement!;
    expect(card.textContent).toContain("1");
    expect(screen.getByText(/Yayasan Contoh Peduli.*Fundraising Permit \(Donasi\)/)).toBeDefined();
    cleanup();
  });
});
