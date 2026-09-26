import { describe, it, expect } from 'vitest';
import { SmtpMailer, type CreateTransport } from './smtp-mailer';

/**
 * The adapter's whole job is to hand the relay the right options and the
 * right message. A stand-in transport records both, so no test opens a socket.
 */

const CONFIG = {
  host: 'smtp.example.test',
  port: 465,
  secure: true,
  user: 'relay-user',
  password: 'relay-password',
  from: 'no-reply@example.test',
};

function recordingTransport(sendMail: (mail: unknown) => Promise<unknown> = async () => ({})) {
  const calls: { options: Parameters<CreateTransport>[0] | null; mails: unknown[] } = {
    options: null,
    mails: [],
  };
  const createTransport: CreateTransport = (options) => {
    calls.options = options;
    return {
      sendMail: async (mail) => {
        calls.mails.push(mail);
        return sendMail(mail);
      },
    };
  };
  return { calls, createTransport };
}

const MESSAGE = {
  to: 'fundraiser@example.test',
  subject: 'Campaign Anda diloloskan',
  text: 'teks',
  html: '<p>teks</p>',
};

describe('SmtpMailer', () => {
  it('connects to the configured relay with its credentials, over TLS from the start', () => {
    const { calls, createTransport } = recordingTransport();

    new SmtpMailer(CONFIG, createTransport);

    expect(calls.options).toMatchObject({
      host: 'smtp.example.test',
      port: 465,
      secure: true,
      auth: { user: 'relay-user', pass: 'relay-password' },
    });
  });

  it('bounds how long a slow relay can hold the request', () => {
    const { calls, createTransport } = recordingTransport();

    new SmtpMailer(CONFIG, createTransport);

    expect(calls.options?.connectionTimeout).toBeGreaterThan(0);
    expect(calls.options?.socketTimeout).toBeGreaterThan(0);
  });

  it('sends the message from MAIL_FROM, whoever composed it', async () => {
    const { calls, createTransport } = recordingTransport();

    await new SmtpMailer(CONFIG, createTransport).send(MESSAGE);

    expect(calls.mails).toEqual([
      {
        from: 'no-reply@example.test',
        to: 'fundraiser@example.test',
        subject: 'Campaign Anda diloloskan',
        text: 'teks',
        html: '<p>teks</p>',
      },
    ]);
  });

  it('rejects when the relay refuses, so the caller can report it', async () => {
    const { createTransport } = recordingTransport(async () => {
      throw new Error('535 Authentication failed');
    });

    await expect(new SmtpMailer(CONFIG, createTransport).send(MESSAGE)).rejects.toThrow(
      '535 Authentication failed',
    );
  });
});
