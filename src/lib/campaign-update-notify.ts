import type { PrismaClient } from '@/generated/prisma/client';
import {
  readDonationGuestEmail,
  readUserEmail,
  SELECT_DONATION_GUEST_EMAIL,
  SELECT_USER_EMAIL,
} from './contact-fields';
import { errorText, sendReportingFailure, type Mailer } from './mail';
import { campaignUpdateEmail } from './mail/campaign-update';
import { publicUrl } from './public-url';

/**
 * Tells a Campaign's Donors that it published a Kabar Terbaru (ticket
 * rilis-1-benda/71). Best-effort and after the fact: the update is already
 * saved when this runs, so nothing here throws and a failure is logged as one
 * JSON line carrying ids only, never an address (`mail_send_failed`,
 * `mail_not_configured` from sendReportingFailure; `campaign_update_notify_failed`
 * and `campaign_update_notify_aborted` here).
 *
 * Who is told: every registered Donor with a Donation that is confirmed and
 * whose Payment settled as real money (PAID and not sandbox) -- beta test money
 * does not make anyone a Donor of record. Guest Donors are NOT told while there
 * is no way for them to opt out (privacy review of PR 304; the Privacy Policy
 * names receipts as the only use of a Guest address). That choice lives in
 * NOTIFY_GUEST_DONORS alone: flip it once the owner decides. A Donor who gave
 * anonymously is told too (anonymity hides their name from the public, not from
 * the Campaign they chose to follow); a Donor with both an anonymous and a named
 * Donation is greeted without a name. An anonymised Donation has no address left
 * and is skipped.
 *
 * Limits: only the first update of a Campaign on a WIB calendar day is emailed
 * (later ones still publish); nothing is sent unless the Campaign is ACTIVE,
 * COMPLETED or EXPIRED, re-read every 50 recipients; and sending stops after 5 failed sends in a row.
 * The User model has no suspended or deleted marker to filter on.
 *
 * One email per distinct address per update, however many Donations carry it:
 * addresses are compared by their lookup HMAC, never by decrypting to compare.
 * Each address is decrypted only here, by the approved readers in
 * contact-fields.ts, held for the length of one send, and handed to the Mailer;
 * it is never returned, stored or logged, so the Fundraiser and the API see no
 * recipient list.
 */

const PAGE = 200;
const DAY_MS = 24 * 60 * 60 * 1000;
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;
const RECHECK_EVERY = 50;

/**
 * Statuses whose Campaign may still email its Donors. An explicit list, not
 * isPubliclyViewable: that treats SUSPENDED and CANCELLED as viewable, and a
 * suspended Campaign must not mail anyone.
 */
const MAY_EMAIL_STATUSES = new Set(['ACTIVE', 'COMPLETED', 'EXPIRED']);

/** Midnight WIB (UTC+7) starting the calendar day that contains `at`. */
function startOfWibDay(at: Date): Date {
  return new Date(Math.floor((at.getTime() + WIB_OFFSET_MS) / DAY_MS) * DAY_MS - WIB_OFFSET_MS);
}
const MAX_CONSECUTIVE_FAILURES = 5;

/** Whether Guest Donors (no account) are emailed too. Off until opt-out exists. */
const NOTIFY_GUEST_DONORS = false;

type RecipientRow = {
  id: string;
  isAnonymous: boolean;
  guestName: string | null;
  guestEmailHmac: string | null;
  guestEmailCiphertext: string | null;
  guestEmailKeyId: string | null;
  donor: { name: string; emailHmac: string; emailCiphertext: string; emailKeyId: string } | null;
};

export type CampaignUpdateNotifyResult = { recipients: number; sent: number };

export async function notifyDonorsOfCampaignUpdate(
  prisma: PrismaClient,
  params: { updateId: string },
  mailer?: Mailer,
): Promise<CampaignUpdateNotifyResult> {
  const result: CampaignUpdateNotifyResult = { recipients: 0, sent: 0 };
  try {
    const update = await prisma.campaignUpdate.findUnique({
      where: { id: params.updateId },
      select: {
        id: true,
        title: true,
        content: true,
        campaignId: true,
        createdAt: true,
        campaign: { select: { title: true, slug: true, lifecycleStatus: true } },
      },
    });
    if (!update) {
      console.error(
        JSON.stringify({ event: 'campaign_update_notify_failed', updateId: params.updateId, error: 'update not found' }),
      );
      return result;
    }
    if (!MAY_EMAIL_STATUSES.has(update.campaign.lifecycleStatus)) return result;

    const earlier = await prisma.campaignUpdate.count({
      where: {
        campaignId: update.campaignId,
        id: { not: update.id },
        createdAt: { gte: startOfWibDay(update.createdAt), lt: update.createdAt },
      },
    });
    if (earlier > 0) return result;

    const campaignUrl = publicUrl(`/campaign/${update.campaign.slug}`);

    // One Donation stands for each distinct address; the others only decide
    // whether the greeting may carry a name. Only the sealed row is held, never
    // a decrypted address.
    const byAddress = new Map<string, { donation: RecipientRow; anonymous: boolean }>();
    let cursor: string | undefined;
    for (;;) {
      const donations = await prisma.donation.findMany({
        where: {
          campaignId: update.campaignId,
          paymentStatus: 'confirmed',
          anonymisedAt: null,
          ...(NOTIFY_GUEST_DONORS ? {} : { donorId: { not: null } }),
          payments: { some: { status: 'PAID', sandbox: false } },
        },
        select: {
          id: true,
          isAnonymous: true,
          guestName: true,
          guestEmailHmac: true,
          ...SELECT_DONATION_GUEST_EMAIL,
          donor: { select: { name: true, emailHmac: true, ...SELECT_USER_EMAIL } },
        },
        orderBy: { id: 'asc' },
        take: PAGE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (donations.length === 0) break;
      cursor = donations[donations.length - 1].id;

      for (const donation of donations) {
        if (!NOTIFY_GUEST_DONORS && !donation.donor) continue;
        const key = donation.donor?.emailHmac ?? donation.guestEmailHmac;
        if (!key) continue;
        const known = byAddress.get(key);
        if (known) known.anonymous ||= donation.isAnonymous;
        else byAddress.set(key, { donation, anonymous: donation.isAnonymous });
      }
      if (donations.length < PAGE) break;
    }
    result.recipients = byAddress.size;

    let failures = 0;
    let attempted = 0;
    for (const { donation, anonymous } of byAddress.values()) {
      if (attempted > 0 && attempted % RECHECK_EVERY === 0) {
        const current = await prisma.campaign.findUnique({
          where: { id: update.campaignId },
          select: { lifecycleStatus: true },
        });
        if (!current || !MAY_EMAIL_STATUSES.has(current.lifecycleStatus)) {
          console.error(
            JSON.stringify({
              event: 'campaign_update_notify_stopped',
              updateId: update.id,
              campaignId: update.campaignId,
              status: current?.lifecycleStatus ?? 'missing',
              sent: result.sent,
              recipients: result.recipients,
            }),
          );
          break;
        }
      }
      attempted += 1;
      let to: string | null;
      try {
        to = donation.donor ? readUserEmail(donation.donor) : readDonationGuestEmail(donation);
      } catch (error) {
        console.error(
          JSON.stringify({
            event: 'mail_skipped',
            mail: 'campaign_update',
            updateId: update.id,
            donationId: donation.id,
            reason: 'the address could not be read',
            error: error instanceof Error ? error.name : 'unknown',
          }),
        );
        continue;
      }
      if (!to) continue;

      const name = anonymous ? null : (donation.donor?.name ?? donation.guestName ?? null);
      const sent = await sendReportingFailure(
        campaignUpdateEmail({
          to,
          donorName: name,
          campaignTitle: update.campaign.title,
          updateTitle: update.title,
          updateContent: update.content,
          campaignUrl,
        }),
        { mail: 'campaign_update', updateId: update.id, donationId: donation.id },
        mailer,
      );
      if (sent) {
        result.sent += 1;
        failures = 0;
      } else if (++failures >= MAX_CONSECUTIVE_FAILURES) {
        console.error(
          JSON.stringify({
            event: 'campaign_update_notify_aborted',
            updateId: update.id,
            consecutiveFailures: failures,
            sent: result.sent,
            recipients: result.recipients,
          }),
        );
        break;
      }
    }
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'campaign_update_notify_failed',
        updateId: params.updateId,
        error: errorText(error),
      }),
    );
  }
  return result;
}
