import { readUserEmail, SELECT_USER_EMAIL } from '@/lib/contact-fields';
import { prisma } from '@/lib/prisma';
import { sendReportingFailure, type Mailer } from '@/lib/mail';
import { campaignDeadlineReminderEmail, kindAuthorisationExpiryWarningEmail } from '@/lib/mail/reminders';
import { publicUrl } from '@/lib/public-url';
import { KIND_LABEL } from '@/lib/campaign-kind';
import { formatIndonesianDate } from '@/lib/utils/date';
import { KIND_AUTHORISATION_EXPIRY_WARNING_DAYS } from '@/lib/kind-authorisation-window';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * How many days before a Campaign's deadline its Fundraiser is reminded, so
 * it does not lapse to Expired unattended (CONTEXT.md, Campaign Status).
 *
 * ASSUMPTION: ticket 20 does not name a lead time, and none is written down
 * in spec.md or CONTEXT.md either. Three days (a single reminder per
 * Campaign, never repeated -- see Campaign.deadlineReminderSentAt) is this
 * change's own choice, kept in one place so the owner can adjust it without
 * touching the sweep itself.
 */
export const CAMPAIGN_DEADLINE_REMINDER_DAYS = 3;

// Defined in ./kind-authorisation-window.ts (shared with the Verifier's list); re-exported here.
export { KIND_AUTHORISATION_EXPIRY_WARNING_DAYS };

/**
 * How many reminders one call processes. Bounds the sweep the same way
 * ESCROW_RELEASE_SWEEP_LIMIT bounds releaseMaturedEscrow (./money/escrow.ts):
 * anything past this limit is left unsent and picked up by a later call,
 * rather than turning one run into an unbounded scan.
 */
export const REMINDER_SWEEP_LIMIT = 500;

export interface ReminderSweepResult {
  /** Reminders this call actually sent. */
  sentCount: number;
  /** Reminders this call looked at, including ones it skipped or lost a race on. */
  consideredCount: number;
}

/**
 * Finds every Active Campaign whose deadline is within
 * CAMPAIGN_DEADLINE_REMINDER_DAYS and has not yet been reminded, and sends
 * its Fundraiser one in-app Notification and one email.
 *
 * Idempotent and safe under two overlapping scheduler runs: each Campaign is
 * claimed via a predicated `updateMany` (WHERE deadlineReminderSentAt IS
 * NULL) before anything is sent, so the loser of a race sees `count === 0`
 * and sends nothing -- the same pattern releaseMaturedEscrow uses for
 * Payment.escrowReleasedAt. One Campaign's failure (a bad row, a mailer
 * error) is caught and logged without stopping the rest of the sweep.
 */
export async function sendCampaignDeadlineReminders(
  now: Date = new Date(),
  mailer?: Mailer,
): Promise<ReminderSweepResult> {
  const horizon = new Date(now.getTime() + CAMPAIGN_DEADLINE_REMINDER_DAYS * MS_PER_DAY);

  const campaigns = await prisma.campaign.findMany({
    where: {
      lifecycleStatus: 'ACTIVE',
      deadline: { gt: now, lte: horizon },
      deadlineReminderSentAt: null,
    },
    select: {
      id: true,
      slug: true,
      title: true,
      deadline: true,
      creatorId: true,
      creator: { select: { name: true, ...SELECT_USER_EMAIL } },
    },
    // Soonest deadline first, so a truncated sweep leaves the least urgent
    // reminders for the next call, never the other way round.
    orderBy: { deadline: 'asc' },
    take: REMINDER_SWEEP_LIMIT,
  });

  if (campaigns.length === REMINDER_SWEEP_LIMIT) {
    console.warn(
      `sendCampaignDeadlineReminders: hit the sweep limit of ${REMINDER_SWEEP_LIMIT} -- more due reminders remain and will be picked up by a later call.`,
    );
  }

  let sentCount = 0;
  for (const campaign of campaigns) {
    try {
      const deadline = campaign.deadline!;
      // Claim and record the in-app Notification in one transaction, so a
      // failure partway through (e.g. the Notification write) rolls back the
      // claim too, rather than marking a Campaign "reminded" when it was
      // never actually notified. The email is sent only after this commits.
      const claimed = await prisma.$transaction(async (tx) => {
        const claim = await tx.campaign.updateMany({
          where: { id: campaign.id, deadlineReminderSentAt: null },
          data: { deadlineReminderSentAt: now },
        });
        if (claim.count === 0) return false;
        await tx.notification.create({
          data: {
            type: 'campaign_deadline_reminder',
            title: 'Tenggat Campaign Akan Berakhir',
            message: `Tenggat Campaign "${campaign.title}" adalah ${formatIndonesianDate(deadline)}.`,
            userId: campaign.creatorId,
            link: `/campaign/${campaign.slug}`,
          },
        });
        return true;
      });
      if (!claimed) continue;

      // Decrypted for the address to send to (ADR 0012 stores a ciphertext). A
      // Fundraiser with no readable address gets no email rather than one to
      // nowhere: the in-app Notification above is already recorded, so they are
      // not left un-notified.
      const email = readUserEmail(campaign.creator);
      if (!email) {
        console.error(
          `sendCampaignDeadlineReminders: campaign ${campaign.id} has no readable Fundraiser email; sent the in-app notification only (ADR 0012)`,
        );
      } else {
        await sendReportingFailure(
          campaignDeadlineReminderEmail({
            to: email,
            fundraiserName: campaign.creator.name,
            campaignTitle: campaign.title,
            deadline,
            campaignUrl: publicUrl(`/campaign/${campaign.slug}`),
          }),
          { mail: 'campaign_deadline_reminder', campaignId: campaign.id },
          mailer,
        );
      }

      sentCount++;
    } catch (err) {
      // One Campaign's failure must not stop the rest of the sweep.
      console.error(`sendCampaignDeadlineReminders: failed for campaign ${campaign.id}`, err);
    }
  }

  return { sentCount, consideredCount: campaigns.length };
}

/**
 * Finds every Kind Authorisation that is valid right now but expires within
 * KIND_AUTHORISATION_EXPIRY_WARNING_DAYS and has not yet been warned about,
 * and sends its Partner Organisation's Fundraiser one in-app Notification
 * and one email. Mirrors sendCampaignDeadlineReminders, including the
 * claim-before-send idempotency pattern.
 */
export async function sendKindAuthorisationExpiryWarnings(
  now: Date = new Date(),
  mailer?: Mailer,
): Promise<ReminderSweepResult> {
  const horizon = new Date(now.getTime() + KIND_AUTHORISATION_EXPIRY_WARNING_DAYS * MS_PER_DAY);

  const authorisations = await prisma.kindAuthorisation.findMany({
    where: {
      validFrom: { lte: now },
      validTo: { gt: now, lte: horizon },
      expiryWarningSentAt: null,
    },
    select: {
      id: true,
      kind: true,
      validTo: true,
      partnerOrganisation: {
        select: {
          name: true,
          fundraiserId: true,
          fundraiser: { select: { name: true, ...SELECT_USER_EMAIL } },
        },
      },
    },
    orderBy: { validTo: 'asc' },
    take: REMINDER_SWEEP_LIMIT,
  });

  if (authorisations.length === REMINDER_SWEEP_LIMIT) {
    console.warn(
      `sendKindAuthorisationExpiryWarnings: hit the sweep limit of ${REMINDER_SWEEP_LIMIT} -- more due warnings remain and will be picked up by a later call.`,
    );
  }

  let sentCount = 0;
  for (const authorisation of authorisations) {
    try {
      const kindLabel = KIND_LABEL[authorisation.kind];
      const { partnerOrganisation } = authorisation;

      // Same claim-then-notify transaction as sendCampaignDeadlineReminders,
      // for the same reason: a failed Notification write must not leave this
      // authorisation stamped as warned when it never was.
      const claimed = await prisma.$transaction(async (tx) => {
        const claim = await tx.kindAuthorisation.updateMany({
          where: { id: authorisation.id, expiryWarningSentAt: null },
          data: { expiryWarningSentAt: now },
        });
        if (claim.count === 0) return false;
        await tx.notification.create({
          data: {
            type: 'kind_authorisation_expiry_warning',
            title: 'Kind Authorisation Akan Berakhir',
            message: `Kind Authorisation ${partnerOrganisation.name} untuk ${kindLabel} berlaku sampai ${formatIndonesianDate(authorisation.validTo)}.`,
            userId: partnerOrganisation.fundraiserId,
            // No self-service renewal page exists yet -- only a Verifier
            // records a Kind Authorisation -- so this carries no link,
            // unlike the deadline reminder above.
            link: null,
          },
        });
        return true;
      });
      if (!claimed) continue;

      // As above: the in-app Notification is already recorded, so an
      // unreadable address costs the email and nothing else.
      const email = readUserEmail(partnerOrganisation.fundraiser);
      if (!email) {
        console.error(
          `sendKindAuthorisationExpiryWarnings: ${partnerOrganisation.name} has no readable Fundraiser email; sent the in-app notification only (ADR 0012)`,
        );
      } else {
        await sendReportingFailure(
          kindAuthorisationExpiryWarningEmail({
            to: email,
            fundraiserName: partnerOrganisation.fundraiser.name,
            organisationName: partnerOrganisation.name,
            kindLabel,
            validTo: authorisation.validTo,
          }),
          { mail: 'kind_authorisation_expiry_warning', kindAuthorisationId: authorisation.id },
          mailer,
        );
      }

      sentCount++;
    } catch (err) {
      // One authorisation's failure must not stop the rest of the sweep.
      console.error(`sendKindAuthorisationExpiryWarnings: failed for kind authorisation ${authorisation.id}`, err);
    }
  }

  return { sentCount, consideredCount: authorisations.length };
}
