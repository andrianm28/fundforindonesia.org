import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}));

import { getServerSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { GET } from "./route";

const mockGetServerSession = getServerSession as unknown as Mock;
const mockFindMany = prisma.user.findMany as unknown as Mock;
const mockCount = prisma.user.count as unknown as Mock;

function createRequest(url = "http://localhost:3000/api/admin/users"): NextRequest {
  return new NextRequest(url);
}

describe("GET /api/admin/users", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue({ user: { id: "admin-1", assignments: ["ADMIN"] } });
    mockFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue(0);
  });

  it("returns 401 when unauthenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);
    const response = await GET(createRequest());
    expect(response.status).toBe(401);
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("returns 403 for a Verifier who does not hold the Admin assignment", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "mod-1", assignments: ["VERIFIER"] } });
    const response = await GET(createRequest());
    expect(response.status).toBe(403);
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("returns 403 for a user who does not hold the ADMIN assignment", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "someone-1", assignments: [] } });
    const response = await GET(createRequest());
    expect(response.status).toBe(403);
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("returns the user page when the Admin assignment is present", async () => {
    mockFindMany.mockResolvedValue([{ id: "u1", name: "A", email: "a@test.com", createdAt: new Date(), assignments: [] }]);
    mockCount.mockResolvedValue(1);

    const response = await GET(createRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.users).toHaveLength(1);
    expect(body.pagination.total).toBe(1);
  });

  // The Role hierarchy and the self-claimed verification are retired
  // (retire-role-hierarchy): the list shows what grants power, the
  // assignments, and nothing else.
  it("lists each user's assignments, and no Role or self-claimed verification", async () => {
    const createdAt = new Date("2026-09-01T00:00:00.000Z");
    mockFindMany.mockResolvedValue([
      { id: "u1", name: "Sari", email: "sari@test.com", createdAt, assignments: [{ assignment: "VERIFIER" }, { assignment: "ADMIN" }] },
      { id: "u2", name: "Budi", email: "budi@test.com", createdAt, assignments: [] },
    ]);
    mockCount.mockResolvedValue(2);

    const response = await GET(createRequest());
    const body = await response.json();

    expect(body.users).toEqual([
      { id: "u1", name: "Sari", email: "sari@test.com", createdAt: createdAt.toISOString(), assignments: ["VERIFIER", "ADMIN"] },
      { id: "u2", name: "Budi", email: "budi@test.com", createdAt: createdAt.toISOString(), assignments: [] },
    ]);
    expect(mockFindMany.mock.calls[0][0].select).toEqual({
      id: true,
      name: true,
      email: true,
      createdAt: true,
      assignments: { select: { assignment: true } },
    });
  });
});
