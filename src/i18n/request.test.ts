import { describe, it, expect, vi } from 'vitest';

// The real one refuses to load outside the server bundle; it only returns its argument.
vi.mock('next-intl/server', () => ({ getRequestConfig: (fn: unknown) => fn }));

import requestConfig from './request';
import { messages } from './messages';

const resolve = (requestLocale: string | undefined) =>
  (requestConfig as unknown as (p: { requestLocale: Promise<string | undefined> }) => Promise<{ locale: string; messages: unknown }>)({
    requestLocale: Promise.resolve(requestLocale),
  });

describe('request config: the locale the proxy tagged the request with', () => {
  it('is English with the English catalogue for en', async () => {
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
    for (const tag of ['fr', 'EN', 'en-US', '']) expect((await resolve(tag)).locale).toBe('id');
  });
});
