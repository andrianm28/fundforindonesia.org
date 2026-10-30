import type { PrismaClient } from '@/generated/prisma/client';
import { readDonationGuestEmail, readUserEmail, SELECT_DONATION_GUEST_EMAIL, SELECT_USER_EMAIL } from './contact-fields';
import { sendReportingFailure, type Mailer, type MailMessage } from './mail';
import { payoutStatusEmail } from './mail/payout-status';
import { refundOutcomeEmail } from './mail/refund-outcome';
import { suspensionEmail } from './mail/suspension';
import { tripFeeEmail } from './mail/trip-fee';
import { publicUrl } from './public-url';

/**
 * The emails PRD §7.2 asks for when money or a Campaign's standing changes
 * (ticket rilis-1-benda/68): a Payout approved or completed, a Refund
 * completed or failed, a Suspension imposed or lifted; and, for a Volunteer
 * (ticket rilis-1-benda/84), a Registration confirmed and a Trip Fee Refund
 * approved or completed.
 *
 * Each is called only AFTER the change has committed, and each reads what it
 * needs in its own query rather than in the change's transaction: a read or
 * a send that fails here must never roll back money that has already moved,
 * nor hold a subject row lock while a mail relay answers. So nothing here
 * throws. A recipient that cannot be found or read is logged as
 * `mail_skipped`, an unexpected failure as `mail_compose_failed`, and a send
 * that fails is logged by sendReportingFailure (`mail_send_failed`,
 * `mail_not_configured`), each with the record's id so an operator can
 * resend. Addresses never reach the log.
 *
 * `mailer` is for tests; callers in the app leave it out and get the
 * configured one.
 */

type Report = { mail: string } & Record<string, string>;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function composeAndSend(
  report: Report,
  compose: () => Promise<MailMessage | string | null>,
  mailer?: Mailer,
): Promise<void> {
  try {
    const composed = await compose();
    // null: nothing is owed to anyone, which is no anomaly to log.
    if (composed === null) return;
    if (typeof composed === 'string') {
      console.error(JSON.stringify({ event: 'mail_skipped', ...report, reason: composed }));
      return;
    }
    await sendReportingFailure(composed, report, mailer);
  } catch (error) {
    console.error(JSON.stringify({ event: 'mail_compose_failed', ...report, error: errorText(error) }));
  }
}

/**
 * The tier of refund-table.ts a Trip Fee Refund falls in, read off its amount
 * against the Trip Fee paid: all of it is FULL (also a Batch cancelled, or a
 * late settlement, refunded in full whenever), anything less is HALF. A NONE
 * tier owes no Refund, so none is ever opened.
 */
function tripFeeRefundTierOf(refundAmount: number, paidAmount: number): 'FULL' | 'HALF' {
  return refundAmount >= paidAmount ? 'FULL' : 'HALF';
}

/** Tells the Fundraiser who requested a Payout that it was approved, or that the money was sent. */
export async function emailPayoutStatus(
  prisma: PrismaClient,
  params: { payoutId: string } & ({ event: 'approved' } | { event: 'completed'; proofReference: string }),
  mailer?: Mailer,
): Promise<void> {
  const report = { mail: `payout_${params.event}`, payoutId: params.payoutId };
  await composeAndSend(
    report,
    async () => {
      const payout = await prisma.payout.findUnique({
        where: { id: params.payoutId },
        select: {
          amount: true,
          requestedById: true,
          volunteerTripId: true,
          requestedBy: { select: { name: true, ...SELECT_USER_EMAIL } },
          bankAccount: { select: { bankCode: true } },
          campaign: { select: { title: true, slug: true } },
        },
      });
      if (!payout) return 'payout not found';
      const to = readUserEmail(payout.requestedBy);
      if (!to) return 'the Fundraiser has no readable email address';
      let subject: { kind: 'campaign' | 'trip'; title: string; url: string };
      if (payout.campaign) {
        subject = {
          kind: 'campaign',
          title: payout.campaign.title,
          url: publicUrl(`/akun/kampanye-saya/${payout.campaign.slug}/pencairan`),
        };
      } else if (payout.volunteerTripId) {
        const trip = await prisma.volunteerTrip.findUnique({
          where: { id: payout.volunteerTripId },
          select: { title: true, slug: true },
        });
        if (!trip) return 'the Payout names no Campaign or Volunteer Trip that still exists';
        subject = { kind: 'trip', title: trip.title, url: publicUrl(`/akun/volunteer-trip/${trip.slug}`) };
      } else {
        return 'the Payout names no Campaign or Volunteer Trip';
      }
      return payoutStatusEmail({
        to,
        fundraiserName: payout.requestedBy.name,
        subjectTitle: subject.title,
        subjectKind: subject.kind,
        amount: payout.amount,
        bankCode: payout.bankAccount.bankCode,
        statusUrl: subject.url,
        ...(params.event === 'approved'
          ? { event: 'approved' as const }
          : { event: 'completed' as const, proofReference: params.proofReference }),
      });
    },
    mailer,
  );
}

/**
 * Tells the Donor of a Refund (a registered Donor, a Guest Donor, or the
 * Volunteer whose Trip Fee it returns) that it was paid or that it failed.
 * An anonymised Donation has had its contact cleared (ticket 36), so there
 * is nobody to tell.
 */
export async function emailRefundOutcome(
  prisma: PrismaClient,
  params: { refundId: string; outcome: 'completed' | 'failed' },
  mailer?: Mailer,
): Promise<void> {
  const report = { mail: `refund_${params.outcome}`, refundId: params.refundId };
  await composeAndSend(
    report,
    async () => {
      const refund = await prisma.refund.findUnique({
        where: { id: params.refundId },
        select: {
          amount: true,
          payment: {
            select: {
              amount: true,
              donation: {
                select: {
                  anonymisedAt: true,
                  guestName: true,
                  ...SELECT_DONATION_GUEST_EMAIL,
                  donor: { select: { name: true, ...SELECT_USER_EMAIL } },
                  campaign: { select: { title: true } },
                },
              },
              registration: {
                select: {
                  volunteer: { select: { name: true, ...SELECT_USER_EMAIL } },
                  batch: { select: { trip: { select: { title: true, slug: true } } } },
                },
              },
            },
          },
        },
      });
      if (!refund) return 'refund not found';
      const { donation, registration } = refund.payment;
      let recipient: { to: string | null; name: string | null; title: string };
      if (donation) {
        if (donation.anonymisedAt) return 'the Donation has been anonymised';
        recipient = {
          to: donation.donor ? readUserEmail(donation.donor) : readDonationGuestEmail(donation),
          name: donation.donor?.name ?? donation.guestName,
          title: donation.campaign.title,
        };
      } else if (registration) {
        // A Volunteer's Trip Fee comes back by tier (ticket 84); a failed
        // transfer is worded like any Donor's.
        if (params.outcome === 'completed') {
          const to = readUserEmail(registration.volunteer);
          if (!to) return 'the Volunteer has no readable email address';
          return tripFeeEmail({
            to,
            volunteerName: registration.volunteer.name,
            tripTitle: registration.batch.trip.title,
            tripUrl: publicUrl(`/volunteer-trip/${registration.batch.trip.slug}`),
            event: 'refund-completed',
            tier: tripFeeRefundTierOf(refund.amount, refund.payment.amount),
            amount: refund.amount,
            paidAmount: refund.payment.amount,
          });
        }
        recipient = {
          to: readUserEmail(registration.volunteer),
          name: registration.volunteer.name,
          title: registration.batch.trip.title,
        };
      } else {
        return 'the Refund names no Donation or Registration';
      }
      if (!recipient.to) return 'the Donor has no readable email address';
      return refundOutcomeEmail({
        to: recipient.to,
        donorName: recipient.name,
        subjectTitle: recipient.title,
        amount: refund.amount,
        outcome: params.outcome,
      });
    },
    mailer,
  );
}

/** Tells a Campaign's Fundraiser that a Suspension was imposed on it or lifted, and why. */
export async function emailSuspension(
  prisma: PrismaClient,
  params: { campaignId: string; reason: string } & ({ event: 'suspended' } | { event: 'lifted'; statusLabel: string }),
  mailer?: Mailer,
): Promise<void> {
  const report = {
    mail: params.event === 'suspended' ? 'suspension_imposed' : 'suspension_lifted',
    campaignId: params.campaignId,
  };
  await composeAndSend(
    report,
    async () => {
      const campaign = await prisma.campaign.findUnique({
        where: { id: params.campaignId },
        select: { title: true, creatorId: true },
      });
      if (!campaign) return 'campaign not found';
      const fundraiser = await prisma.user.findUnique({
        where: { id: campaign.creatorId },
        select: { name: true, ...SELECT_USER_EMAIL },
      });
      const to = fundraiser ? readUserEmail(fundraiser) : null;
      if (!fundraiser || !to) return 'the Fundraiser has no readable email address';
      return suspensionEmail({
        to,
        fundraiserName: fundraiser.name,
        campaignTitle: campaign.title,
        reason: params.reason,
        campaignUrl: publicUrl('/akun/kampanye-saya'),
        ...(params.event === 'suspended'
          ? { event: 'suspended' as const }
          : { event: 'lifted' as const, statusLabel: params.statusLabel }),
      });
    },
    mailer,
  );
}

/**
 * Tells a Volunteer their Registration is CONFIRMED because the Trip Fee
 * settled (ticket 84). Called by the webhook after the settlement committed.
 */
export async function emailRegistrationConfirmed(
  prisma: PrismaClient,
  params: { registrationId: string },
  mailer?: Mailer,
): Promise<void> {
  const report = { mail: 'registration_confirmed', registrationId: params.registrationId };
  await composeAndSend(
    report,
    async () => {
      const registration = await prisma.registration.findUnique({
        where: { id: params.registrationId },
        select: {
          volunteer: { select: { name: true, ...SELECT_USER_EMAIL } },
          payment: { select: { amount: true } },
          batch: { select: { startDate: true, endDate: true, trip: { select: { title: true, slug: true } } } },
        },
      });
      if (!registration) return 'registration not found';
      if (!registration.payment) return 'the Registration has no Payment';
      const to = readUserEmail(registration.volunteer);
      if (!to) return 'the Volunteer has no readable email address';
      return tripFeeEmail({
        to,
        volunteerName: registration.volunteer.name,
        tripTitle: registration.batch.trip.title,
        tripUrl: publicUrl(`/volunteer-trip/${registration.batch.trip.slug}`),
        event: 'confirmed',
        amount: registration.payment.amount,
        startDate: registration.batch.startDate,
        endDate: registration.batch.endDate,
      });
    },
    mailer,
  );
}

/**
 * Tells a Volunteer their Trip Fee Refund was approved (ticket 84). A Refund
 * of a Donation is not this email's business: nothing is sent and nothing is
 * logged for it, so approveRefund may call this for every Refund it approves.
 */
export async function emailTripFeeRefundApproved(
  prisma: PrismaClient,
  params: { refundId: string },
  mailer?: Mailer,
): Promise<void> {
  const report = { mail: 'trip_fee_refund_approved', refundId: params.refundId };
  await composeAndSend(
    report,
    async () => {
      const refund = await prisma.refund.findUnique({
        where: { id: params.refundId },
        select: {
          amount: true,
          payment: {
            select: {
              amount: true,
              registration: {
                select: {
                  volunteer: { select: { name: true, ...SELECT_USER_EMAIL } },
                  batch: { select: { trip: { select: { title: true, slug: true } } } },
                },
              },
            },
          },
        },
      });
      if (!refund) return 'refund not found';
      const { registration } = refund.payment;
      if (!registration) return null;
      const to = readUserEmail(registration.volunteer);
      if (!to) return 'the Volunteer has no readable email address';
      return tripFeeEmail({
        to,
        volunteerName: registration.volunteer.name,
        tripTitle: registration.batch.trip.title,
        tripUrl: publicUrl(`/volunteer-trip/${registration.batch.trip.slug}`),
        event: 'refund-approved',
        tier: tripFeeRefundTierOf(refund.amount, refund.payment.amount),
        amount: refund.amount,
        paidAmount: refund.payment.amount,
      });
    },
    mailer,
  );
}
