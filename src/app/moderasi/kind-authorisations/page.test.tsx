import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";

vi.mock("@/lib/auth", () => ({ getServerSession: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { partnerOrganisation: { findMany: vi.fn() } },
}));

import { render, screen, cleanup } from "@testing-library/react";
import { getServerSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import KindAuthorisationsPage, { dynamic } from "./page";

const mockGetServerSession = getServerSession as unknown as Mock;
const mockOrganisationFindMany = prisma.partnerOrganisation.findMany as unknown as Mock;

const NOW = new Date("2026-09-29T00:00:00.000Z");
const day = (offset: number) => new Date(NOW.getTime() + offset * 24 * 60 * 60 * 1000);

describe("KindAuthorisationsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    mockOrganisationFindMany.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it("is rendered per request, because it reads the database", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("redirects home when unauthenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);
    await expect(KindAuthorisationsPage()).rejects.toThrow("NEXT_REDIRECT:/");
    expect(mockOrganisationFindMany).not.toHaveBeenCalled();
  });

  it("redirects home for an Admin who does not hold the Verifier assignment", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "admin-1", assignments: ["ADMIN"] } });
    await expect(KindAuthorisationsPage()).rejects.toThrow("NEXT_REDIRECT:/");
    expect(mockOrganisationFindMany).not.toHaveBeenCalled();
  });

  it("says so when nothing is expiring or lapsed", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "v-1", assignments: ["VERIFIER"] } });
    render(await KindAuthorisationsPage());
    expect(screen.getByText(/Tidak ada Kind Authorisation/)).toBeDefined();
  });

  it("lists an expiring and a lapsed authorisation with organisation, Kind and status", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "v-1", assignments: ["VERIFIER"] } });
    mockOrganisationFindMany.mockResolvedValue([
      {
        id: "o1",
        name: "YIEM",
        kindAuthorisations: [{ id: "k1", kind: "ZAKAT", validFrom: day(-300), validTo: day(10) }],
      },
      {
        id: "o2",
        name: "Yayasan Lapas",
        kindAuthorisations: [{ id: "k2", kind: "WAKAF", validFrom: day(-400), validTo: day(-3) }],
      },
      {
        id: "o3",
        name: "Yayasan Aman",
        kindAuthorisations: [{ id: "k3", kind: "HIBAH", validFrom: day(-10), validTo: day(200) }],
      },
    ]);

    render(await KindAuthorisationsPage());

    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("Yayasan Lapas");
    expect(rows[0].textContent).toContain("Sudah lewat");
    expect(rows[1].textContent).toContain("YIEM");
    expect(rows[1].textContent).toContain("Akan berakhir");
    expect(screen.queryByText(/Yayasan Aman/)).toBeNull();
  });
});
