import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

// The real one refuses to load outside the server bundle; it only returns its argument.
vi.mock('next-intl/server', () => ({ getRequestConfig: (fn: unknown) => fn }));
const incoming = vi.hoisted(() => ({ headers: new Map<string, string>() }));
vi.mock('next/headers', () => ({ headers: async () => ({ get: (k: string) => incoming.headers.get(k) ?? null }) }));

import requestConfig from './request';
import { messages } from './messages';
import { signLocale, LOCALE_SIGNATURE_HEADER } from './locale-signature';

const resolve = (requestLocale: string | undefined) =>
  (requestConfig as unknown as (p: { requestLocale: Promise<string | undefined> }) => Promise<{ locale: string; messages: unknown }>)({
    requestLocale: Promise.resolve(requestLocale),
  });

beforeEach(() => {
  vi.stubEnv('NEXTAUTH_SECRET', 'a-server-secret-that-clients-do-not-know');
  vi.stubEnv('I18N_ENGLISH_ENABLED', 'true');
  incoming.headers = new Map();
});
afterEach(() => vi.unstubAllEnvs());

const signedByProxy = () => incoming.headers.set(LOCALE_SIGNATURE_HEADER, signLocale('en')!);

describe('request config: the locale the proxy tagged the request with', () => {
  it('is English with the English catalogue for a tagged, signed request while English is on', async () => {
    signedByProxy();
    const c = await resolve('en');
    expect(c.locale).toBe('en');
    expect(c.messages).toBe(messages.en);
  });

  it('is Indonesian for id, and for a request the proxy never tagged (Indonesian pages, back-office, api)', async () => {
    for (const tag of ['id', undefined]) {
      const c = await resolve(tag);
      expect(c.locale).toBe('id');
      expect(c.messages).toBe(messages.id);
    }
  });

  it('is Indonesian for anything that is not a supported language', async () => {
    signedByProxy();
    for (const tag of ['fr', 'EN', 'en-US', '']) expect((await resolve(tag)).locale).toBe('id');
  });

  it('ignores a locale header a client sent on an Indonesian path: no signature, no English', async () => {
    expect((await resolve('en')).locale).toBe('id');
  });

  it('ignores a forged signature', async () => {
    incoming.headers.set(LOCALE_SIGNATURE_HEADER, 'deadbeef');
    expect((await resolve('en')).locale).toBe('id');
    incoming.headers.set(LOCALE_SIGNATURE_HEADER, signLocale('id')!);
    expect((await resolve('en')).locale).toBe('id');
  });

  it('stays Indonesian while English is off, even with a valid signature', async () => {
    signedByProxy();
    vi.stubEnv('I18N_ENGLISH_ENABLED', '');
    expect((await resolve('en')).locale).toBe('id');
  });

  it('stays Indonesian when the server has no secret to sign with', async () => {
    signedByProxy();
    vi.stubEnv('NEXTAUTH_SECRET', '');
    expect((await resolve('en')).locale).toBe('id');
  });
});
