import { prisma } from '@/lib/prisma';
import type { PrismaClient } from '@/generated/prisma/client';
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
 * Create a notification for a confirmed Trip Fee registration. Sibling of
 * notifyDonationConfirmed -- only the Volunteer is notified (unlike a
 * Donation, there is no second party to notify on every single
 * registration; the Fundraiser is not notified per-registration in this
 * ticket's scope).
 */
export async function notifyRegistrationConfirmed(params: {
  volunteerId: string;
  tripSlug: string;
  tripTitle: string;
  amount: number;
}) {
  const { volunteerId, tripSlug, tripTitle, amount } = params;

  await prisma.notification.create({
    data: {
      type: 'registration_confirmed',
      title: 'Registrasi Berhasil',
      message: `Registrasi Anda untuk "${tripTitle}" sebesar ${formatRupiah(amount)} telah berhasil dikonfirmasi`,
      userId: volunteerId,
      link: `/volunteer-trip/${tripSlug}`,
    },
  });
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

/**
 * Tell a registered Donor that their payment attempt lapsed (PKS pasal
 * 3.10(1)). A Guest Donor has no inbox, so donorId null creates nothing.
 * Callers invoke it only from the branch that actually moved the Payment out
 * of PENDING, so a duplicate callback never produces a second notification.
 */
export async function notifyPaymentLapsed(params: {
  donorId: string | null;
  campaignId: string;
  campaignTitle: string;
  amount: number;
  outcome: 'expired' | 'failed';
}) {
  const { donorId, campaignId, campaignTitle, amount, outcome } = params;
  if (!donorId) return;

  const expired = outcome === 'expired';
  await prisma.notification.create({
    data: {
      type: expired ? 'payment_expired' : 'payment_failed',
      title: expired ? 'Pembayaran Kedaluwarsa' : 'Pembayaran Gagal',
      message: expired
        ? `Pembayaran donasi ${formatRupiah(amount)} untuk "${campaignTitle}" kedaluwarsa. Jika saldo Anda sudah terpotong, pembayaran akan tetap tercatat otomatis; Anda juga bisa mencoba berdonasi lagi.`
        : `Pembayaran donasi ${formatRupiah(amount)} untuk "${campaignTitle}" gagal. Jika saldo Anda sudah terpotong, pembayaran akan tetap tercatat otomatis; Anda juga bisa mencoba berdonasi lagi.`,
      userId: donorId,
      link: `/campaign/${campaignId}`,
    },
  });
}

/**
 * Tell a registered Donor that their Refund has been transferred (PKS pasal
 * 3.10(1)). Takes the client explicitly because completeRefund receives its
 * own PrismaClient; a Guest or anonymised Donor (donorId null) creates nothing.
 */
export async function notifyRefundCompleted(
  client: Pick<PrismaClient, 'notification'>,
  params: { donorId: string | null; campaignId: string; amount: number },
) {
  const { donorId, campaignId, amount } = params;
  if (!donorId) return;

  await client.notification.create({
    data: {
      type: 'refund_completed',
      title: 'Refund Selesai',
      message: `Dana sebesar ${formatRupiah(amount)} telah dikembalikan ke rekening Anda.`,
      userId: donorId,
      link: `/campaign/${campaignId}`,
    },
  });
}

/**
 * Tell an account holder that their second factor changed (pks-pemenuhan/03):
 * it was enabled, or the backup codes were replaced. The wording is the point:
 * if it was not them, they must reach an Admin, since a stolen password plus a
 * fresh enrolment is exactly how an attacker would plant their own factor.
 */
export async function notifyMfaChange(
  client: Pick<PrismaClient, 'notification'>,
  params: { userId: string; kind: 'enabled' | 'backup_codes_regenerated' },
) {
  const enabled = params.kind === 'enabled';
  await client.notification.create({
    data: {
      type: 'mfa_changed',
      title: enabled ? 'Autentikasi Dua Faktor Diaktifkan' : 'Kode Cadangan Autentikasi Diganti',
      message: enabled
        ? 'Autentikasi dua faktor baru saja diaktifkan pada akun Anda. Jika ini bukan Anda, segera hubungi Admin.'
        : 'Kode cadangan autentikasi dua faktor akun Anda baru saja dibuat ulang. Jika ini bukan Anda, segera hubungi Admin.',
      userId: params.userId,
      link: '/akun/keamanan',
    },
  });
}
