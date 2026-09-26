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
    mockGetServerSession.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN", assignments: [] } });
    await expect(AdminLayout({ children: null })).rejects.toThrow("NEXT_REDIRECT:/");
  });

  it("redirects home for a Verifier: the VERIFIER assignment is not Admin", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "ver-1", role: "MODERATOR", assignments: ["VERIFIER"] } });
    await expect(AdminLayout({ children: null })).rejects.toThrow("NEXT_REDIRECT:/");
  });

  it("renders for someone holding the ADMIN assignment without the ADMIN Role", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "ops-1", role: "DONOR", assignments: ["ADMIN"] } });
    const result = await AdminLayout({ children: null });
    expect(result).toBeDefined();
  });
});
