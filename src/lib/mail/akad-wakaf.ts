import { formatRupiah } from '@/lib/utils/currency';
import type { MailMessage } from './types';

/**
 * The Akad Wakaf's own facts (CONTEXT.md, Akad Wakaf): the Wakif's name, the
 * amount, the purpose (peruntukan -- the Campaign's stated title, the same
 * one the Receipt already names as what the Donation was for) and the
 * nazhir (the Collecting Entity, ADR 0010: "Receipt and Akad Wakaf name the
 * collecting entity, not the platform" -- there is no separate Nazhir entity
 * in this schema).
 */
export type AkadWakafInput = {
  wakifName: string | null;
  amount: number;
  purpose: string;
  nazhirName: string;
  printUrl: string;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Appends the Akad Wakaf as a section of an already-built Receipt email
 * (PRD: "Akad Wakaf terkirim bersama Receipt" -- one delivery, not a second
 * email with its own send failure to handle) rather than replacing it. The
 * `to` and `subject` stay the Receipt's own; only `text` and `html` grow.
 */
export function withAkadWakaf(message: MailMessage, input: AkadWakafInput): MailMessage {
  const heading = 'Akad Wakaf';
  const wakif = input.wakifName ?? 'Wakif';
  const lines = [
    `Wakif: ${wakif}`,
    `Nominal: ${formatRupiah(input.amount)}`,
    `Peruntukan: ${input.purpose}`,
    `Nazhir: ${input.nazhirName}`,
    'Dokumen Akad Wakaf ini dapat dibuka dan dicetak kembali kapan saja lewat tautan berikut:',
  ];

  const text = [message.text, heading, ...lines, input.printUrl].join('\n\n');

  const url = escapeHtml(input.printUrl);
  const html = [
    message.html,
    `<h2>${escapeHtml(heading)}</h2>`,
    ...lines.map((line) => `<p>${escapeHtml(line)}</p>`),
    `<p><a href="${url}">${url}</a></p>`,
  ].join('\n');

  return { ...message, text, html };
}
