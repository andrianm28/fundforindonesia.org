import { redirect } from 'next/navigation';
import { getServerSession } from '@/lib/auth';
import { CampaignUpdateForm } from '@/components/campaign/CampaignUpdateForm';

interface PageProps {
  params: Promise<{ slug: string }>;
}

/**
 * A Fundraiser's screen for writing a Kabar Terbaru on one of their
 * Campaigns. Guarded on the session on the server, like the Payout screen
 * beside it. Who may actually post is decided by the route, which answers
 * anyone but the Campaign's Fundraiser with 403; the form shows that answer.
 */
export default async function CampaignUpdatesPage({ params }: PageProps) {
  const session = await getServerSession();
  if (!session?.user) {
    redirect('/login');
  }

  const { slug } = await params;

  return (
    <div className="min-h-screen bg-bg-secondary pb-20">
      <div className="bg-[#0073E6] px-4 pt-8 pb-6">
        <h1 className="text-white text-lg font-semibold">Tulis Kabar Terbaru</h1>
      </div>
      <div className="max-w-2xl mx-auto px-4 py-6">
        <CampaignUpdateForm slug={slug} />
      </div>
    </div>
  );
}
