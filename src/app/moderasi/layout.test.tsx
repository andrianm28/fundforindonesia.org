import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

vi.mock("@/lib/auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

import { render } from "@testing-library/react";
import { getServerSession } from "@/lib/auth";
import ModerasiLayout from "./layout";

const mockGetServerSession = getServerSession as unknown as Mock;

describe("ModerasiLayout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects home when unauthenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);
    await expect(ModerasiLayout({ children: null })).rejects.toThrow("NEXT_REDIRECT:/");
  });

  it("redirects home for an ADMIN-ranked user who does not hold the Verifier assignment", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "admin-1", assignments: [] } });
    await expect(ModerasiLayout({ children: null })).rejects.toThrow("NEXT_REDIRECT:/");
  });

  it("renders for a user who holds the Verifier assignment", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "mod-1", assignments: ["VERIFIER"] } });
    const result = await ModerasiLayout({ children: null });
    expect(result).toBeDefined();
  });

  it("links the Kind Authorisation renewal list in both the sidebar and the mobile bar", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "mod-1", assignments: ["VERIFIER"] } });
    const { container } = render(await ModerasiLayout({ children: null }));
    const links = container.querySelectorAll('a[href="/moderasi/kind-authorisations"]');
    expect(links).toHaveLength(2);
  });

  it("links the Volunteer Trip queue in both the sidebar and the mobile bar, keeping the earlier links", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "mod-1", assignments: ["VERIFIER"] } });
    const { container } = render(await ModerasiLayout({ children: null }));
    expect(container.querySelectorAll('a[href="/moderasi/volunteer-trips"]')).toHaveLength(2);
    for (const href of ["/moderasi/rekening", "/moderasi/kind-authorisations", "/moderasi/campaigns"]) {
      expect(container.querySelectorAll(`a[href="${href}"]`)).toHaveLength(2);
    }
  });

  it("styles the shell with the brand tokens, not the old blue hex or ledger gold", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "mod-1", assignments: ["VERIFIER"] } });
    const { container } = render(await ModerasiLayout({ children: null }));
    expect(container.innerHTML).not.toContain("0073E6");
    expect(container.innerHTML).not.toContain("ledger");
    expect(container.querySelector("a[href='/moderasi/reports']")?.className).toContain("hover:text-primary");
  });
});
