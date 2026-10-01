import { render, screen, cleanup, fireEvent } from "@testing-library/react";
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

  // UAT round 1: AppShell supplies <main> for every other page, but /admin
  // renders its own, and the sidebar title was a second <h1> next to each
  // page's own. The layout contributes exactly one <main> and no <h1>.
  describe("structure", () => {
    afterEach(() => cleanup());

    it("renders one main landmark and no h1 of its own", async () => {
      mockGetServerSession.mockResolvedValue({ user: { id: "ops-1", assignments: ["ADMIN"] } });
      render(await AdminLayout({ children: <h1>Judul Halaman</h1> }));

      expect(screen.getAllByRole("main")).toHaveLength(1);
      expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    });

    it("folds the navigation behind a menu button that opens and closes it", async () => {
      mockGetServerSession.mockResolvedValue({ user: { id: "ops-1", assignments: ["ADMIN"] } });
      render(await AdminLayout({ children: null }));

      const button = screen.getByRole("button", { name: /buka menu/i });
      expect(button.getAttribute("aria-expanded")).toBe("false");
      expect(document.getElementById("admin-sidebar")?.className).toContain("hidden");

      fireEvent.click(button);
      expect(button.getAttribute("aria-expanded")).toBe("true");
      expect(document.getElementById("admin-sidebar")?.className).not.toMatch(/(^| )hidden( |$)/);
    });
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

    // ticket 23 (Rilis 1, narrowed scope): the Refund create/approve queue
    // is built and tested, but stays as unreachable as the Payout queue was
    // without a nav link.
    it("links to the Refund queue", async () => {
      mockGetServerSession.mockResolvedValue({ user: { id: "ops-1", assignments: ["ADMIN"] } });
      render(await AdminLayout({ children: null }));

      const link = screen.getByRole("link", { name: /^refund$/i });
      expect(link.getAttribute("href")).toBe("/admin/refunds");
    });

    // Ticket 27: the abuse-thresholds route.ts is built and tested, but stays
    // as unreachable as the Payout queue was without a nav link.
    it("links to the Abuse Thresholds screen", async () => {
      mockGetServerSession.mockResolvedValue({ user: { id: "ops-1", assignments: ["ADMIN"] } });
      render(await AdminLayout({ children: null }));

      const link = screen.getByRole("link", { name: /ambang penyalahgunaan/i });
      expect(link.getAttribute("href")).toBe("/admin/abuse-thresholds");
    });
  });
});
