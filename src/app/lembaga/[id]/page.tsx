import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { publicUrl } from '@/lib/public-url';
import { KIND_LABEL } from '@/lib/campaign-kind';
import { getOrganisationProfile, type PermitState } from '@/lib/organisation-profile';
import { formatWibDate } from '@/lib/volunteer/batch-dates';

/**
 * Public profile of a Partner Organisation (PKS Pasal 12(5)): who collects
 * the money, under which Fundraising Permit, and for which Campaigns. Public
 * fields only (name, permit number, issuer, validity, status, active
 * Campaigns); never documents, contacts or bank accounts. The permits are
 * shown as stored and each is labelled by its status, so a lapsed one is
 * plainly marked.
 */
export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const profile = await getOrganisationProfile(prisma, id, new Date());
  if (!profile) return { title: 'Lembaga Tidak Ditemukan' };
  return {
    title: `${profile.name} - Fund for Indonesia`,
    description: `Profil lembaga ${profile.name}: nomor izin penghimpunan dan kampanye aktif.`,
    alternates: { canonical: publicUrl(`/lembaga/${profile.id}`) },
  };
}

const STATE_LABEL: Record<PermitState, string> = {
  valid: 'Berlaku',
  expired: 'Kedaluwarsa',
  not_yet_valid: 'Belum berlaku',
};

const STATE_CLASS: Record<PermitState, string> = {
  valid: 'bg-green-100 text-green-800',
  expired: 'bg-red-100 text-red-800',
  not_yet_valid: 'bg-yellow-100 text-yellow-800',
};

export default async function OrganisationProfilePage({ params }: PageProps) {
  const { id } = await params;
  const profile = await getOrganisationProfile(prisma, id, new Date());
  if (!profile) notFound();

  return (
    <main className="max-w-2xl mx-auto px-4 py-8 space-y-8">
      <header className="space-y-2">
        <p className="text-sm text-text-secondary">Profil lembaga penghimpun</p>
        <h1 className="text-2xl font-bold text-text">{profile.name}</h1>
      </header>

      <section aria-labelledby="izin" className="space-y-3">
        <h2 id="izin" className="text-lg font-semibold text-text">
          Izin penghimpunan
        </h2>
        {profile.permitStatus === 'none' && (
          <p className="text-sm text-text-secondary">
            Belum ada nomor izin penghimpunan yang tercatat untuk lembaga ini.
          </p>
        )}
        {profile.permitStatus === 'none_valid' && (
          <p className="text-sm text-red-800">
            Lembaga ini tidak memiliki izin penghimpunan yang berlaku saat ini.
          </p>
        )}
        <ul className="space-y-3">
          {profile.permits.map((permit) => (
            <li key={permit.id} className="rounded-lg border border-border p-4 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium text-text">Nomor izin: {permit.number}</p>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded ${STATE_CLASS[permit.status]}`}>
                  {STATE_LABEL[permit.status]}
                </span>
              </div>
              <p className="text-sm text-text-secondary">Penerbit: {permit.issuer}</p>
              <p className="text-sm text-text-secondary">
                Masa berlaku: {formatWibDate(permit.validFrom)} s.d. {formatWibDate(permit.validTo)}
              </p>
              <p className="text-sm text-text-secondary">
                Jenis: {permit.kinds.map((kind) => KIND_LABEL[kind]).join(', ')}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="kampanye" className="space-y-3">
        <h2 id="kampanye" className="text-lg font-semibold text-text">
          Kampanye aktif
        </h2>
        {profile.campaigns.length === 0 ? (
          <p className="text-sm text-text-secondary">Tidak ada kampanye aktif saat ini.</p>
        ) : (
          <ul className="space-y-2">
            {profile.campaigns.map((campaign) => (
              <li key={campaign.slug}>
                <Link href={`/campaign/${campaign.slug}`} className="text-primary hover:underline">
                  {campaign.title}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
