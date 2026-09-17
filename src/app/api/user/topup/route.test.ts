import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";

// Mock prisma
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: vi.fn(),
    topUp: {
      create: vi.fn(),
    },
    user: {
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
const mockedTransaction = vi.mocked(prisma.$transaction);

function createRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/user/topup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/user/topup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 if user is not authenticated", async () => {
    mockedGetServerSession.mockResolvedValue(null);

    const request = createRequest({ amount: 50000, paymentMethod: "BCA" });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe("Unauthorized");
  });

  it("returns 400 if amount is below minimum (10000)", async () => {
    mockedGetServerSession.mockResolvedValue({
      user: { id: "user-1", name: "Test", email: "test@test.com" },
      expires: "2099-01-01",
    } as any);

    const request = createRequest({ amount: 5000, paymentMethod: "BCA" });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("Validasi gagal");
    expect(data.fieldErrors.amount).toBeDefined();
  });

  it("returns 400 if amount exceeds maximum (10000000)", async () => {
    mockedGetServerSession.mockResolvedValue({
      user: { id: "user-1", name: "Test", email: "test@test.com" },
      expires: "2099-01-01",
    } as any);

    const request = createRequest({ amount: 20000000, paymentMethod: "BCA" });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("Validasi gagal");
    expect(data.fieldErrors.amount).toBeDefined();
  });

  it("returns 400 if paymentMethod is invalid", async () => {
    mockedGetServerSession.mockResolvedValue({
      user: { id: "user-1", name: "Test", email: "test@test.com" },
      expires: "2099-01-01",
    } as any);

    const request = createRequest({ amount: 50000, paymentMethod: "Bitcoin" });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("Validasi gagal");
    expect(data.fieldErrors.paymentMethod).toBeDefined();
  });

  it("returns 400 if paymentMethod is missing", async () => {
    mockedGetServerSession.mockResolvedValue({
      user: { id: "user-1", name: "Test", email: "test@test.com" },
      expires: "2099-01-01",
    } as any);

    const request = createRequest({ amount: 50000 });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("Validasi gagal");
  });

  it("returns 400 if amount is missing", async () => {
    mockedGetServerSession.mockResolvedValue({
      user: { id: "user-1", name: "Test", email: "test@test.com" },
      expires: "2099-01-01",
    } as any);

    const request = createRequest({ paymentMethod: "BCA" });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("Validasi gagal");
  });

  it("successfully creates top-up and returns 201 with topUp and balance", async () => {
    mockedGetServerSession.mockResolvedValue({
      user: { id: "user-1", name: "Test", email: "test@test.com" },
      expires: "2099-01-01",
    } as any);

    const mockTopUp = {
      id: "topup-1",
      amount: 50000,
      paymentMethod: "BCA",
      status: "confirmed",
      userId: "user-1",
      createdAt: new Date().toISOString(),
    };

    mockedTransaction.mockResolvedValue([
      mockTopUp,
      { donationBalance: 150000 },
    ]);

    const request = createRequest({ amount: 50000, paymentMethod: "BCA" });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.topUp).toEqual(mockTopUp);
    expect(data.balance).toBe(150000);
  });

  it("accepts minimum amount (10000)", async () => {
    mockedGetServerSession.mockResolvedValue({
      user: { id: "user-1", name: "Test", email: "test@test.com" },
      expires: "2099-01-01",
    } as any);

    mockedTransaction.mockResolvedValue([
      { id: "topup-2", amount: 10000, paymentMethod: "GoPay", status: "confirmed" },
      { donationBalance: 10000 },
    ]);

    const request = createRequest({ amount: 10000, paymentMethod: "GoPay" });
    const response = await POST(request);

    expect(response.status).toBe(201);
  });

  it("accepts maximum amount (10000000)", async () => {
    mockedGetServerSession.mockResolvedValue({
      user: { id: "user-1", name: "Test", email: "test@test.com" },
      expires: "2099-01-01",
    } as any);

    mockedTransaction.mockResolvedValue([
      { id: "topup-3", amount: 10000000, paymentMethod: "Mandiri", status: "confirmed" },
      { donationBalance: 10000000 },
    ]);

    const request = createRequest({ amount: 10000000, paymentMethod: "Mandiri" });
    const response = await POST(request);

    expect(response.status).toBe(201);
  });

  it("accepts all valid payment methods", async () => {
    mockedGetServerSession.mockResolvedValue({
      user: { id: "user-1", name: "Test", email: "test@test.com" },
      expires: "2099-01-01",
    } as any);

    const validMethods = ["BCA", "Mandiri", "BNI", "GoPay", "OVO", "Dana"];

    for (const method of validMethods) {
      mockedTransaction.mockResolvedValue([
        { id: `topup-${method}`, amount: 50000, paymentMethod: method, status: "confirmed" },
        { donationBalance: 50000 },
      ]);

      const request = createRequest({ amount: 50000, paymentMethod: method });
      const response = await POST(request);

      expect(response.status).toBe(201);
    }
  });

  it("returns 400 if amount is not a number", async () => {
    mockedGetServerSession.mockResolvedValue({
      user: { id: "user-1", name: "Test", email: "test@test.com" },
      expires: "2099-01-01",
    } as any);

    const request = createRequest({ amount: "50000", paymentMethod: "BCA" });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("Validasi gagal");
  });
});
