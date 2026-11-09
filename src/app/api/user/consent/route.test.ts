import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, POST } from "./route";
import { LEGAL_DOCS_VERSION } from "@/lib/site-identity";

vi.mock("@/lib/auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    userConsent: { createMany: vi.fn() },
  },
}));

import { getServerSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const session = { user: { id: "user-1", assignments: [] }, expires: "2099-01-01" };

function post(body: unknown) {
  return POST(
    new Request("http://localhost:3000/api/user/consent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("/api/user/consent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getServerSession).mockResolvedValue(session as never);
  });

  it("401 tanpa sesi, untuk GET dan POST", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
    expect((await post({ acceptTerms: true, acceptPrivacy: true })).status).toBe(401);
    expect(prisma.userConsent.createMany).not.toHaveBeenCalled();
  });

  it("POST tanpa kedua centang ditolak dan tidak mencatat apa pun", async () => {
    for (const body of [{}, { acceptTerms: true }, { acceptTerms: true, acceptPrivacy: false }]) {
      expect((await post(body)).status).toBe(400);
    }
    expect(prisma.userConsent.createMany).not.toHaveBeenCalled();
  });

  it("POST mencatat dua dokumen dengan versi dan waktu untuk akun dari sesi", async () => {
    const res = await post({ acceptTerms: true, acceptPrivacy: true, userId: "someone-else" });
    expect(res.status).toBe(200);

    const args = vi.mocked(prisma.userConsent.createMany).mock.calls[0][0] as unknown as {
      skipDuplicates: boolean;
      data: Array<{ userId: string; document: string; version: string; acceptedAt: Date }>;
    };
    expect(args.skipDuplicates).toBe(true);
    expect(args.data.map((r) => r.document).sort()).toEqual(["PRIVACY", "TERMS"]);
    for (const row of args.data) {
      expect(row.userId).toBe("user-1");
      expect(row.version).toBe(LEGAL_DOCS_VERSION);
      expect(row.acceptedAt).toBeInstanceOf(Date);
    }
  });

  it("GET: akun Google tanpa catatan versi sekarang menunggu persetujuan", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ accounts: [{ id: "a" }], consents: [] } as never);
    expect(await (await GET()).json()).toEqual({ pending: true });
  });

  it("GET: sudah menyetujui, atau akun password lama, tidak menunggu", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ accounts: [{ id: "a" }], consents: [{ id: "c" }] } as never);
    expect(await (await GET()).json()).toEqual({ pending: false });
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ accounts: [], consents: [] } as never);
    expect(await (await GET()).json()).toEqual({ pending: false });
  });
});
