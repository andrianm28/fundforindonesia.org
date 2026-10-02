import { describe, it, expect, afterEach, vi } from 'vitest';
import { assertProductionEnv } from './env-check';

afterEach(() => vi.unstubAllEnvs());

function env(values: Record<string, string>) {
  for (const k of ['RATE_LIMIT_SECRET', 'NEXTAUTH_SECRET']) vi.stubEnv(k, '');
  for (const [k, v] of Object.entries(values)) vi.stubEnv(k, v);
}

describe('assertProductionEnv', () => {
  it('fails at startup in production with neither RATE_LIMIT_SECRET nor NEXTAUTH_SECRET', () => {
    vi.stubEnv('NODE_ENV', 'production');
    env({});
    expect(() => assertProductionEnv()).toThrow(/RATE_LIMIT_SECRET/);
  });

  it('passes in production with either secret set', () => {
    vi.stubEnv('NODE_ENV', 'production');
    env({ RATE_LIMIT_SECRET: 'a' });
    expect(() => assertProductionEnv()).not.toThrow();
    env({ NEXTAUTH_SECRET: 'b' });
    expect(() => assertProductionEnv()).not.toThrow();
  });

  it('does not block development or tests without a secret', () => {
    env({});
    for (const mode of ['development', 'test']) {
      vi.stubEnv('NODE_ENV', mode);
      expect(() => assertProductionEnv()).not.toThrow();
    }
  });
});
