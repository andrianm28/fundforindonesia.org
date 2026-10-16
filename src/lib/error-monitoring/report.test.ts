import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseDsn, reportError, buildEvent } from './report';

const DSN = 'https://publickey123@errors.example.test/42';

describe('parseDsn', () => {
  it('derives the store endpoint and key', () => {
    expect(parseDsn(DSN)).toEqual({ endpoint: 'https://errors.example.test/api/42/store/', publicKey: 'publickey123' });
  });
  it('keeps a path prefix', () => {
    expect(parseDsn('https://k@h.example.test/prefix/7')?.endpoint).toBe('https://h.example.test/prefix/api/7/store/');
  });
  it.each([undefined, '', 'not a url', 'https://h.example.test/1', 'ftp://k@h.example.test/1', 'https://k@h.example.test'])(
    'rejects %s',
    (raw) => expect(parseDsn(raw as string | undefined)).toBeNull(),
  );
});

describe('reportError', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('never calls fetch without SENTRY_DSN', () => {
    vi.stubEnv('SENTRY_DSN', '');
    reportError(new Error('boom'), { url: '/x' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never calls fetch with an unusable DSN', () => {
    vi.stubEnv('SENTRY_DSN', 'garbage');
    reportError(new Error('boom'));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts a scrubbed event with the Sentry auth header', () => {
    vi.stubEnv('SENTRY_DSN', DSN);
    reportError(new Error('cannot email donor@example.test acct 1234567890123'), {
      url: '/receipt/SECRETTOKEN/pdf',
      method: 'GET',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://errors.example.test/api/42/store/');
    expect(init.method).toBe('POST');
    expect(init.headers['X-Sentry-Auth']).toMatch(/^Sentry sentry_version=7, sentry_key=publickey123, sentry_client=/);
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.body).not.toContain('donor@example.test');
    expect(init.body).not.toContain('1234567890123');
    expect(init.body).not.toContain('SECRETTOKEN');
    expect(JSON.parse(init.body).exception.values[0].type).toBe('Error');
  });

  it('never throws, even when fetch throws or rejects', () => {
    vi.stubEnv('SENTRY_DSN', DSN);
    fetchMock.mockImplementationOnce(() => {
      throw new Error('sync');
    });
    expect(() => reportError(new Error('a'))).not.toThrow();
    fetchMock.mockRejectedValueOnce(new Error('async'));
    expect(() => reportError(new Error('b'))).not.toThrow();
  });
});

describe('buildEvent', () => {
  it('copes with non-Error values', () => {
    expect(buildEvent('plain string').exception.values[0].value).toBe('plain string');
    expect(buildEvent({ any: 1 }).exception.values[0].value).toBe('Non-error thrown');
  });
});
