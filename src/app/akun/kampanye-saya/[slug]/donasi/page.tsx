import { redirect } from 'next/navigation';
import { getServerSession } from '@/lib/auth';
import { CampaignDonationList } from '@/components/campaign/CampaignDonationList';

interface PageProps {
  params: Promise<{ slug: string }>;
}

/**
 * A Fundraiser's list of settled Donations on their Campaign (ticket 73).
 * Guarded on the session on the server, like ../pencairan/page.tsx; ownership
 * is enforced by the read itself (a non-owner gets 404).
 */
export default async function CampaignDonationsPage({ params }: PageProps) {
  const session = await getServerSession();
  if (!session?.user) redirect('/login');

  const { slug } = await params;

  return (
    <div className="min-h-screen bg-bg-secondary pb-20">
      <div className="bg-[#0073E6] px-4 pt-8 pb-6">
        <h1 className="text-white text-lg font-semibold">Daftar Donasi</h1>
      </div>
      <div className="max-w-2xl mx-auto px-4 py-6">
        <CampaignDonationList slug={slug} />
      </div>
    </div>
  );
}
