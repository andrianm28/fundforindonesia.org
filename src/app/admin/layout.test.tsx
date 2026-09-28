import { render, screen, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";

vi.mock("@/lib/auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

import { getServerSession } from "@/lib/auth";
import AdminLayout from "./layout";

const mockGetServerSession = getServerSession as unknown as Mock;

describe("AdminLayout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects home when unauthenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);
    await expect(AdminLayout({ children: null })).rejects.toThrow("NEXT_REDIRECT:/");
  });

  it("redirects home for someone with the ADMIN Role but not the ADMIN assignment", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "admin-1", assignments: [] } });
    await expect(AdminLayout({ children: null })).rejects.toThrow("NEXT_REDIRECT:/");
  });

  it("redirects home for a Verifier: the VERIFIER assignment is not Admin", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "ver-1", assignments: ["VERIFIER"] } });
    await expect(AdminLayout({ children: null })).rejects.toThrow("NEXT_REDIRECT:/");
  });

  it("renders for someone holding the ADMIN assignment without the ADMIN Role", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "ops-1", assignments: ["ADMIN"] } });
    const result = await AdminLayout({ children: null });
    expect(result).toBeDefined();
  });

  describe("nav", () => {
    afterEach(() => cleanup());

    // Ticket 21 (map.md, "No Admin panel for Payouts"): a screen does not
    // count unless something points a person at it -- a Payout queue with
    // no nav link is unreachable the same way the routes it now uses
    // already were.
    it("links to the Payout queue", async () => {
      mockGetServerSession.mockResolvedValue({ user: { id: "ops-1", assignments: ["ADMIN"] } });
      render(await AdminLayout({ children: null }));

      const link = screen.getByRole("link", { name: /payout|pencairan/i });
      expect(link.getAttribute("href")).toBe("/admin/payouts");
    });

    // ticket 25 (map.md FFI-07b: "Layar Admin menjatuhkan/mencabut
    // Suspension" -- 0 hasil): the backend is built and tested, but with no
    // nav link it stays as unreachable as the Payout queue was.
    it("links to the Suspension & Cancellation queue", async () => {
      mockGetServerSession.mockResolvedValue({ user: { id: "ops-1", assignments: ["ADMIN"] } });
      render(await AdminLayout({ children: null }));

      const link = screen.getByRole("link", { name: /suspension|cancellation/i });
      expect(link.getAttribute("href")).toBe("/admin/campaigns/lifecycle");
    });

    // Ticket 24: the 60-day Dormant Balance report has nowhere else to be
    // seen from either -- the same "no nav link, no screen" bar the Payout
    // queue test above already holds this layout to.
    it("links to the Dormant Balance report", async () => {
      mockGetServerSession.mockResolvedValue({ user: { id: "ops-1", assignments: ["ADMIN"] } });
      render(await AdminLayout({ children: null }));

      const link = screen.getByRole("link", { name: /dormant/i });
      expect(link.getAttribute("href")).toBe("/admin/dormant-balances");
    });
  });
});
