import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

vi.mock("@/lib/auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

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
    mockGetServerSession.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN", assignments: [] } });
    await expect(ModerasiLayout({ children: null })).rejects.toThrow("NEXT_REDIRECT:/");
  });

  it("renders for a user who holds the Verifier assignment", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "mod-1", role: "MODERATOR", assignments: ["VERIFIER"] } });
    const result = await ModerasiLayout({ children: null });
    expect(result).toBeDefined();
  });
});
