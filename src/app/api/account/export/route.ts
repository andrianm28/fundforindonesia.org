import { NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { guardRoute } from '@/lib/rate-limit-guard';
import { readUserEmail, readUserPhone, SELECT_USER_EMAIL, SELECT_USER_PHONE } from '@/lib/contact-fields';

/**
 * Salinan data pribadi milik akun yang sedang masuk (hak akses data subjek,
 * UU PDP; audit L5). Pengguna selalu dari sesi, tidak pernah dari request,
 * sehingga tidak ada cara meminta data orang lain. Profil dikembalikan dalam
 * bentuk terbaca (email dan telepon didekripsi, karena pemiliknya sudah
 * melihatnya); hash kata sandi, ciphertext, ID kunci, HMAC, dan data kontak
 * donatur tamu tidak pernah dikembalikan.
 */

/** Per akun per jam. Ekspor membaca banyak baris, jadi dibatasi ketat. */
const EXPORT_LIMIT = 5;
const EXPORT_WINDOW_SECONDS = 60 * 60;

export async function GET() {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const userId = session.user.id;

  // Gagal tertutup: data pribadi dalam jumlah besar tidak boleh keluar tanpa pembatas.
  const refused = await guardRoute(
    {
      scope: 'account-export',
      subject: userId,
      limit: EXPORT_LIMIT,
      windowSeconds: EXPORT_WINDOW_SECONDS,
      onUnavailable: 'closed',
    },
    { limited: 'Terlalu banyak permintaan unduh data. Coba lagi nanti.' },
  );
  if (refused) return refused;

  const [user, donations, campaigns] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        avatar: true,
        emailVerifiedAt: true,
        donationBalance: true,
        createdAt: true,
        assignments: { select: { assignment: true, assignedAt: true } },
        ...SELECT_USER_EMAIL,
        ...SELECT_USER_PHONE,
      },
    }),
    prisma.donation.findMany({
      where: { donorId: userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        amount: true,
        isAnonymous: true,
        paymentMethod: true,
        paymentStatus: true,
        message: true,
        createdAt: true,
        campaign: { select: { title: true, slug: true } },
      },
    }),
    prisma.campaign.findMany({
      where: { creatorId: userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        slug: true,
        title: true,
        description: true,
        story: true,
        category: true,
        kind: true,
        lifecycleStatus: true,
        targetAmount: true,
        collectedAmount: true,
        deadline: true,
        location: true,
        province: true,
        regency: true,
        beneficiaryName: true,
        beneficiaryDescription: true,
        beneficiaryCount: true,
        createdAt: true,
      },
    }),
  ]);

  if (!user) {
    return NextResponse.json({ error: 'Akun tidak ditemukan' }, { status: 404 });
  }

  const exportedAt = new Date();
  const body = {
    diekspor: exportedAt.toISOString(),
    profil: {
      id: user.id,
      name: user.name,
      email: readUserEmail(user),
      phone: readUserPhone(user),
      avatar: user.avatar,
      emailVerifiedAt: user.emailVerifiedAt,
      donationBalance: user.donationBalance,
      createdAt: user.createdAt,
    },
    donasi: donations,
    kampanye: campaigns,
    penugasan: user.assignments,
  };

  return new NextResponse(JSON.stringify(body, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="data-saya-${exportedAt.toISOString().slice(0, 10)}.json"`,
      'Cache-Control': 'no-store, private',
    },
  });
}
