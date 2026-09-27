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
  /**
   * What the Verifier settled. A `change` request approved a new target or
   * deadline on a Campaign that never stopped running, which is a different
   * thing from the Campaign itself being diloloskan (ticket 12); without it
   * the Fundraiser reads a proposal as if their Campaign had been approved.
   */
  kind?: 'submission' | 'change';
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
  const isChange = input.kind === 'change';
  const paragraphs =
    input.outcome === 'approved'
      ? isChange
        ? {
            subject: `Perubahan Campaign "${title}" disetujui`,
            body: [
              `Perubahan target atau tenggat Campaign "${input.campaignTitle}" disetujui Verifier dan sudah berlaku.`,
              'Campaign tetap berjalan seperti sebelumnya, kini dengan nilai yang baru:',
            ],
          }
        : {
            subject: `Campaign "${title}" diloloskan`,
            body: [
              `Campaign "${input.campaignTitle}" diloloskan Verifier dan kini tampil untuk publik.`,
              'Bagikan tautan Campaign Anda agar semakin banyak orang ikut membantu:',
            ],
          }
      : isChange
        ? {
            subject: `Perubahan Campaign "${title}" ditolak`,
            body: [
              `Perubahan target atau tenggat Campaign "${input.campaignTitle}" ditolak oleh Verifier.`,
              `Alasan: ${input.reason}`,
              'Campaign tetap berjalan dengan target dan tenggat sebelumnya. Ajukan lagi lewat tautan ini:',
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
