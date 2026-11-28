import type { Mailer, MailMessage } from './types';
import { assertDeliverable } from './blocked-recipients';

/**
 * Keeps every message in memory instead of sending it: the Mailer for
 * development and tests, where `sent` is what the platform asked to send.
 * The registry never hands it out in production, where it would drop every
 * message while looking healthy.
 */
export class MockMailer implements Mailer {
  readonly name = 'mock';
  readonly sent: MailMessage[] = [];

  async send(message: MailMessage): Promise<void> {
    // Behaves like the SMTP adapter so development shows the same refusal.
    assertDeliverable(message);
    this.sent.push({ ...message });
  }
}
