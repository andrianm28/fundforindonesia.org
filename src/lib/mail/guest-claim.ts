import { escapeHtml } from './escape-html';
import type { MailMessage } from './types';

/**
 * The link that lets a signed-in account claim the Guest Donations made under
 * its own verified address (prd-audit 08).
 */
export type GuestClaimEmailInput = {
  to: string;
  name: string;
  claimUrl: string;
};

export function guestClaimEmail(input: GuestClaimEmailInput): MailMessage {
  const subject = 'Tautkan donasi tamu ke akun Fund for Indonesia';
  const greeting = `Halo ${input.name},`;
  const body = [
    'Buka tautan berikut, lalu tekan tombol konfirmasi, agar donasi yang pernah Anda berikan sebagai tamu dengan email ini muncul di riwayat donasi akun Anda.',
    'Tautan berlaku 24 jam, hanya bisa dipakai sekali, dan hanya berfungsi di akun yang memintanya. Jika Anda tidak meminta ini, abaikan email ini; tidak ada yang berubah.',
  ];
  const closing = 'Salam,\nTim Fund for Indonesia';

  const text = [greeting, ...body, input.claimUrl, closing].join('\n\n');
  const url = escapeHtml(input.claimUrl);
  const html = [
    `<p>${escapeHtml(greeting)}</p>`,
    ...body.map((line) => `<p>${escapeHtml(line)}</p>`),
    `<p><a href="${url}">${url}</a></p>`,
    `<p>${escapeHtml(closing).replace('\n', '<br>')}</p>`,
  ].join('\n');

  return { to: input.to, subject, text, html };
}
