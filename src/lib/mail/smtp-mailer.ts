import nodemailer from 'nodemailer';
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
type Transport = { sendMail(mail: nodemailer.SendMailOptions): Promise<unknown> };

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

  async send(message: MailMessage): Promise<void> {
    await this.transport.sendMail({
      from: this.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
  }
}
