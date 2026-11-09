import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, POST } from "./route";
import { LEGAL_DOCS_VERSION } from "@/lib/site-identity";
import { NextResponse } from "next/server";

vi.mock("@/lib/auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/rate-limit-guard", () => ({ guardRoute: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    userConsent: { createMany: vi.fn() },
  },
}));

import { getServerSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { guardRoute } from "@/lib/rate-limit-guard";

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
    vi.mocked(guardRoute).mockResolvedValue(null);
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

  const both = [{ document: "TERMS" }, { document: "PRIVACY" }];

  it("GET: tanpa catatan untuk versi sekarang menunggu persetujuan, apa pun jenis akunnya", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ consents: [] } as never);
    expect(await (await GET()).json()).toEqual({ pending: true });
  });

  it("GET: hanya salah satu dokumen yang disetujui masih menunggu", async () => {
    for (const one of [[{ document: "TERMS" }], [{ document: "PRIVACY" }]]) {
      vi.mocked(prisma.user.findUnique).mockResolvedValue({ consents: one } as never);
      expect(await (await GET()).json()).toEqual({ pending: true });
    }
  });

  it("GET: kedua dokumen sudah disetujui pada versi sekarang tidak menunggu", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ consents: both } as never);
    expect(await (await GET()).json()).toEqual({ pending: false });
  });

  it("GET: menanyakan versi sekarang, jadi menaikkan versi meminta semua orang menyetujui ulang", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ consents: both } as never);
    await GET();
    const args = vi.mocked(prisma.user.findUnique).mock.calls[0][0] as unknown as {
      select: { consents: { where: { version: string } } };
    };
    expect(args.select.consents.where.version).toBe(LEGAL_DOCS_VERSION);
  });

  it("GET dan POST dibatasi lewat guardRoute per akun, dan 429 menghentikan pekerjaan", async () => {
    vi.mocked(guardRoute).mockResolvedValue(NextResponse.json({ error: "x" }, { status: 429 }));
    expect((await GET()).status).toBe(429);
    expect((await post({ acceptTerms: true, acceptPrivacy: true })).status).toBe(429);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.userConsent.createMany).not.toHaveBeenCalled();
    const scopes = vi.mocked(guardRoute).mock.calls.map((c) => c[0]);
    expect(scopes[0]).toMatchObject({ scope: "user-consent-get", subject: "user-1", onUnavailable: "open" });
    expect(scopes[1]).toMatchObject({ scope: "user-consent-post", subject: "user-1", onUnavailable: "open" });
  });
});
