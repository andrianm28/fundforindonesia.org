import { CampaignPayoutPanel } from '@/components/campaign/CampaignPayoutPanel';

/**
 * A Fundraiser's Payout screen for one of their Campaigns: what is held, what
 * they can actually withdraw, and the form to ask for it.
 *
 * Under /akun rather than on the public Campaign page, because none of this
 * is public: the balance, the payout history, and the list of bank accounts
 * money could be sent to are one person's information. The Campaign page
 * stays ISR-cached and session-free, and the public "Pencairan Dana" tab
 * keeps showing only COMPLETED Payouts, which is the public record
 * (GET /api/campaigns/[slug]/disbursements).
 *
 * The panel fetches for itself rather than receiving figures as props, so the
 * numbers on screen are read at the moment the Fundraiser is looking at them
 * -- the lazy escrow sweep in that read means a matured hold is already
 * released and the figure shown is the one a request would be judged against.
 */
export default async function CampaignPayoutPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  return (
    <div className="min-h-screen bg-[#F5F5F5] pb-20">
      <div className="bg-[#0073E6] px-4 pt-8 pb-6">
        <h1 className="text-white text-lg font-semibold">Pencairan Dana</h1>
      </div>
      <div className="max-w-2xl mx-auto px-4 py-6">
        <CampaignPayoutPanel slug={slug} />
      </div>
    </div>
  );
}
