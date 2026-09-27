'use client';

import { useSession } from 'next-auth/react';
import { useParams, useRouter } from 'next/navigation';
import { useEffect } from 'react';
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
 * GUARDED ON THE SESSION, like every other page under /akun (akun/page.tsx,
 * pengaturan/page.tsx, kampanye-saya/page.tsx). Nothing here is public, and
 * a person who reaches this URL by typing it or by an old link has to be told
 * where to sign in rather than shown the read's refusal: without the guard
 * that arrives on screen as "Gagal memuat data pencairan.", a complaint about
 * a screen they were never signed in to see, on a URL that looks broken.
 * The guard buys that, and nothing else -- the read below refuses a signed-out
 * visitor on its own, server-side, and this is the sibling pages' guard
 * because a Fundraiser reaches this page from one of them.
 *
 * The panel fetches for itself rather than receiving figures as props, so the
 * numbers on screen are read at the moment the Fundraiser is looking at them.
 * That read moves no money: escrow release is the scheduled job's business
 * (runScheduledJobs) and the Payout request's own lazy sweep, never a page
 * load -- see the route's own comment.
 */
export default function CampaignPayoutPage() {
  const { status } = useSession();
  const router = useRouter();
  const params = useParams();
  const slug = typeof params.slug === 'string' ? params.slug : '';

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/login');
    }
  }, [status, router]);

  if (status === 'loading' || status === 'unauthenticated') {
    return null;
  }

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
