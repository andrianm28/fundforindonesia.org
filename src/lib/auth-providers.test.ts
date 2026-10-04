import { describe, it, expect, afterEach, vi } from 'vitest';
import { isGoogleConfigured } from './auth-providers';

afterEach(() => vi.unstubAllEnvs());

function env(id: string, secret: string) {
  vi.stubEnv('GOOGLE_CLIENT_ID', id);
  vi.stubEnv('GOOGLE_CLIENT_SECRET', secret);
}

describe('isGoogleConfigured', () => {
  it('needs both the client id and the secret', () => {
    env('id', 's');
    expect(isGoogleConfigured()).toBe(true);
    env('id', '');
    expect(isGoogleConfigured()).toBe(false);
    env('', 's');
    expect(isGoogleConfigured()).toBe(false);
  });
  it('treats empty or blank values as not configured', () => {
    env('', '');
    expect(isGoogleConfigured()).toBe(false);
    env(' ', 's');
    expect(isGoogleConfigured()).toBe(false);
  });
});
