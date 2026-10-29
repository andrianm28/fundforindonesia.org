import { greetingFor, letter, oneLine } from './letter';
import type { MailMessage } from './types';

/**
 * What a Fundraiser is told when an Admin imposes a Suspension on their
 * Campaign and when one is lifted (PRD §7.2; ADR 0015; ticket
 * rilis-1-benda/68), with the Admin's reason: the same reason the in-app
 * Notification already shows them.
 */
export type SuspensionEmailInput = {
  to: string;
  fundraiserName: string | null;
  campaignTitle: string;
  reason: string;
  /** The Fundraiser's own screen for the Campaign. */
  campaignUrl: string;
} & ({ event: 'suspended' } | { event: 'lifted'; statusLabel: string });

export function suspensionEmail(input: SuspensionEmailInput): MailMessage {
  const title = oneLine(input.campaignTitle);
  const reason = `Alasan: ${input.reason}`;

  if (input.event === 'suspended') {
    return letter({
      to: input.to,
      subject: `Campaign "${title}" dibekukan (Suspended)`,
      greeting: greetingFor(input.fundraiserName),
      body: [
        `Campaign "${input.campaignTitle}" dibekukan (Suspended) oleh Admin.`,
        reason,
        'Selama Suspended, Campaign tidak menerima donasi dan dananya tidak dapat dicairkan. Lihat Campaign Anda di tautan ini:',
      ],
      url: input.campaignUrl,
    });
  }

  return letter({
    to: input.to,
    subject: `Suspension Campaign "${title}" dicabut`,
    greeting: greetingFor(input.fundraiserName),
    body: [
      `Suspension atas Campaign "${input.campaignTitle}" telah dicabut oleh Admin. Campaign kini ${input.statusLabel}.`,
      reason,
      'Lihat Campaign Anda di tautan ini:',
    ],
    url: input.campaignUrl,
  });
}
