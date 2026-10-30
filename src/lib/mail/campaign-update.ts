import type { MailMessage } from './types';
import { emailLogoHtml } from './email-logo';
import { escapeHtml } from './escape-html';

/**
 * The email a Donor gets when the Campaign they gave to publishes a new
 * Kabar Terbaru (ticket rilis-1-benda/71). One message per recipient with only
 * their own address on it: no other Donor, and no Donor's name beyond their
 * own greeting, ever appears in it.
 */
export type CampaignUpdateEmailInput = {
  to: string;
  /** Null for a Donor who gave anonymously or whose name is unknown: greeted without one. */
  donorName: string | null;
  campaignTitle: string;
  updateTitle: string;
  updateContent: string;
  campaignUrl: string;
};

const EXCERPT_LENGTH = 280;

function excerpt(content: string): string {
  const flat = content.replace(/\s+/g, ' ').trim();
  return flat.length <= EXCERPT_LENGTH ? flat : `${flat.slice(0, EXCERPT_LENGTH).trimEnd()}...`;
}

export function campaignUpdateEmail(input: CampaignUpdateEmailInput): MailMessage {
  const subject = `Kabar terbaru dari "${input.campaignTitle}"`;
  const greeting = input.donorName ? `Halo ${input.donorName},` : 'Halo,';
  const body = [
    `Campaign "${input.campaignTitle}" yang pernah Anda dukung baru saja menerbitkan kabar terbaru: "${input.updateTitle}".`,
    excerpt(input.updateContent),
    'Baca selengkapnya di tab Kabar Terbaru pada halaman Campaign:',
  ];
  const reason = 'Anda menerima email ini karena Anda mendukung Campaign ini lewat donasi.';
  const closing = 'Salam,\nTim Fund for Indonesia';

  const text = [greeting, ...body, input.campaignUrl, reason, closing].join('\n\n');
  const url = escapeHtml(input.campaignUrl);
  const html = [
    emailLogoHtml(),
    `<p>${escapeHtml(greeting)}</p>`,
    ...body.map((line) => `<p>${escapeHtml(line)}</p>`),
    `<p><a href="${url}">${url}</a></p>`,
    `<p>${escapeHtml(reason)}</p>`,
    `<p>${escapeHtml(closing).replace('\n', '<br>')}</p>`,
  ].join('\n');

  return { to: input.to, subject, text, html };
}
