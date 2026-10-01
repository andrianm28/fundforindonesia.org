import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";

vi.mock("@/lib/auth", () => ({ getServerSession: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { volunteerTrip: { findMany: vi.fn() } },
}));

import { render, screen, cleanup } from "@testing-library/react";
import { getServerSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import ModerasiVolunteerTripsPage, { dynamic } from "./page";

const mockSession = getServerSession as unknown as Mock;
const findMany = prisma.volunteerTrip.findMany as unknown as Mock;

function trip(overrides: Record<string, unknown> = {}) {
  return {
    id: "trip-1",
    title: "Mengajar di Sumba",
    destination: "Sumba Timur",
    tripFeeAmount: 1_500_000,
    createdAt: new Date("2026-09-20T00:00:00Z"),
    fundraiser: { name: "Siti Fundraiser" },
    ...overrides,
  };
}

describe("ModerasiVolunteerTripsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue({ user: { id: "verifier-1", assignments: ["VERIFIER"] } });
    findMany.mockResolvedValue([]);
  });
  afterEach(cleanup);

  it("is force-dynamic because it reads the database", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("redirects home without the VERIFIER assignment", async () => {
    mockSession.mockResolvedValue({ user: { id: "a", assignments: ["ADMIN"] } });
    await expect(ModerasiVolunteerTripsPage()).rejects.toThrow("NEXT_REDIRECT:/");
    mockSession.mockResolvedValue(null);
    await expect(ModerasiVolunteerTripsPage()).rejects.toThrow("NEXT_REDIRECT:/");
  });

  it("says nothing is waiting when no Trip is SUBMITTED", async () => {
    render(await ModerasiVolunteerTripsPage());
    expect(screen.getByText(/Tidak ada Volunteer Trip yang menunggu/)).toBeDefined();
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: "SUBMITTED" }, orderBy: { createdAt: "asc" } }),
    );
  });

  it("lists each Submitted Trip with its Fundraiser and a link to its detail page", async () => {
    findMany.mockResolvedValue([
      trip(),
      trip({ id: "trip-2", title: "Menanam Mangrove", fundraiser: { name: "Budi" } }),
    ]);
    render(await ModerasiVolunteerTripsPage());
    expect(screen.getByText(/Siti Fundraiser/)).toBeDefined();
    expect(screen.getAllByText(/Rp\s?1\.500\.000/)).toHaveLength(2);
    expect(screen.getByRole("link", { name: /Mengajar di Sumba/ }).getAttribute("href")).toBe(
      "/moderasi/volunteer-trips/trip-1",
    );
    expect(screen.getByRole("link", { name: /Menanam Mangrove/ }).getAttribute("href")).toBe(
      "/moderasi/volunteer-trips/trip-2",
    );
  });
});
