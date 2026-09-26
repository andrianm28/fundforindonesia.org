import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getMailer,
  MailerNotConfiguredError,
  UnknownMailerError,
  MockMailer,
  SmtpMailer,
} from './index';

/**
 * Which Mailer the platform sends through. A mock in production drops every
 * message while looking healthy, so the registry refuses it there, and a
 * half-configured SMTP relay fails when it is asked for rather than on the
 * first send.
 */

const ENV_KEYS = [
  'NODE_ENV',
  'MAIL_PROVIDER',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_SECURE',
  'SMTP_USER',
  'SMTP_PASSWORD',
  'MAIL_FROM',
] as const;

/** An empty value reads as unset, as it does in a .env file with no value. */
function setEnv(key: (typeof ENV_KEYS)[number], value: string) {
  vi.stubEnv(key, value);
}

beforeEach(() => {
  for (const k of ENV_KEYS) vi.stubEnv(k, '');
  vi.stubEnv('NODE_ENV', 'test');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function configureSmtp() {
  setEnv('SMTP_HOST', 'smtp.example.test');
  setEnv('SMTP_PORT', '465');
  setEnv('SMTP_USER', 'relay-user');
  setEnv('SMTP_PASSWORD', 'relay-password');
  setEnv('MAIL_FROM', 'no-reply@example.test');
}

describe('getMailer outside production', () => {
  it('resolves the mock when MAIL_PROVIDER is unset', () => {
    expect(getMailer()).toBeInstanceOf(MockMailer);
  });

  it('resolves SMTP when MAIL_PROVIDER says so', () => {
    setEnv('MAIL_PROVIDER', 'smtp');
    configureSmtp();

    expect(getMailer()).toBeInstanceOf(SmtpMailer);
  });

  it('refuses an unknown provider instead of falling back to the mock', () => {
    setEnv('MAIL_PROVIDER', 'sendgrid');

    expect(() => getMailer()).toThrow(UnknownMailerError);
  });
});

describe('getMailer in production', () => {
  beforeEach(() => {
    setEnv('NODE_ENV', 'production');
  });

  it('resolves SMTP by default, so production never falls back to the mock', () => {
    configureSmtp();

    expect(getMailer()).toBeInstanceOf(SmtpMailer);
  });

  it('fails loudly when SMTP is not configured, rather than sending nothing', () => {
    expect(() => getMailer()).toThrow(MailerNotConfiguredError);
  });

  it('refuses the mock even when asked for it, because it delivers nothing', () => {
    setEnv('MAIL_PROVIDER', 'mock');

    expect(() => getMailer()).toThrow(MailerNotConfiguredError);
  });
});

describe('getMailer when SMTP is half configured', () => {
  beforeEach(() => {
    setEnv('MAIL_PROVIDER', 'smtp');
    configureSmtp();
  });

  it.each(['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'MAIL_FROM'] as const)(
    'reports %s missing',
    (key) => {
      setEnv(key, '');

      expect(() => getMailer()).toThrow(new RegExp(key));
    },
  );

  it('refuses a port that is not a number', () => {
    setEnv('SMTP_PORT', 'smtps');

    expect(() => getMailer()).toThrow(MailerNotConfiguredError);
  });

  it('refuses an SMTP_SECURE that is neither true nor false', () => {
    setEnv('SMTP_SECURE', 'yes');

    expect(() => getMailer()).toThrow(MailerNotConfiguredError);
  });
});
