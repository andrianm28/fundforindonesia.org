import { describe, it, expect, vi, beforeEach } from "vitest";
import { PATCH } from "./route";
import { NextRequest } from "next/server";

// Mock dependencies
vi.mock("@/lib/auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      update: vi.fn(),
    },
  },
}));

import { sealUserEmail, SELECT_USER_EMAIL } from "@/lib/contact-fields";
import { getServerSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const mockedGetServerSession = vi.mocked(getServerSession);
const mockedUserUpdate = vi.mocked(prisma.user.update);

function createRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/user/profile", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/user/profile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    mockedGetServerSession.mockResolvedValue(null);

    const response = await PATCH(createRequest({ name: "Test" }));
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe("Unauthorized");
  });

  it("returns 400 when name is too short (less than 2 chars)", async () => {
    mockedGetServerSession.mockResolvedValue({
      user: { id: "user-1", name: "Test", email: "test@test.com", assignments: [] },
      expires: "2099-01-01",
    });

    const response = await PATCH(createRequest({ name: "A" }));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("Validasi gagal");
    expect(data.fieldErrors.name).toBeDefined();
  });

  it("returns 400 when name exceeds 50 characters", async () => {
    mockedGetServerSession.mockResolvedValue({
      user: { id: "user-1", name: "Test", email: "test@test.com", assignments: [] },
      expires: "2099-01-01",
    });

    const longName = "A".repeat(51);
    const response = await PATCH(createRequest({ name: longName }));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("Validasi gagal");
    expect(data.fieldErrors.name).toBeDefined();
  });

  it("returns 400 when name field is missing", async () => {
    mockedGetServerSession.mockResolvedValue({
      user: { id: "user-1", name: "Test", email: "test@test.com", assignments: [] },
      expires: "2099-01-01",
    });

    const response = await PATCH(createRequest({}));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("Validasi gagal");
  });

  it("updates user name and returns updated user on valid input", async () => {
    mockedGetServerSession.mockResolvedValue({
      user: { id: "user-1", name: "Old Name", email: "test@test.com", assignments: [] },
      expires: "2099-01-01",
    });

    mockedUserUpdate.mockResolvedValue({
      id: "user-1",
      name: "New Name",
      avatar: null,
      ...sealUserEmail("test@test.com"),
    } as any);

    const response = await PATCH(createRequest({ name: "New Name" }));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.user.name).toBe("New Name");
    expect(data.user.id).toBe("user-1");
    // Decrypted for the response, from the two columns the query asked for
    // (ADR 0012).
    expect(data.user.email).toBe("test@test.com");
    expect(data.user.emailCiphertext).toBeUndefined();
    expect(mockedUserUpdate).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { name: "New Name" },
      select: { id: true, name: true, avatar: true, ...SELECT_USER_EMAIL },
    });
  });

  it("accepts name with exactly 2 characters", async () => {
    mockedGetServerSession.mockResolvedValue({
      user: { id: "user-1", name: "Test", email: "test@test.com", assignments: [] },
      expires: "2099-01-01",
    });

    mockedUserUpdate.mockResolvedValue({
      id: "user-1",
      name: "Ab",
      avatar: null,
      ...sealUserEmail("test@test.com"),
    } as any);

    const response = await PATCH(createRequest({ name: "Ab" }));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.user.name).toBe("Ab");
  });

  it("accepts name with exactly 50 characters", async () => {
    mockedGetServerSession.mockResolvedValue({
      user: { id: "user-1", name: "Test", email: "test@test.com", assignments: [] },
      expires: "2099-01-01",
    });

    const exactName = "A".repeat(50);
    mockedUserUpdate.mockResolvedValue({
      id: "user-1",
      name: exactName,
      avatar: null,
      ...sealUserEmail("test@test.com"),
    } as any);

    const response = await PATCH(createRequest({ name: exactName }));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.user.name).toBe(exactName);
  });
});
