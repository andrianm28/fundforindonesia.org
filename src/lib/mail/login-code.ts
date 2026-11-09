import { escapeHtml } from './escape-html';
import type { MailMessage } from './types';
import { emailLogoHtml } from './email-logo';

/**
 * The one-time sign-in code (login OTP, src/lib/login-code.ts). Sent only to an
 * address that has an account; the request endpoint answers the same either
 * way. The code is in the subject too, so it can be read from a notification.
 */
export type LoginCodeEmailInput = {
  to: string;
  name: string;
  code: string;
  ttlMinutes: number;
};

export function loginCodeEmail(input: LoginCodeEmailInput): MailMessage {
  const subject = `${input.code} adalah kode masuk Fund for Indonesia Anda`;
  const greeting = `Halo ${input.name},`;
  const intro = 'Gunakan kode berikut untuk masuk ke akun Fund for Indonesia Anda:';
  const notes = [
    `Kode berlaku ${input.ttlMinutes} menit dan hanya bisa dipakai sekali. Jangan berikan kode ini kepada siapa pun, termasuk yang mengaku dari Fund for Indonesia.`,
    'Jika Anda tidak sedang mencoba masuk, abaikan email ini; tidak ada yang bisa masuk tanpa kode ini.',
  ];
  const closing = 'Salam,\nTim Fund for Indonesia';

  const text = [greeting, intro, input.code, ...notes, closing].join('\n\n');
  const html = [
    emailLogoHtml(),
    `<p>${escapeHtml(greeting)}</p>`,
    `<p>${escapeHtml(intro)}</p>`,
    `<p style="font-size:28px;font-weight:bold;letter-spacing:6px">${escapeHtml(input.code)}</p>`,
    ...notes.map((line) => `<p>${escapeHtml(line)}</p>`),
    `<p>${escapeHtml(closing).replace('\n', '<br>')}</p>`,
  ].join('\n');

  return { to: input.to, subject, text, html };
}
