import { escapeHtml } from './escape-html';
import type { MailMessage } from './types';

/**
 * The link that lets an account set a new password (rilis-1 93). Sent only to
 * an address that has an account; the request endpoint answers the same either
 * way (src/app/api/auth/password-reset/route.ts).
 */
export type PasswordResetEmailInput = {
  to: string;
  name: string;
  resetUrl: string;
};

export function passwordResetEmail(input: PasswordResetEmailInput): MailMessage {
  const subject = 'Atur ulang password akun Fund for Indonesia';
  const greeting = `Halo ${input.name},`;
  const body = [
    'Kami menerima permintaan untuk mengatur ulang password akun Fund for Indonesia Anda. Buka tautan berikut untuk membuat password baru.',
    'Tautan berlaku 60 menit dan hanya bisa dipakai sekali. Jika Anda tidak meminta ini, abaikan email ini; password Anda tidak berubah.',
  ];
  const closing = 'Salam,\nTim Fund for Indonesia';

  const text = [greeting, ...body, input.resetUrl, closing].join('\n\n');
  const url = escapeHtml(input.resetUrl);
  const html = [
    `<p>${escapeHtml(greeting)}</p>`,
    ...body.map((line) => `<p>${escapeHtml(line)}</p>`),
    `<p><a href="${url}">${url}</a></p>`,
    `<p>${escapeHtml(closing).replace('\n', '<br>')}</p>`,
  ].join('\n');

  return { to: input.to, subject, text, html };
}
