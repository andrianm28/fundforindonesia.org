import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isConsentPending, recordConsent } from "@/lib/consent";
import { guardRoute } from "@/lib/rate-limit-guard";
import { LEGAL_DOCS_VERSION } from "@/lib/site-identity";

/**
 * Persetujuan Syarat Layanan + Kebijakan Privasi untuk akun yang tidak lewat
 * formulir daftar: masuk dengan Google pertama kali (PKS 3.1). Hanya untuk
 * pemanggil sendiri; akun diambil dari sesi, bukan dari isian.
 *
 * GET  -> { pending }: true bila akun ini belum punya catatan untuk TERMS dan
 *         PRIVACY pada versi dokumen sekarang, apa pun jenis akunnya (Google,
 *         password, OTP). Akun lama ditanya sekali; menaikkan versi meminta
 *         semua orang menyetujui ulang.
 * POST -> mencatat kedua dokumen pada versi sekarang (idempoten).
 */
/** Per akun per jam; cukup longgar untuk satu pengecekan per sesi dan beberapa percobaan. */
const CONSENT_LIMIT = 30;
const CONSENT_WINDOW_SECONDS = 60 * 60;

/** Setelah cek sesi supaya banjir anonim tidak menulis; gagal-terbuka agar pembatas rusak tidak mengunci orang. */
function guardConsent(userId: string, method: "GET" | "POST") {
  return guardRoute(
    {
      scope: `user-consent-${method.toLowerCase()}`,
      subject: userId,
      limit: CONSENT_LIMIT,
      windowSeconds: CONSENT_WINDOW_SECONDS,
      onUnavailable: "open",
    },
    { limited: "Terlalu banyak permintaan. Coba lagi nanti." },
  );
}

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
    const refused = await guardConsent(session.user.id, "GET");
    if (refused) return refused;
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { consents: { where: { version: LEGAL_DOCS_VERSION }, select: { document: true } } },
    });
    const pending = !!user && isConsentPending(user.consents);
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

    const refused = await guardConsent(session.user.id, "POST");
    if (refused) return refused;

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
