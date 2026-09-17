import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { PATCH, DELETE } from "./route";

// Mock prisma
vi.mock("@/lib/prisma", () => ({
  prisma: {
    autoDonation: {
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

// Mock auth
vi.mock("@/lib/auth", () => ({
  getServerSession: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { getServerSession } from "@/lib/auth";

const mockedGetServerSession = vi.mocked(getServerSession);
const mockedFindUnique = vi.mocked(prisma.autoDonation.findUnique);
const mockedUpdate = vi.mocked(prisma.autoDonation.update);
const mockedDelete = vi.mocked(prisma.autoDonation.delete);

function createPatchRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/auto-donations/ad-1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function createDeleteRequest(): NextRequest {
  return new NextRequest("http://localhost:3000/api/auto-donations/ad-1", {
    method: "DELETE",
  });
}

const mockSession = {
  user: { id: "user-1", name: "Test", email: "test@test.com" },
  expires: "2099-01-01",
} as any;

const mockAutoDonation = {
  id: "ad-1",
  amount: 10000,
  category: "bencana-alam",
  schedule: "daily",
  time: "05:00",
  isActive: true,
  userId: "user-1",
  createdAt: new Date("2024-01-01"),
};

const routeParams = { params: { id: "ad-1" } };

describe("PATCH /api/auto-donations/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 if user is not authenticated", async () => {
    mockedGetServerSession.mockResolvedValue(null);

    const request = createPatchRequest({ isActive: false });
    const response = await PATCH(request, routeParams);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe("Anda harus login terlebih dahulu");
  });

  it("returns 404 if auto-donation does not exist", async () => {
    mockedGetServerSession.mockResolvedValue(mockSession);
    mockedFindUnique.mockResolvedValue(null);

    const request = createPatchRequest({ isActive: false });
    const response = await PATCH(request, routeParams);
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe("Donasi otomatis tidak ditemukan");
  });

  it("returns 403 if user does not own the auto-donation", async () => {
    mockedGetServerSession.mockResolvedValue(mockSession);
    mockedFindUnique.mockResolvedValue({
      ...mockAutoDonation,
      userId: "other-user",
    });

    const request = createPatchRequest({ isActive: false });
    const response = await PATCH(request, routeParams);
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.error).toBe("Anda tidak memiliki akses ke donasi otomatis ini");
  });

  it("returns 400 if validation fails", async () => {
    mockedGetServerSession.mockResolvedValue(mockSession);
    mockedFindUnique.mockResolvedValue(mockAutoDonation);

    const request = createPatchRequest({ amount: -100 });
    const response = await PATCH(request, routeParams);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("Validasi gagal");
  });

  it("successfully toggles isActive", async () => {
    mockedGetServerSession.mockResolvedValue(mockSession);
    mockedFindUnique.mockResolvedValue(mockAutoDonation);
    mockedUpdate.mockResolvedValue({ ...mockAutoDonation, isActive: false });

    const request = createPatchRequest({ isActive: false });
    const response = await PATCH(request, routeParams);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.autoDonation.isActive).toBe(false);
    expect(mockedUpdate).toHaveBeenCalledWith({
      where: { id: "ad-1" },
      data: { isActive: false },
    });
  });

  it("successfully updates amount and schedule", async () => {
    mockedGetServerSession.mockResolvedValue(mockSession);
    mockedFindUnique.mockResolvedValue(mockAutoDonation);
    mockedUpdate.mockResolvedValue({
      ...mockAutoDonation,
      amount: 25000,
      schedule: "weekly",
    });

    const request = createPatchRequest({ amount: 25000, schedule: "weekly" });
    const response = await PATCH(request, routeParams);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.autoDonation.amount).toBe(25000);
    expect(data.autoDonation.schedule).toBe("weekly");
  });

  it("returns 400 for invalid time format in update", async () => {
    mockedGetServerSession.mockResolvedValue(mockSession);
    mockedFindUnique.mockResolvedValue(mockAutoDonation);

    const request = createPatchRequest({ time: "invalid" });
    const response = await PATCH(request, routeParams);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("Validasi gagal");
  });
});

describe("DELETE /api/auto-donations/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 if user is not authenticated", async () => {
    mockedGetServerSession.mockResolvedValue(null);

    const request = createDeleteRequest();
    const response = await DELETE(request, routeParams);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe("Anda harus login terlebih dahulu");
  });

  it("returns 404 if auto-donation does not exist", async () => {
    mockedGetServerSession.mockResolvedValue(mockSession);
    mockedFindUnique.mockResolvedValue(null);

    const request = createDeleteRequest();
    const response = await DELETE(request, routeParams);
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe("Donasi otomatis tidak ditemukan");
  });

  it("returns 403 if user does not own the auto-donation", async () => {
    mockedGetServerSession.mockResolvedValue(mockSession);
    mockedFindUnique.mockResolvedValue({
      ...mockAutoDonation,
      userId: "other-user",
    });

    const request = createDeleteRequest();
    const response = await DELETE(request, routeParams);
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.error).toBe("Anda tidak memiliki akses ke donasi otomatis ini");
  });

  it("successfully deletes an auto-donation", async () => {
    mockedGetServerSession.mockResolvedValue(mockSession);
    mockedFindUnique.mockResolvedValue(mockAutoDonation);
    mockedDelete.mockResolvedValue(mockAutoDonation);

    const request = createDeleteRequest();
    const response = await DELETE(request, routeParams);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.message).toBe("Donasi otomatis berhasil dihapus");
    expect(mockedDelete).toHaveBeenCalledWith({ where: { id: "ad-1" } });
  });
});
