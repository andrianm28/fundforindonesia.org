import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "./route";

// Mock prisma
vi.mock("@/lib/prisma", () => ({
  prisma: {
    autoDonation: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
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
const mockedFindMany = vi.mocked(prisma.autoDonation.findMany);
const mockedFindFirst = vi.mocked(prisma.autoDonation.findFirst);
const mockedCreate = vi.mocked(prisma.autoDonation.create);
const mockedUpdate = vi.mocked(prisma.autoDonation.update);

function createPostRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/auto-donations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const mockSession = {
  user: { id: "user-1", name: "Test", email: "test@test.com" },
  expires: "2099-01-01",
} as any;

describe("GET /api/auto-donations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 if user is not authenticated", async () => {
    mockedGetServerSession.mockResolvedValue(null);

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe("Anda harus login terlebih dahulu");
  });

  it("returns user auto-donations", async () => {
    mockedGetServerSession.mockResolvedValue(mockSession);
    mockedFindMany.mockResolvedValue([
      {
        id: "ad-1",
        amount: 10000,
        category: "bencana-alam",
        schedule: "daily",
        time: "05:00",
        isActive: true,
        userId: "user-1",
        createdAt: new Date("2024-01-01"),
      },
    ]);

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.autoDonations).toHaveLength(1);
    expect(data.autoDonations[0].amount).toBe(10000);
    expect(mockedFindMany).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      orderBy: { createdAt: "desc" },
    });
  });

  it("returns empty array when no auto-donations exist", async () => {
    mockedGetServerSession.mockResolvedValue(mockSession);
    mockedFindMany.mockResolvedValue([]);

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.autoDonations).toHaveLength(0);
    expect(data.settings).toBeNull();
  });
});

describe("POST /api/auto-donations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 if user is not authenticated", async () => {
    mockedGetServerSession.mockResolvedValue(null);

    const request = createPostRequest({
      amount: 10000,
      category: "bencana-alam",
      schedule: "daily",
      time: "05:00",
    });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe("Anda harus login terlebih dahulu");
  });

  it("returns 400 if amount is missing", async () => {
    mockedGetServerSession.mockResolvedValue(mockSession);

    const request = createPostRequest({
      category: "bencana-alam",
      schedule: "daily",
      time: "05:00",
    });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("Validasi gagal");
  });

  it("returns 400 if amount is below minimum", async () => {
    mockedGetServerSession.mockResolvedValue(mockSession);

    const request = createPostRequest({
      amount: 500,
      category: "bencana-alam",
      schedule: "daily",
      time: "05:00",
    });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("Validasi gagal");
  });

  it("returns 400 if schedule is invalid", async () => {
    mockedGetServerSession.mockResolvedValue(mockSession);

    const request = createPostRequest({
      amount: 10000,
      category: "bencana-alam",
      schedule: "monthly",
      time: "05:00",
    });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("Validasi gagal");
  });

  it("returns 400 if time format is invalid", async () => {
    mockedGetServerSession.mockResolvedValue(mockSession);

    const request = createPostRequest({
      amount: 10000,
      category: "bencana-alam",
      schedule: "daily",
      time: "25:00",
    });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("Validasi gagal");
  });

  it("returns 400 if time format is not HH:mm", async () => {
    mockedGetServerSession.mockResolvedValue(mockSession);

    const request = createPostRequest({
      amount: 10000,
      category: "bencana-alam",
      schedule: "daily",
      time: "5:00",
    });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("Validasi gagal");
  });

  it("creates a new auto-donation when none exists", async () => {
    mockedGetServerSession.mockResolvedValue(mockSession);
    mockedFindFirst.mockResolvedValue(null);
    mockedCreate.mockResolvedValue({
      id: "ad-1",
      amount: 10000,
      category: "bencana-alam",
      schedule: "daily",
      time: "05:00",
      isActive: true,
      userId: "user-1",
      createdAt: new Date("2024-01-01"),
    });

    const request = createPostRequest({
      amount: 10000,
      category: "bencana-alam",
      schedule: "daily",
      time: "05:00",
    });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.autoDonation.amount).toBe(10000);
    expect(data.autoDonation.schedule).toBe("daily");
    expect(mockedCreate).toHaveBeenCalledWith({
      data: {
        amount: 10000,
        category: "bencana-alam",
        schedule: "daily",
        time: "05:00",
        userId: "user-1",
      },
    });
  });

  it("updates existing auto-donation when one exists", async () => {
    mockedGetServerSession.mockResolvedValue(mockSession);
    mockedFindFirst.mockResolvedValue({
      id: "ad-1",
      amount: 10000,
      category: "bencana-alam",
      schedule: "daily",
      time: "05:00",
      isActive: true,
      userId: "user-1",
      createdAt: new Date("2024-01-01"),
    });
    mockedUpdate.mockResolvedValue({
      id: "ad-1",
      amount: 50000,
      category: "kesehatan",
      schedule: "weekly",
      time: "08:30",
      isActive: true,
      userId: "user-1",
      createdAt: new Date("2024-01-01"),
    });

    const request = createPostRequest({
      amount: 50000,
      category: "kesehatan",
      schedule: "weekly",
      time: "08:30",
    });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.autoDonation.amount).toBe(50000);
    expect(data.autoDonation.schedule).toBe("weekly");
  });
});
