import { prisma } from '@/lib/prisma';
import { notFound } from 'next/navigation';
import { AkadWakafView } from '@/components/akad-wakaf/AkadWakafView';

interface AkadWakafPageProps {
  params: Promise<{ token: string }>;
}

/**
 * The Akad Wakaf's print page (CONTEXT.md, Akad Wakaf; ticket 22), reachable
 * from the Receipt email and the dashboard alike. Gated by the token alone,
 * same as the Receipt page: a Wakif with no account has no session to check
 * instead.
 */
export default async function AkadWakafPage({ params }: AkadWakafPageProps) {
  const { token } = await params;

  const akadWakaf = await prisma.akadWakaf.findUnique({
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

  if (!akadWakaf) {
    notFound();
  }

  const { donation } = akadWakaf;
  const { campaign } = donation;

  return (
    <AkadWakafView
      wakifName={donation.donor?.name ?? donation.guestName ?? null}
      amount={donation.amount}
      purpose={campaign.title}
      nazhirName={campaign.collectingEntity?.name ?? ''}
      createdAt={akadWakaf.createdAt.toISOString()}
    />
  );
}
