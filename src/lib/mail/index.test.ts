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

// Every key starts empty, which the registry reads as unset, as it does a
// .env key with no value.
beforeEach(() => {
  for (const k of ENV_KEYS) vi.stubEnv(k, '');
  vi.stubEnv('NODE_ENV', 'test');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function configureSmtp() {
  vi.stubEnv('SMTP_HOST', 'smtp.example.test');
  vi.stubEnv('SMTP_PORT', '465');
  vi.stubEnv('SMTP_USER', 'relay-user');
  vi.stubEnv('SMTP_PASSWORD', 'relay-password');
  vi.stubEnv('MAIL_FROM', 'no-reply@example.test');
}

describe('getMailer outside production', () => {
  it('resolves the mock when MAIL_PROVIDER is unset', () => {
    expect(getMailer()).toBeInstanceOf(MockMailer);
  });

  it('resolves SMTP when MAIL_PROVIDER says so', () => {
    vi.stubEnv('MAIL_PROVIDER', 'smtp');
    configureSmtp();

    expect(getMailer()).toBeInstanceOf(SmtpMailer);
  });

  it('refuses an unknown provider instead of falling back to the mock', () => {
    vi.stubEnv('MAIL_PROVIDER', 'sendgrid');

    expect(() => getMailer()).toThrow(UnknownMailerError);
  });
});

describe('getMailer in production', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'production');
  });

  it('resolves SMTP by default, so production never falls back to the mock', () => {
    configureSmtp();

    expect(getMailer()).toBeInstanceOf(SmtpMailer);
  });

  it('fails loudly when SMTP is not configured, rather than sending nothing', () => {
    expect(() => getMailer()).toThrow(MailerNotConfiguredError);
  });

  it('refuses the mock even when asked for it, because it delivers nothing', () => {
    vi.stubEnv('MAIL_PROVIDER', 'mock');

    expect(() => getMailer()).toThrow(MailerNotConfiguredError);
  });
});

describe('getMailer when SMTP is half configured', () => {
  beforeEach(() => {
    vi.stubEnv('MAIL_PROVIDER', 'smtp');
    configureSmtp();
  });

  it.each(['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'MAIL_FROM'] as const)(
    'reports %s missing',
    (key) => {
      vi.stubEnv(key, '');

      expect(() => getMailer()).toThrow(new RegExp(key));
    },
  );

  it('refuses a port that is not a number', () => {
    vi.stubEnv('SMTP_PORT', 'smtps');

    expect(() => getMailer()).toThrow(MailerNotConfiguredError);
  });

  it('refuses an SMTP_SECURE that is neither true nor false', () => {
    vi.stubEnv('SMTP_SECURE', 'yes');

    expect(() => getMailer()).toThrow(MailerNotConfiguredError);
  });
});
