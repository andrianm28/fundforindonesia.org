import type { MailMessage } from './types';

/**
 * What a Verifier's decision on a Verification Request tells its
 * Fundraiser. A rejection always carries the Verifier's reason
 * (CONTEXT.md, Verification Request).
 */
export type VerificationOutcomeEmailInput = {
  to: string;
  fundraiserName: string;
  campaignTitle: string;
  campaignUrl: string;
} & ({ outcome: 'approved' } | { outcome: 'rejected'; reason: string });

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** A title on one line: a subject is a header, and a line break has no business there. */
function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * The email for a decided Verification Request, in Indonesian and in the
 * glossary's words: the Campaign is diloloskan or ditolak by the Verifier.
 * Every value typed by a person is escaped in the HTML body.
 */
export function verificationOutcomeEmail(input: VerificationOutcomeEmailInput): MailMessage {
  const title = oneLine(input.campaignTitle);
  const paragraphs =
    input.outcome === 'approved'
      ? {
          subject: `Campaign "${title}" diloloskan`,
          body: [
            `Campaign "${input.campaignTitle}" diloloskan Verifier dan kini tampil untuk publik.`,
            'Bagikan tautan Campaign Anda agar semakin banyak orang ikut membantu:',
          ],
        }
      : {
          subject: `Campaign "${title}" ditolak`,
          body: [
            `Campaign "${input.campaignTitle}" ditolak oleh Verifier.`,
            `Alasan: ${input.reason}`,
            'Perbaiki Campaign Anda sesuai alasan tersebut, lalu ajukan kembali lewat tautan ini:',
          ],
        };
  const greeting = `Halo ${input.fundraiserName},`;
  const closing = 'Salam,\nTim Fund for Indonesia';

  const text = [greeting, ...paragraphs.body, input.campaignUrl, closing].join('\n\n');
  const url = escapeHtml(input.campaignUrl);
  const html = [
    `<p>${escapeHtml(greeting)}</p>`,
    ...paragraphs.body.map((line) => `<p>${escapeHtml(line)}</p>`),
    `<p><a href="${url}">${url}</a></p>`,
    `<p>${escapeHtml(closing).replace('\n', '<br>')}</p>`,
  ].join('\n');

  return { to: input.to, subject: paragraphs.subject, text, html };
}
