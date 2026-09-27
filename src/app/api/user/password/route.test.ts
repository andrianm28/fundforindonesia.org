import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { PATCH } from "./route";

// Mock prisma
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

// Mock auth
vi.mock("@/lib/auth", () => ({
  getServerSession: vi.fn(),
}));

// Mock bcryptjs
vi.mock("bcryptjs", () => ({
  default: {
    compare: vi.fn(),
    hash: vi.fn(),
  },
}));

import { prisma } from "@/lib/prisma";
import { getServerSession } from "@/lib/auth";
import bcrypt from "bcryptjs";
import { PASSWORD_HASH_COST } from "@/lib/password-hash-cost";

const mockedGetServerSession = vi.mocked(getServerSession);
const mockedPrismaUserFindUnique = vi.mocked(prisma.user.findUnique);
const mockedPrismaUserUpdate = vi.mocked(prisma.user.update);
const mockedBcryptCompare = vi.mocked(bcrypt.compare);
const mockedBcryptHash = vi.mocked(bcrypt.hash);

function createRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/user/password", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/user/password", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 if user is not authenticated", async () => {
    mockedGetServerSession.mockResolvedValue(null);

    const request = createRequest({
      currentPassword: "oldpass123",
      newPassword: "newpass123",
      confirmPassword: "newpass123",
    });
    const response = await PATCH(request);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe("Unauthorized");
  });

  it("returns 400 if currentPassword is missing", async () => {
    mockedGetServerSession.mockResolvedValue({
      user: { id: "user-1", name: "Test", email: "test@test.com" },
      expires: "2099-01-01",
    } as any);

    const request = createRequest({
      newPassword: "newpass123",
      confirmPassword: "newpass123",
    });
    const response = await PATCH(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("Validasi gagal");
  });

  it("returns 400 if newPassword is shorter than 8 characters", async () => {
    mockedGetServerSession.mockResolvedValue({
      user: { id: "user-1", name: "Test", email: "test@test.com" },
      expires: "2099-01-01",
    } as any);

    const request = createRequest({
      currentPassword: "oldpass123",
      newPassword: "short",
      confirmPassword: "short",
    });
    const response = await PATCH(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("Validasi gagal");
    expect(data.fieldErrors?.newPassword).toContain("Password minimal 8 karakter");
  });

  it("returns 400 if confirmPassword does not match newPassword", async () => {
    mockedGetServerSession.mockResolvedValue({
      user: { id: "user-1", name: "Test", email: "test@test.com" },
      expires: "2099-01-01",
    } as any);

    const request = createRequest({
      currentPassword: "oldpass123",
      newPassword: "newpass123",
      confirmPassword: "differentpass",
    });
    const response = await PATCH(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("Validasi gagal");
    expect(data.fieldErrors?.confirmPassword).toContain(
      "Konfirmasi password tidak cocok"
    );
  });

  it("returns 400 if user is Google-authenticated (no password)", async () => {
    mockedGetServerSession.mockResolvedValue({
      user: { id: "user-1", name: "Test", email: "test@test.com" },
      expires: "2099-01-01",
    } as any);

    mockedPrismaUserFindUnique.mockResolvedValue({
      id: "user-1",
      password: null,
    } as any);

    const request = createRequest({
      currentPassword: "oldpass123",
      newPassword: "newpass123",
      confirmPassword: "newpass123",
    });
    const response = await PATCH(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("Akun Google tidak dapat mengubah password");
  });

  it("returns 400 if current password is incorrect", async () => {
    mockedGetServerSession.mockResolvedValue({
      user: { id: "user-1", name: "Test", email: "test@test.com" },
      expires: "2099-01-01",
    } as any);

    mockedPrismaUserFindUnique.mockResolvedValue({
      id: "user-1",
      password: "$2a$10$hashedpassword",
    } as any);

    mockedBcryptCompare.mockResolvedValue(false as never);

    const request = createRequest({
      currentPassword: "wrongpassword",
      newPassword: "newpass123",
      confirmPassword: "newpass123",
    });
    const response = await PATCH(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("Password saat ini salah");
  });

  it("successfully changes password", async () => {
    mockedGetServerSession.mockResolvedValue({
      user: { id: "user-1", name: "Test", email: "test@test.com" },
      expires: "2099-01-01",
    } as any);

    mockedPrismaUserFindUnique.mockResolvedValue({
      id: "user-1",
      password: "$2a$10$hashedoldpassword",
    } as any);

    mockedBcryptCompare.mockResolvedValue(true as never);
    mockedBcryptHash.mockResolvedValue("$2a$10$hashednewpassword" as never);
    mockedPrismaUserUpdate.mockResolvedValue({} as any);

    const request = createRequest({
      currentPassword: "oldpass123",
      newPassword: "newpass123",
      confirmPassword: "newpass123",
    });
    const response = await PATCH(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.message).toBe("Password berhasil diubah");

    expect(mockedBcryptHash).toHaveBeenCalledWith("newpass123", PASSWORD_HASH_COST);
    expect(mockedPrismaUserUpdate).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { password: "$2a$10$hashednewpassword" },
    });
  });

  it("returns 404 if user is not found in DB", async () => {
    mockedGetServerSession.mockResolvedValue({
      user: { id: "user-1", name: "Test", email: "test@test.com" },
      expires: "2099-01-01",
    } as any);

    mockedPrismaUserFindUnique.mockResolvedValue(null);

    const request = createRequest({
      currentPassword: "oldpass123",
      newPassword: "newpass123",
      confirmPassword: "newpass123",
    });
    const response = await PATCH(request);
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe("User tidak ditemukan");
  });
});
