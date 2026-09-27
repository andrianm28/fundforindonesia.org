import { formatIndonesianDate } from '@/lib/utils/date';
import type { MailMessage } from './types';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function render(to: string, subject: string, greeting: string, body: string[], closing: string): MailMessage {
  const text = [greeting, ...body, closing].join('\n\n');
  const html = [
    `<p>${escapeHtml(greeting)}</p>`,
    ...body.map((line) => `<p>${escapeHtml(line)}</p>`),
    `<p>${escapeHtml(closing).replace('\n', '<br>')}</p>`,
  ].join('\n');
  return { to, subject, text, html };
}

const CLOSING = 'Salam,\nTim Fund for Indonesia';

/**
 * The Campaign deadline reminder (ticket 20): sent once to the Fundraiser
 * while their Campaign is still Active and its deadline is coming up, so it
 * does not lapse to Expired -- and its money go through Escrow Hold and
 * mature into Campaign Balance -- without them having had a chance to act.
 */
export type CampaignDeadlineReminderEmailInput = {
  to: string;
  fundraiserName: string;
  campaignTitle: string;
  deadline: Date;
  campaignUrl: string;
};

export function campaignDeadlineReminderEmail(input: CampaignDeadlineReminderEmailInput): MailMessage {
  const subject = `Tenggat Campaign "${input.campaignTitle}" akan segera berakhir`;
  return render(
    input.to,
    subject,
    `Halo ${input.fundraiserName},`,
    [
      `Tenggat Campaign "${input.campaignTitle}" adalah ${formatIndonesianDate(input.deadline)}. Setelah tenggat lewat, Campaign berhenti menerima Donation.`,
      'Segera lakukan tindakan yang diperlukan, misalnya mempersiapkan Campaign Update atau mengajukan Payout.',
      input.campaignUrl,
    ],
    CLOSING,
  );
}

/**
 * The Kind Authorisation expiry warning (ticket 20; CONTEXT.md, Kind
 * Authorisation): sent once to a Partner Organisation's Fundraiser while its
 * authorisation for one Kind is still valid but expiring soon, so they have
 * time to renew before that Kind stops accepting Donations.
 */
export type KindAuthorisationExpiryWarningEmailInput = {
  to: string;
  fundraiserName: string;
  organisationName: string;
  kindLabel: string;
  validTo: Date;
};

export function kindAuthorisationExpiryWarningEmail(input: KindAuthorisationExpiryWarningEmailInput): MailMessage {
  const subject = `Kind Authorisation ${input.organisationName} untuk ${input.kindLabel} akan segera berakhir`;
  return render(
    input.to,
    subject,
    `Halo ${input.fundraiserName},`,
    [
      `Kind Authorisation ${input.organisationName} untuk Kind ${input.kindLabel} berlaku sampai ${formatIndonesianDate(input.validTo)}.`,
      `Setelah tanggal itu lewat, Campaign ber-Kind ${input.kindLabel} di bawah ${input.organisationName} berhenti menerima Donation sampai izinnya diperpanjang.`,
      'Hubungi Verifier untuk memperpanjang Kind Authorisation ini sebelum berakhir.',
    ],
    CLOSING,
  );
}
