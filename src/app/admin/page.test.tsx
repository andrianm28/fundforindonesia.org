import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

vi.mock("@/lib/auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { count: vi.fn().mockResolvedValue(3) },
    campaign: { count: vi.fn().mockResolvedValue(2) },
    donation: { count: vi.fn().mockResolvedValue(1) },
  },
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

import { getServerSession } from "@/lib/auth";
import AdminDashboardPage from "./page";

const mockGetServerSession = getServerSession as unknown as Mock;

describe("AdminDashboardPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects home when unauthenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);
    await expect(AdminDashboardPage()).rejects.toThrow("NEXT_REDIRECT:/");
  });

  it("redirects home for someone with the ADMIN Role but not the ADMIN assignment", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "admin-1", assignments: [] } });
    await expect(AdminDashboardPage()).rejects.toThrow("NEXT_REDIRECT:/");
  });

  it("renders for someone holding the ADMIN assignment without the ADMIN Role", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "ops-1", assignments: ["ADMIN"] } });
    const result = await AdminDashboardPage();
    expect(result).toBeDefined();
  });
});
