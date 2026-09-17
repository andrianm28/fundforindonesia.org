import { prisma } from '@/lib/prisma';
import { formatRupiah } from '@/lib/utils/currency';

/**
 * Create notification for donation confirmation.
 * Notifies both the donor and campaign creator.
 *
 * Validates: Requirements 12.4, 17.3
 */
export async function notifyDonationConfirmed(params: {
  donorId: string | null;
  creatorId: string;
  campaignId: string;
  campaignTitle: string;
  amount: number;
}) {
  const { donorId, creatorId, campaignId, campaignTitle, amount } = params;
  const notifications = [];

  // Notify donor
  if (donorId) {
    notifications.push({
      type: 'donation_confirmed',
      title: 'Donasi Berhasil',
      message: `Donasi Anda sebesar ${formatRupiah(amount)} telah berhasil dikonfirmasi`,
      userId: donorId,
      link: `/campaign/${campaignId}`,
    });
  }

  // Notify campaign creator
  notifications.push({
    type: 'donation_confirmed',
    title: 'Donasi Baru',
    message: `Donasi baru sebesar ${formatRupiah(amount)} untuk campaign "${campaignTitle}"`,
    userId: creatorId,
    link: `/campaign/${campaignId}`,
  });

  if (notifications.length > 0) {
    await prisma.notification.createMany({ data: notifications });
  }
}

/**
 * Create notification for campaign update posted.
 * Notifies all donors who donated to this campaign.
 *
 * Validates: Requirements 12.4, 17.2, 17.4
 */
export async function notifyCampaignUpdate(params: {
  campaignId: string;
  campaignTitle: string;
  updateTitle: string;
}) {
  const { campaignId, campaignTitle, updateTitle } = params;

  // Get all unique donors for this campaign
  const donors = await prisma.donation.findMany({
    where: { campaignId, paymentStatus: 'confirmed', donorId: { not: null } },
    select: { donorId: true },
    distinct: ['donorId'],
  });

  const notifications = donors
    .filter((d) => d.donorId)
    .map((d) => ({
      type: 'campaign_update',
      title: 'Kabar Terbaru',
      message: `${campaignTitle}: ${updateTitle}`,
      userId: d.donorId!,
      link: `/campaign/${campaignId}`,
    }));

  if (notifications.length > 0) {
    await prisma.notification.createMany({ data: notifications });
  }
}

/**
 * Create notification for a completed payout (formerly "disbursement").
 * Notifies all donors who donated to this campaign.
 *
 * The notification's `type` stays the string "disbursement" -- that value is
 * stored in the database and read back by the inbox UI, so it is external
 * behaviour, not an internal detail this rename touches.
 *
 * Validates: Requirements 17.2, 17.3
 */
export async function notifyPayout(params: {
  campaignId: string;
  campaignTitle: string;
  amount: number;
}) {
  const { campaignId, campaignTitle, amount } = params;

  const donors = await prisma.donation.findMany({
    where: { campaignId, paymentStatus: 'confirmed', donorId: { not: null } },
    select: { donorId: true },
    distinct: ['donorId'],
  });

  const notifications = donors
    .filter((d) => d.donorId)
    .map((d) => ({
      type: 'disbursement',
      title: 'Pencairan Dana',
      message: `Pencairan dana sebesar ${formatRupiah(amount)} dari campaign "${campaignTitle}"`,
      userId: d.donorId!,
      link: `/campaign/${campaignId}`,
    }));

  if (notifications.length > 0) {
    await prisma.notification.createMany({ data: notifications });
  }
}
