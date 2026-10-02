import { prisma } from '@/lib/prisma';
import { notFound } from 'next/navigation';
import { ReceiptView } from '@/components/receipt/ReceiptView';

interface ReceiptPageProps {
  params: Promise<{ token: string }>;
}

/**
 * The Receipt's print page (CONTEXT.md, Receipt), reachable from the email
 * and the dashboard alike. Gated by the token alone: a Guest Donor has no
 * account to check a session against, so this page never reads one.
 */
export default async function ReceiptPage({ params }: ReceiptPageProps) {
  const { token } = await params;

  const receipt = await prisma.receipt.findUnique({
    where: { token },
    include: {
      donation: {
        include: {
          campaign: { include: { collectingEntity: true } },
          donor: { select: { id: true, name: true } },
        },
      },
    },
  });

  if (!receipt) {
    notFound();
  }

  const { donation } = receipt;
  const { campaign } = donation;

  return (
    <ReceiptView
      token={receipt.token}
      campaignTitle={campaign.title}
      collectingEntityName={campaign.collectingEntity?.name ?? ''}
      amount={donation.amount}
      // The same instant the email names (prd-compliance 19): the Receipt is
      // written with sentAt set to the provider's paidAt, and the Donor paid
      // then -- a Sumopod QRIS Donation settles at T+2, so Receipt.createdAt
      // is days later and is not a date anyone paid on. Reading createdAt here
      // is what made the printed proof disagree with the email it was
      // reached from. createdAt stays the fallback only for a Receipt written
      // before it was ever sent, which is the nullable case the column exists
      // for -- and the one the resend route falls back on too.
      paidAt={(receipt.sentAt ?? receipt.createdAt).toISOString()}
      // Both are null once the Donor is anonymised (ticket 36), so no name
      // can reach the page; `anonymised` says why there is none.
      donorName={donation.donor?.name ?? donation.guestName ?? null}
      anonymised={Boolean(donation.anonymisedAt)}
      accountOwned={Boolean(donation.donorId)}
    />
  );
}
