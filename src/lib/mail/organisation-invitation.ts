import { escapeHtml } from './escape-html';
import type { MailMessage } from './types';
import { emailLogoHtml } from './email-logo';

/**
 * The invitation to join a Partner Organisation's team (ticket E4; CONTEXT.md,
 * Anggota tim). The link is single use and expires; accepting needs an account
 * whose verified email is this very address. The body says plainly what a
 * member may do (read the organisation's Campaigns) and may not (Payout,
 * rekening bank), so nobody accepts expecting more.
 */
export type OrganisationInvitationEmailInput = {
  to: string;
  organisationName: string;
  acceptUrl: string;
  /** Already formatted for the reader, e.g. "9 November 2026". */
  expiresOn: string;
};

export function organisationInvitationEmail(input: OrganisationInvitationEmailInput): MailMessage {
  const subject = `Undangan bergabung ke tim ${input.organisationName}`;
  const greeting = 'Halo,';
  const body = [
    `${input.organisationName} mengundang Anda bergabung ke tim organisasinya di Fund for Indonesia. Sebagai anggota tim, Anda dapat melihat Campaign organisasi. Anggota tim tidak dapat mengajukan Payout dan tidak dapat mengelola rekening bank; itu tetap milik akun Fundraiser utama organisasi.`,
    `Masuk ke akun Anda dengan email ini (email harus sudah terverifikasi), lalu buka tautan berikut. Tautan berlaku sampai ${input.expiresOn} dan hanya bisa dipakai sekali. Jika Anda tidak mengenal undangan ini, abaikan email ini; tidak ada yang berubah.`,
  ];
  const closing = 'Salam,\nTim Fund for Indonesia';

  const text = [greeting, ...body, input.acceptUrl, closing].join('\n\n');
  const url = escapeHtml(input.acceptUrl);
  const html = [
    emailLogoHtml(),
    `<p>${escapeHtml(greeting)}</p>`,
    ...body.map((line) => `<p>${escapeHtml(line)}</p>`),
    `<p><a href="${url}">${url}</a></p>`,
    `<p>${escapeHtml(closing).replace('\n', '<br>')}</p>`,
  ].join('\n');

  return { to: input.to, subject, text, html };
}
