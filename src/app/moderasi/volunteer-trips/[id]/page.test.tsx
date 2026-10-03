import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";

vi.mock("@/lib/auth", () => ({ getServerSession: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { volunteerTrip: { findUnique: vi.fn() } },
}));

import { render, screen, cleanup } from "@testing-library/react";
import { getServerSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import ModerasiVolunteerTripPage, { dynamic } from "./page";

const mockSession = getServerSession as unknown as Mock;
const findUnique = prisma.volunteerTrip.findUnique as unknown as Mock;

function trip(overrides: Record<string, unknown> = {}) {
  return {
    id: "trip-1",
    title: "Mengajar di Sumba",
    description: "Mengajar anak SD",
    story: "Cerita perjalanan",
    destination: "Sumba Timur",
    itinerary: "Hari 1: tiba",
    tripFeeAmount: 1_500_000,
    status: "SUBMITTED",
    fundraiserId: "fundraiser-1",
    fundraiser: { name: "Siti Fundraiser" },
    batches: [
      {
        id: "b1",
        startDate: new Date("2026-11-01T00:00:00Z"),
        endDate: new Date("2026-11-07T00:00:00Z"),
        registrationDeadline: new Date("2026-10-20T00:00:00Z"),
        minQuota: 5,
        maxQuota: 20,
      },
    ],
    ...overrides,
  };
}

const renderPage = async (id = "trip-1") =>
  render(await ModerasiVolunteerTripPage({ params: Promise.resolve({ id }) }));

describe("ModerasiVolunteerTripPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue({ user: { id: "verifier-1", assignments: ["VERIFIER"] } });
    findUnique.mockResolvedValue(trip());
  });
  afterEach(cleanup);

  it("is force-dynamic", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("redirects home without the VERIFIER assignment", async () => {
    mockSession.mockResolvedValue({ user: { id: "a", assignments: [] } });
    await expect(renderPage()).rejects.toThrow("NEXT_REDIRECT:/");
  });

  it("is not found for an unknown Trip", async () => {
    findUnique.mockResolvedValue(null);
    await expect(renderPage("nope")).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("shows the frozen content, the Batches, and the decision buttons", async () => {
    await renderPage();
    expect(screen.getByRole("heading", { name: "Mengajar di Sumba" })).toBeDefined();
    expect(screen.getByText(/Siti Fundraiser/)).toBeDefined();
    expect(screen.getByText("Sumba Timur")).toBeDefined();
    expect(screen.getByText("Hari 1: tiba")).toBeDefined();
    expect(screen.getByText("Cerita perjalanan")).toBeDefined();
    expect(screen.getByText(/Rp\s?1\.500\.000/)).toBeDefined();
    expect(screen.getByText(/kuota 5.*20/)).toBeDefined();
    expect(screen.getByText(/tidak dapat diubah/i)).toBeDefined();
    expect(screen.getByRole("button", { name: /Loloskan/ })).toBeDefined();
    expect(screen.getByRole("button", { name: /Tolak/ })).toBeDefined();
  });

  it("hints that a Verifier does not decide their own Trip, and still leaves the rule to the server", async () => {
    findUnique.mockResolvedValue(trip({ fundraiserId: "verifier-1" }));
    await renderPage();
    expect(screen.getByText(/Trip milik Anda sendiri/)).toBeDefined();
    expect(screen.getByRole("button", { name: /Loloskan/ })).toBeDefined();
  });

  it("offers no decision on a Trip that is no longer Submitted", async () => {
    findUnique.mockResolvedValue(trip({ status: "ACTIVE" }));
    await renderPage();
    expect(screen.getByText(/tidak lagi menunggu keputusan/)).toBeDefined();
    expect(screen.queryByRole("button", { name: /Loloskan/ })).toBeNull();
  });
});
