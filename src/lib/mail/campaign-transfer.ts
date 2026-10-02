import { escapeHtml } from './escape-html';
import type { MailMessage } from './types';

/**
 * What a Donor of a Suspended zakat or wakaf Campaign is told once its money
 * has been moved to another Campaign (CONTEXT.md, Campaign Transfer; PRD
 * §7.2): where it went, because it was not returned to them.
 */
export type CampaignTransferEmailInput = {
  to: string;
  sourceTitle: string;
  targetTitle: string;
  targetUrl: string;
};

function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function campaignTransferEmail(input: CampaignTransferEmailInput): MailMessage {
  const subject = `Dana Campaign "${oneLine(input.sourceTitle)}" dialihkan`;
  const body = [
    `Campaign "${input.sourceTitle}" yang Anda dukung sedang Suspended.`,
    `Sesuai ketentuan untuk dana Zakat dan Wakaf, dana yang terkumpul tidak dikembalikan, ` +
      `melainkan dialihkan ke Campaign "${input.targetTitle}" dengan Kind yang sama.`,
    'Anda dapat melihat Campaign tujuan di tautan ini:',
  ];
  const closing = 'Salam,\nTim Fund for Indonesia';
  const text = [...body, input.targetUrl, closing].join('\n\n');
  const url = escapeHtml(input.targetUrl);
  const html = [
    ...body.map((line) => `<p>${escapeHtml(line)}</p>`),
    `<p><a href="${url}">${url}</a></p>`,
    `<p>${escapeHtml(closing).replace('\n', '<br>')}</p>`,
  ].join('\n');
  return { to: input.to, subject, text, html };
}
