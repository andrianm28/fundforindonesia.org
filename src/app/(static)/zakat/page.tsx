import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { KindLanding } from '@/components/landing/KindLanding';
import { ZakatCalculator } from '@/components/zakat/ZakatCalculator';
import { prisma } from '@/lib/prisma';
import { resolveZakatCheckout } from '@/lib/zakat';

export const metadata: Metadata = {
  title: 'Zakat - Fund for Indonesia',
  description:
    'Hitung zakat penghasilan dan zakat maal, lalu bayarkan lewat lembaga penerima zakat yang ditetapkan. Tanda terima elektronik dikirim ke email Anda.',
};

// The module's switch is read per request (the Docker build has no database).
export const dynamic = 'force-dynamic';

/**
 * Halaman zakat (PKS pemenuhan 19, ADR 0028). Only exists while an Admin has
 * switched the zakat module on: the proxy answers a literal 404 before this
 * renders, and this page asks again (defense in depth), so a stale cache or a
 * direct render never shows it. Payment is the ordinary donation page of the
 * zakat Campaign; nothing is collected here.
 */
export default async function ZakatPage() {
  const checkout = await resolveZakatCheckout(prisma, new Date());
  if (checkout === null) notFound();

  return (
    <KindLanding
      title="Zakat"
      intro="Hitung zakat penghasilan atau zakat maal Anda, lalu bayarkan lewat lembaga penerima zakat yang ditetapkan Fund for Indonesia. Pembayaran memakai jalur yang sama dengan donasi, dengan tanda terima elektronik berlabel zakat."
      status={`Zakat yang dibayar di sini diterima oleh ${checkout.recipientName || 'lembaga penerima yang ditetapkan'}, lembaga yang memegang izin pengumpulan dan Kind Authorisation zakat dari Verifier kami. Fund for Indonesia menyediakan sarana pembayaran dan pencatatan; penyaluran kepada mustahik dilakukan oleh lembaga penerima dan dicatat di sistem ini.`}
      sections={[
        {
          heading: 'Hitung zakat Anda',
          body: (
            <ZakatCalculator
              nisabAmount={checkout.nisabAmount}
              campaignSlug={checkout.campaign?.slug ?? null}
              recipientName={checkout.recipientName}
            />
          ),
        },
        {
          heading: 'Catatan',
          body: (
            <p>
              Kalkulator ini alat bantu hitung, bukan fatwa. Nisab diatur oleh tim kami dan diperbarui mengikuti harga
              emas; tarifnya 2,5%. Bila ragu, tanyakan kepada ulama atau lembaga zakat tepercaya. Nominal yang Anda bayar
              boleh berbeda dari hasil hitung.
            </p>
          ),
        },
      ]}
    />
  );
}
