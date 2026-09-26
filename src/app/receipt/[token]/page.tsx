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
      paidAt={receipt.createdAt.toISOString()}
      donorName={donation.donor?.name ?? donation.guestName ?? null}
    />
  );
}
