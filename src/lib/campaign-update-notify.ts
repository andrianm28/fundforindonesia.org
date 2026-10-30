import type { PrismaClient } from '@/generated/prisma/client';
import {
  readDonationGuestEmail,
  readUserEmail,
  SELECT_DONATION_GUEST_EMAIL,
  SELECT_USER_EMAIL,
} from './contact-fields';
import { sendReportingFailure, type Mailer } from './mail';
import { campaignUpdateEmail } from './mail/campaign-update';
import { publicUrl } from './public-url';

/**
 * Tells a Campaign's Donors that it published a Kabar Terbaru (ticket
 * rilis-1-benda/71). Best-effort and after the fact: the update is already
 * saved when this runs, so nothing here throws and a failure is logged as one
 * JSON line carrying ids only, never an address (`mail_send_failed`,
 * `mail_not_configured` from sendReportingFailure; `campaign_update_notify_failed`
 * here).
 *
 * Who is told: every Donor, registered or Guest, with a Donation that is
 * confirmed and whose Payment settled as real money (PAID and not sandbox) --
 * beta test money does not make anyone a Donor of record. A Donor who gave
 * anonymously is told too (anonymity hides their name from the public, not
 * from the Campaign they chose to follow), and is greeted without a name. An
 * anonymised Donation has no address left and is skipped.
 *
 * One email per distinct address per update, whether the Donor gave once or
 * five times, or as a registered Donor and as a guest: addresses are compared
 * by their lookup HMAC, never by decrypting to compare. Each address is
 * decrypted only here, by the approved readers in contact-fields.ts, held for
 * the length of one send, and handed to the Mailer; it is never returned,
 * stored or logged, so the Fundraiser and the API see no recipient list.
 */

const PAGE = 200;

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
        campaign: { select: { title: true, slug: true } },
      },
    });
    if (!update) {
      console.error(
        JSON.stringify({ event: 'campaign_update_notify_failed', updateId: params.updateId, error: 'update not found' }),
      );
      return result;
    }
    const campaignUrl = publicUrl(`/campaign/${update.campaign.slug}`);

    const seen = new Set<string>();
    let cursor: string | undefined;
    for (;;) {
      const donations = await prisma.donation.findMany({
        where: {
          campaignId: update.campaignId,
          paymentStatus: 'confirmed',
          anonymisedAt: null,
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
        const key = donation.donor?.emailHmac ?? donation.guestEmailHmac;
        if (!key || seen.has(key)) continue;
        seen.add(key);
        result.recipients += 1;

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
              error: error instanceof Error ? error.message : String(error),
            }),
          );
          continue;
        }
        if (!to) continue;

        const name = donation.isAnonymous ? null : (donation.donor?.name ?? donation.guestName ?? null);
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
        if (sent) result.sent += 1;
      }
      if (donations.length < PAGE) break;
    }
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'campaign_update_notify_failed',
        updateId: params.updateId,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
  return result;
}
