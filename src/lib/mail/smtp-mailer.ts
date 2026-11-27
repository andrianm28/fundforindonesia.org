import nodemailer, { type SendMailOptions } from 'nodemailer';
import type { Mailer, MailMessage } from './types';

export type SmtpConfig = {
  host: string;
  port: number;
  /** TLS from the first byte (smtps, port 465) rather than STARTTLS. */
  secure: boolean;
  user: string;
  password: string;
  /** The From address, e.g. no-reply@fundforindonesia.org. */
  from: string;
};

/** The one call this adapter makes on a nodemailer transport. */
type Transport = { sendMail(mail: SendMailOptions): Promise<unknown> };

/** How the adapter builds its transport; swapped in tests so none opens a socket. */
export type CreateTransport = (options: {
  host: string;
  port: number;
  secure: boolean;
  auth: { user: string; pass: string };
  connectionTimeout: number;
  greetingTimeout: number;
  socketTimeout: number;
}) => Transport;

/**
 * A slow relay holds the request that sends, which the Verifier is waiting
 * on. Each phase (connecting, the greeting, any quiet socket) is cut off
 * after this, so a stalled relay fails within a few multiples of it and is
 * reported like any other failure.
 */
const TIMEOUT_MS = 10_000;

/**
 * Domains this platform never sends to (owner decision 2026-11-27): a
 * private address that must never receive mail from Fund for Indonesia,
 * whoever registers it. A domain covers its subdomains. It is code, not
 * configuration, so no missing or mistyped variable can lift it.
 */
const BLOCKED_RECIPIENT_DOMAINS = ['eliteacademy.id'];

function addressOf(recipient: string): string {
  const bracketed = /<([^>]*)>/.exec(recipient);
  return (bracketed ? bracketed[1] : recipient).trim().toLowerCase();
}

function isBlocked(recipient: string): boolean {
  const domain = addressOf(recipient).split('@').pop() ?? '';
  return BLOCKED_RECIPIENT_DOMAINS.some((blocked) => domain === blocked || domain.endsWith(`.${blocked}`));
}

/** Sends through an SMTP relay (production: the Sumopod relay, smtp.sumopod.com:465). */
export class SmtpMailer implements Mailer {
  readonly name = 'smtp';
  private readonly transport: Transport;
  private readonly from: string;

  constructor(config: SmtpConfig, createTransport: CreateTransport = nodemailer.createTransport) {
    this.from = config.from;
    this.transport = createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: { user: config.user, pass: config.password },
      connectionTimeout: TIMEOUT_MS,
      greetingTimeout: TIMEOUT_MS,
      socketTimeout: TIMEOUT_MS,
    });
  }

  /**
   * A blocked recipient is dropped before the relay sees it, and a message
   * left with nobody to send to resolves without sending: refusing it would
   * put it in the failed notification queue, which would retry it forever.
   * The drop is logged as one JSON line, without the address.
   */
  async send(message: MailMessage): Promise<void> {
    const recipients = message.to.split(',').map((r) => r.trim()).filter(Boolean);
    const allowed = recipients.filter((r) => !isBlocked(r));
    if (allowed.length < recipients.length) {
      console.warn(
        JSON.stringify({ event: 'mail_recipient_blocked', dropped: recipients.length - allowed.length }),
      );
    }
    if (allowed.length === 0) return;
    await this.transport.sendMail({
      from: this.from,
      to: allowed.join(', '),
      subject: message.subject,
      text: message.text,
      html: message.html,
      ...(message.replyTo ? { replyTo: message.replyTo } : {}),
    });
  }
}
