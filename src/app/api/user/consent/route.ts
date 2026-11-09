import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { recordConsent } from "@/lib/consent";
import { LEGAL_DOCS_VERSION } from "@/lib/site-identity";

/**
 * Persetujuan Syarat Layanan + Kebijakan Privasi untuk akun yang tidak lewat
 * formulir daftar: masuk dengan Google pertama kali (PKS 3.1). Hanya untuk
 * pemanggil sendiri; akun diambil dari sesi, bukan dari isian.
 *
 * GET  -> { pending }: true bila akun ini dibuat lewat penyedia (Google) dan
 *         belum punya catatan persetujuan untuk versi dokumen sekarang.
 *         Akun password lama tanpa catatan tidak ditahan: mereka mendaftar
 *         sebelum catatan ada, dan formulir daftar kini mencatatnya.
 * POST -> mencatat kedua dokumen pada versi sekarang (idempoten).
 */
const consentSchema = z.object({
  acceptTerms: z.literal(true, { message: "Anda harus menyetujui Syarat Layanan" }),
  acceptPrivacy: z.literal(true, { message: "Anda harus menyetujui Kebijakan Privasi" }),
});

export async function GET() {
  try {
    const session = await getServerSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        accounts: { select: { id: true }, take: 1 },
        consents: { where: { version: LEGAL_DOCS_VERSION }, select: { id: true }, take: 1 },
      },
    });
    const pending = !!user && user.accounts.length > 0 && user.consents.length === 0;
    return NextResponse.json({ pending });
  } catch (error) {
    console.error("Error reading consent state:", error);
    return NextResponse.json({ error: "Gagal memuat persetujuan" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const result = consentSchema.safeParse(await request.json().catch(() => null));
    if (!result.success) {
      return NextResponse.json(
        { error: "Validasi gagal", fieldErrors: result.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    await recordConsent(prisma, session.user.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error recording consent:", error);
    return NextResponse.json({ error: "Gagal menyimpan persetujuan" }, { status: 500 });
  }
}
