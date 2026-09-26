import type { Mailer, MailMessage } from './types';

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
    this.sent.push({ ...message });
  }
}
