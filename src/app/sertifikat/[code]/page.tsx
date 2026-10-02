import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { getCertificateByCode } from '@/lib/volunteer/certificate';
import { formatWibDate } from '@/lib/volunteer/batch-dates';

/**
 * Sertifikat Keikutsertaan (ticket 37; prd-audit/issues/10): public, no
 * sign-in, readable by anyone holding the unguessable code. Shows only the
 * frozen copy on the certificate row and reads no session and no profile.
 * Printable: the Volunteer saves it as PDF from the browser. Every code the
 * database does not know, malformed or not, is the same 404.
 */
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return { title: 'Sertifikat Keikutsertaan', robots: { index: false, follow: false } };
}

interface PageProps {
  params: Promise<{ code: string }>;
}

// The app shell's own header, nav and footer are not part of the certificate.
const PRINT_CSS = '@media print { header, nav, footer { display: none !important; } @page { margin: 16mm; } }';

export default async function CertificatePage({ params }: PageProps) {
  const { code } = await params;
  const certificate = await getCertificateByCode(prisma, code);
  if (!certificate) notFound();

  return (
    <main className="max-w-2xl mx-auto px-4 py-8 print:py-0">
      <style>{PRINT_CSS}</style>
      <article className="rounded-lg border-2 border-border p-8 text-center space-y-5 print:border-black">
        <p className="text-sm uppercase tracking-widest text-text-secondary">Sertifikat Keikutsertaan</p>
        <p className="text-sm text-text-secondary">Diberikan kepada</p>
        <h1 className="text-3xl font-bold text-text">{certificate.volunteerName}</h1>
        <p className="text-text">
          atas keikutsertaannya sebagai Volunteer dalam
        </p>
        <p className="text-xl font-semibold text-text">{certificate.tripTitle}</p>
        <p className="text-text">{certificate.destination}</p>
        <p className="text-text">
          {formatWibDate(certificate.batchStartDate)} - {formatWibDate(certificate.batchEndDate)}
        </p>
        <p className="text-sm text-text-secondary">Penyelenggara: {certificate.organizerName}</p>
        <hr className="border-border" />
        <p className="text-sm text-text-secondary">
          Diterbitkan oleh Fund for Indonesia (PT Jaya Korpora Prima) atas nama penyelenggara, pada{' '}
          {formatWibDate(certificate.issuedAt)}.
        </p>
        <p className="text-xs text-text-secondary">
          Kode sertifikat: <span className="font-mono text-text">{certificate.code}</span>
        </p>
      </article>
      <p className="mt-4 text-center text-sm text-text-secondary print:hidden">
        Untuk menyimpan sebagai PDF, pilih Cetak pada browser Anda lalu &quot;Simpan sebagai PDF&quot;.
      </p>
    </main>
  );
}
