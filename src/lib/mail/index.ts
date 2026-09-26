import { MockMailer } from './mock-mailer';
import { SmtpMailer } from './smtp-mailer';
import type { Mailer, MailMessage } from './types';

export { MockMailer } from './mock-mailer';
export { SmtpMailer } from './smtp-mailer';
export type { SmtpConfig, CreateTransport } from './smtp-mailer';
export type { Mailer, MailMessage } from './types';

/**
 * Raised when the Mailer cannot be built because it is not configured. Loud
 * on purpose: a platform that silently sends nothing tells a Fundraiser
 * nothing, and nobody notices until they ask.
 */
export class MailerNotConfiguredError extends Error {
  constructor(problem: string) {
    super(`${problem}. The Mailer refuses to run unconfigured rather than send nothing.`);
    this.name = 'MailerNotConfiguredError';
  }
}

/** Raised for a MAIL_PROVIDER this build does not have; never falls back to another. */
export class UnknownMailerError extends Error {
  constructor(name: string) {
    super(`No Mailer named ${JSON.stringify(name)} is registered.`);
    this.name = 'UnknownMailerError';
  }
}

/** An empty value counts as unset, as a key with no value in a .env file does. */
function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new MailerNotConfiguredError(`${key} is not set`);
  return value;
}

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

function smtpPort(): number {
  const raw = requireEnv('SMTP_PORT');
  const port = Number(raw);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new MailerNotConfiguredError(`SMTP_PORT must be a port number, not ${JSON.stringify(raw)}`);
  }
  return port;
}

/** Exactly "true" or "false"; unset means TLS from the start on 465 (smtps) and STARTTLS elsewhere. */
function smtpSecure(port: number): boolean {
  const raw = process.env.SMTP_SECURE;
  if (!raw) return port === 465;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new MailerNotConfiguredError(`SMTP_SECURE must be "true" or "false", not ${JSON.stringify(raw)}`);
}

const BUILDERS: Record<string, () => Mailer> = {
  mock: () => {
    if (isProduction()) {
      throw new MailerNotConfiguredError(
        'MAIL_PROVIDER=mock is refused in production, where it would deliver nothing',
      );
    }
    return new MockMailer();
  },
  smtp: () => {
    const port = smtpPort();
    return new SmtpMailer({
      host: requireEnv('SMTP_HOST'),
      port,
      secure: smtpSecure(port),
      user: requireEnv('SMTP_USER'),
      password: requireEnv('SMTP_PASSWORD'),
      from: requireEnv('MAIL_FROM'),
    });
  },
};

/**
 * Sends a message whose failure must not undo what it reports: a decision
 * already committed stands whether or not the email arrives. A failed send
 * is never swallowed; it is logged as one JSON line (event
 * `mail_send_failed`) naming the mail, the provider, the caller's context
 * and the error, so an operator can find it and resend. The recipient's
 * address is left out of the log; the context names them by id.
 *
 * Returns whether the provider accepted the message.
 */
export async function sendReportingFailure(
  mailer: Mailer,
  message: MailMessage,
  report: { mail: string } & Record<string, string>,
): Promise<boolean> {
  try {
    await mailer.send(message);
    return true;
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'mail_send_failed',
        ...report,
        provider: mailer.name,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return false;
  }
}

/**
 * The Mailer the platform sends through, named by MAIL_PROVIDER. Unset, it
 * is the mock in development and tests and SMTP in production, so
 * production never falls back to a Mailer that delivers nothing: without
 * the SMTP_* variables and MAIL_FROM it throws MailerNotConfiguredError.
 */
export function getMailer(): Mailer {
  const requested = process.env.MAIL_PROVIDER || (isProduction() ? 'smtp' : 'mock');
  const build = BUILDERS[requested.toLowerCase()];
  if (!build) throw new UnknownMailerError(requested);
  return build();
}
