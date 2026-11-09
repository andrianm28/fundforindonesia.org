import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, PATCH } from "./route";
import { NextRequest } from "next/server";

// Mock dependencies
vi.mock("@/lib/auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/rate-limit-guard", () => ({ guardRoute: vi.fn() }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      update: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

import { sealUserEmail, SELECT_USER_EMAIL } from "@/lib/contact-fields";
import { getServerSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { guardRoute } from "@/lib/rate-limit-guard";
import { NextResponse } from "next/server";

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
    vi.mocked(guardRoute).mockResolvedValue(null);
  });

  it("GET profil tidak boleh disimpan cache (memuat nomor WhatsApp pemilik)", async () => {
    mockedGetServerSession.mockResolvedValue({
      user: { id: "user-1", name: "T", email: "t@test.com", assignments: [] },
      expires: "2099-01-01",
    });
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "user-1", name: "T", avatar: null, profileType: "INDIVIDUAL",
      ...sealUserEmail("t@test.com"), phoneCiphertext: null, phoneKeyId: null,
    } as never);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("PATCH dibatasi per akun lewat guardRoute dan 429 menghentikan penulisan", async () => {
    mockedGetServerSession.mockResolvedValue({
      user: { id: "user-1", name: "T", email: "t@test.com", assignments: [] },
      expires: "2099-01-01",
    });
    vi.mocked(guardRoute).mockResolvedValue(NextResponse.json({ error: "x" }, { status: 429 }));
    const res = await PATCH(createRequest({ name: "Budi" }));
    expect(res.status).toBe(429);
    expect(mockedUserUpdate).not.toHaveBeenCalled();
    expect(vi.mocked(guardRoute).mock.calls[0][0]).toMatchObject({
      scope: "user-profile-patch", subject: "user-1", onUnavailable: "open",
    });
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
      select: expect.objectContaining({ id: true, name: true, avatar: true, ...SELECT_USER_EMAIL }),
    });
  });

  // Tiket 07 (PKS 3.1): WhatsApp tersimpan terenkripsi dan bisa diubah.
  describe("WhatsApp dan jenis profil", () => {
    const session = {
      user: { id: "user-1", name: "Test", email: "test@test.com", assignments: [] },
      expires: "2099-01-01",
    };

    it("menyimpan WhatsApp hanya sebagai ciphertext dan menjawab dengan nomor yang didekripsi", async () => {
      mockedGetServerSession.mockResolvedValue(session);
      mockedUserUpdate.mockImplementation((async (args: { data: Record<string, unknown> }) => ({
        id: "user-1",
        name: "Test",
        avatar: null,
        profileType: "INDIVIDUAL",
        ...sealUserEmail("test@test.com"),
        phoneCiphertext: args.data.phoneCiphertext,
        phoneKeyId: args.data.phoneKeyId,
      })) as never);

      const response = await PATCH(createRequest({ whatsapp: "+62 812-3456-7890" }));
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.user.whatsapp).toBe("6281234567890");
      const written = mockedUserUpdate.mock.calls[0][0].data as Record<string, unknown>;
      expect(JSON.stringify(written)).not.toContain("6281234567890");
      expect(written).not.toHaveProperty("phone");
      expect(written.phoneCiphertext).toEqual(expect.any(String));
    });

    it("mengosongkan nomor bila string kosong", async () => {
      mockedGetServerSession.mockResolvedValue(session);
      mockedUserUpdate.mockResolvedValue({
        id: "user-1", name: "Test", avatar: null, profileType: "INDIVIDUAL",
        ...sealUserEmail("test@test.com"), phoneCiphertext: null, phoneKeyId: null,
      } as never);

      const response = await PATCH(createRequest({ whatsapp: "" }));

      expect(response.status).toBe(200);
      expect((await response.json()).user.whatsapp).toBeNull();
      expect(mockedUserUpdate.mock.calls[0][0].data).toEqual({ phoneCiphertext: null, phoneKeyId: null });
    });

    it("menolak nomor non-Indonesia", async () => {
      mockedGetServerSession.mockResolvedValue(session);
      const response = await PATCH(createRequest({ whatsapp: "555-1234" }));
      expect(response.status).toBe(400);
      expect((await response.json()).fieldErrors.whatsapp).toBeDefined();
      expect(mockedUserUpdate).not.toHaveBeenCalled();
    });

    it("mengubah jenis profil, dan menolak nilai lain", async () => {
      mockedGetServerSession.mockResolvedValue(session);
      mockedUserUpdate.mockResolvedValue({
        id: "user-1", name: "Test", avatar: null, profileType: "ORGANISATION",
        ...sealUserEmail("test@test.com"), phoneCiphertext: null, phoneKeyId: null,
      } as never);

      const ok = await PATCH(createRequest({ profileType: "ORGANISATION" }));
      expect((await ok.json()).user.profileType).toBe("ORGANISATION");
      expect(mockedUserUpdate.mock.calls[0][0].data).toEqual({ profileType: "ORGANISATION" });

      const bad = await PATCH(createRequest({ profileType: "ADMIN" }));
      expect(bad.status).toBe(400);
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
    } as never);

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
    } as never);

    const response = await PATCH(createRequest({ name: exactName }));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.user.name).toBe(exactName);
  });
});
