/**
 * One email, as the platform composes it. The sender is not here: it is the
 * Mailer's configuration (MAIL_FROM), so no caller can send as someone else.
 */
export type MailMessage = {
  to: string;
  subject: string;
  /** The plain-text body; every message carries one for clients that show no HTML. */
  text: string;
  html: string;
  /**
   * Where a reply goes, when not to the sender: e.g. the company behind a
   * Partnership Inquiry, so the partnership team answers it from their own
   * mail client. Never the From -- that stays the Mailer's (MAIL_FROM).
   */
  replyTo?: string;
};

/**
 * How the platform sends email. A send that resolves was accepted by the
 * provider; one that rejects was not, and the caller decides what that means.
 * Adapters live beside this file and are chosen by ./index.ts.
 */
export interface Mailer {
  readonly name: string;
  send(message: MailMessage): Promise<void>;
}
