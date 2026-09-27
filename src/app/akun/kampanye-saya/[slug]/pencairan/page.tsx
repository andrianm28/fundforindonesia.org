import { redirect } from 'next/navigation';
import { getServerSession } from '@/lib/auth';
import { CampaignPayoutPanel } from '@/components/campaign/CampaignPayoutPanel';

interface PageProps {
  params: Promise<{ slug: string }>;
}

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
 * GUARDED ON THE SESSION, on the server, the way admin/page.tsx and
 * moderasi/page.tsx are. Nothing here is public, and a person who reaches this
 * URL by typing it or by an old link has to be told where to sign in rather
 * than shown the read's refusal: without the guard that arrives on screen as
 * "Gagal memuat data pencairan.", a complaint about a screen they were never
 * signed in to see, on a URL that looks broken. The guard buys that, and
 * nothing else -- the read below refuses a signed-out visitor on its own,
 * server-side, and this is the sibling pages' guard because a Fundraiser
 * reaches this page from one of them.
 *
 * GUARDED HERE RATHER THAN WITH `useSession`, which is what the other pages
 * under /akun do (akun/page.tsx, pengaturan/page.tsx, kampanye-saya/page.tsx).
 * Those are client components, and a client guard decides in the browser:
 * `useSession()` reports 'loading' during the server render and on the first
 * paint, so the whole page is withheld until it resolves and the initial HTML
 * is empty. A Fundraiser without JavaScript was looking at a white page where
 * their screen should be, on a page about their own money. The server knows
 * the session already -- it is the guard's own `getServerSession()` -- so the
 * two are the same guard decided in the one place that can put it in the HTML:
 * a session renders the screen, and no session has left for /login before a
 * byte of markup exists, which is where the browser guard was sending them
 * anyway.
 *
 * The panel fetches for itself rather than receiving figures as props, so the
 * numbers on screen are read at the moment the Fundraiser is looking at them,
 * in the browser, and the server sends only the shell around them. That read
 * moves no money: escrow release is the scheduled job's business
 * (runScheduledJobs) and the Payout request's own lazy sweep, never a page
 * load -- see the route's own comment.
 */
export default async function CampaignPayoutPage({ params }: PageProps) {
  const session = await getServerSession();

  if (!session?.user) {
    redirect('/login');
  }

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
