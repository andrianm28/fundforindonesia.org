import { describe, it, expect, afterEach, vi } from 'vitest';
import { assertProductionEnv } from './env-check';

afterEach(() => vi.unstubAllEnvs());

const ENC = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='; // 32 zero bytes
const HMAC = 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE='; // 32 one bytes

const GOOD: Record<string, string> = {
  NODE_ENV: 'production',
  NEXTAUTH_SECRET: 'a-nextauth-secret',
  NEXTAUTH_URL: 'https://fundforindonesia.org',
  FIELD_ENCRYPTION_KEY: ENC,
  FIELD_ENCRYPTION_KEY_ID: 'enc-k1',
  FIELD_HMAC_KEY: HMAC,
  FIELD_HMAC_KEY_ID: 'hmac-k1',
  JOBS_SECRET: 'jobs-secret-long-enough',
};

/** Stub the whole relevant environment: GOOD, then overrides ('' unsets). */
function env(overrides: Record<string, string> = {}) {
  const all = { RATE_LIMIT_SECRET: '', ALLOW_LOCAL_AUTH_URL: '', ...GOOD, ...overrides };
  for (const [k, v] of Object.entries(all)) vi.stubEnv(k, v);
}

describe('assertProductionEnv', () => {
  it('passes in production with a complete environment', () => {
    env();
    expect(() => assertProductionEnv()).not.toThrow();
  });

  it('accepts RATE_LIMIT_SECRET in place of NEXTAUTH_SECRET', () => {
    env({ NEXTAUTH_SECRET: '', RATE_LIMIT_SECRET: 'r' });
    expect(() => assertProductionEnv()).not.toThrow();
    env({ NEXTAUTH_SECRET: '', RATE_LIMIT_SECRET: '' });
    expect(() => assertProductionEnv()).toThrow(/RATE_LIMIT_SECRET/);
  });

  it('does not block development or tests with nothing set', () => {
    for (const mode of ['development', 'test']) {
      env({
        NODE_ENV: mode,
        NEXTAUTH_SECRET: '',
        NEXTAUTH_URL: '',
        JOBS_SECRET: '',
        FIELD_ENCRYPTION_KEY: '',
        FIELD_ENCRYPTION_KEY_ID: '',
        FIELD_HMAC_KEY: '',
        FIELD_HMAC_KEY_ID: '',
      });
      expect(() => assertProductionEnv()).not.toThrow();
    }
  });

  describe('field keys (ADR 0012)', () => {
    it.each(['FIELD_ENCRYPTION_KEY', 'FIELD_ENCRYPTION_KEY_ID', 'FIELD_HMAC_KEY', 'FIELD_HMAC_KEY_ID'])(
      'fails when only %s is missing',
      (name) => {
        env({ [name]: '' });
        expect(() => assertProductionEnv()).toThrow(new RegExp(name));
      },
    );

    it('fails when none is set, naming all four', () => {
      env({ FIELD_ENCRYPTION_KEY: '', FIELD_ENCRYPTION_KEY_ID: '', FIELD_HMAC_KEY: '', FIELD_HMAC_KEY_ID: '' });
      expect(() => assertProductionEnv()).toThrow(/FIELD_ENCRYPTION_KEY.*FIELD_HMAC_KEY_ID/);
    });

    it('fails for a key that is not 32 bytes, without echoing it', () => {
      env({ FIELD_ENCRYPTION_KEY: 'c2hvcnQ=' });
      expect(() => assertProductionEnv()).toThrow(/32 bytes/);
      try {
        assertProductionEnv();
      } catch (e) {
        expect(String(e)).not.toContain('c2hvcnQ=');
      }
    });

    it('fails when one key serves both jobs', () => {
      env({ FIELD_HMAC_KEY: ENC });
      expect(() => assertProductionEnv()).toThrow(/separate secrets/);
    });
  });

  describe('JOBS_SECRET', () => {
    it('fails when unset', () => {
      env({ JOBS_SECRET: '' });
      expect(() => assertProductionEnv()).toThrow(/JOBS_SECRET/);
    });
    it('fails when too short to be a secret', () => {
      env({ JOBS_SECRET: 'short' });
      expect(() => assertProductionEnv()).toThrow(/JOBS_SECRET/);
    });
  });

  describe('NEXTAUTH_URL', () => {
    it('fails when unset', () => {
      env({ NEXTAUTH_URL: '' });
      expect(() => assertProductionEnv()).toThrow(/NEXTAUTH_URL/);
    });
    it.each([
      'http://localhost:3000',
      'https://localhost',
      'https://127.0.0.1',
      'https://10.0.0.5',
      'https://192.168.1.10',
      'https://172.20.0.1',
      'https://[::1]',
      'https://app',
      'https://app.internal',
      'http://fundforindonesia.org',
      'not a url',
    ])('rejects %s', (url) => {
      env({ NEXTAUTH_URL: url });
      expect(() => assertProductionEnv()).toThrow(/NEXTAUTH_URL/);
    });
    it.each(['https://fundforindonesia.org', 'https://galang.fundforindonesia.org', 'https://example.org/'])(
      'accepts %s',
      (url) => {
        env({ NEXTAUTH_URL: url });
        expect(() => assertProductionEnv()).not.toThrow();
      },
    );
    it('lets CI run the production bundle on localhost only with ALLOW_LOCAL_AUTH_URL=1', () => {
      env({ NEXTAUTH_URL: 'http://localhost:3000' });
      expect(() => assertProductionEnv()).toThrow(/NEXTAUTH_URL/);
      env({ NEXTAUTH_URL: 'http://localhost:3000', ALLOW_LOCAL_AUTH_URL: '1' });
      expect(() => assertProductionEnv()).not.toThrow();
    });
    it('still requires NEXTAUTH_URL to be set under ALLOW_LOCAL_AUTH_URL', () => {
      env({ NEXTAUTH_URL: '', ALLOW_LOCAL_AUTH_URL: '1' });
      expect(() => assertProductionEnv()).toThrow(/NEXTAUTH_URL/);
    });
  });

  it('reports every problem at once', () => {
    env({ JOBS_SECRET: '', NEXTAUTH_URL: 'http://localhost:3000', FIELD_HMAC_KEY: '' });
    let message = '';
    try {
      assertProductionEnv();
    } catch (e) {
      message = String(e);
    }
    expect(message).toMatch(/JOBS_SECRET/);
    expect(message).toMatch(/NEXTAUTH_URL/);
    expect(message).toMatch(/FIELD_HMAC_KEY/);
  });
});

describe('assertProductionEnv in the public beta (ticket rilis-1-benda/94)', () => {
  const SANDBOX = 'https://api-pay-sandbox.sumopod.com/api/v1';
  const LIVE_URL = 'https://api-pay.sumopod.com/api/v1';
  const beta = (overrides: Record<string, string> = {}) =>
    env({ BETA_SANDBOX: 'true', PAYMENT_PROVIDER: 'sumopod', SUMOPOD_BASE_URL: SANDBOX, ...overrides });

  it('boots with the marker on and only the Sumopod sandbox configured', () => {
    beta();
    expect(() => assertProductionEnv()).not.toThrow();
  });

  it('refuses to boot with the marker on beside a live Sumopod url, naming the variable and never echoing its value', () => {
    beta({ SUMOPOD_BASE_URL: LIVE_URL });
    expect(() => assertProductionEnv()).toThrow(/SUMOPOD_BASE_URL/);
    try {
      assertProductionEnv();
    } catch (e) {
      expect((e as Error).message).not.toContain(LIVE_URL);
    }
  });

  it('refuses a live Sumopod url even while another provider is the active one: it is one Admin click from taking real money', () => {
    beta({ PAYMENT_PROVIDER: 'mock', SUMOPOD_BASE_URL: LIVE_URL });
    expect(() => assertProductionEnv()).toThrow(/live Sumopod credential/);
  });

  it('refuses a lookalike host that merely contains "sandbox"', () => {
    for (const url of ['https://api-pay.sumopod.com/sandbox', 'https://api-pay-sandbox.sumopod.com.evil.example/x', 'http://api-pay-sandbox.sumopod.com']) {
      beta({ SUMOPOD_BASE_URL: url });
      expect(() => assertProductionEnv()).toThrow(/SUMOPOD_BASE_URL/);
    }
  });

  it('applies none of this once the marker is gone: go-live is the live url with no marker', () => {
    env({ BETA_SANDBOX: '', PAYMENT_PROVIDER: 'sumopod', SUMOPOD_BASE_URL: LIVE_URL });
    expect(() => assertProductionEnv()).not.toThrow();
  });
});
