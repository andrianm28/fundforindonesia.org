import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isStagingDeployment, seedRefusal } from './deploy-environment';
import { setEnv } from '../../tests/support/mutable-env';

const KEYS = ['DEPLOY_ENVIRONMENT', 'NODE_ENV'] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) setEnv(k, undefined);
});

afterEach(() => {
  for (const k of KEYS) setEnv(k, saved[k]);
});

describe('isStagingDeployment', () => {
  it('is off by default, so no deployment is staging by accident', () => {
    expect(isStagingDeployment()).toBe(false);
  });

  it('is on only for the exact string staging', () => {
    setEnv('DEPLOY_ENVIRONMENT', 'staging');
    expect(isStagingDeployment()).toBe(true);

    for (const almost of ['Staging', 'STAGING', 'staging ', 'true', '1', 'production', '']) {
      setEnv('DEPLOY_ENVIRONMENT', almost);
      expect(isStagingDeployment(), JSON.stringify(almost)).toBe(false);
    }
  });
});

describe('seedRefusal', () => {
  // The seed creates Users with a public password. It may run on a
  // developer's machine and on staging, never on a production deployment.
  it('allows a development or test environment', () => {
    expect(seedRefusal()).toBeNull();
    setEnv('NODE_ENV', 'development');
    expect(seedRefusal()).toBeNull();
    setEnv('NODE_ENV', 'test');
    expect(seedRefusal()).toBeNull();
  });

  it('refuses production, and says why', () => {
    setEnv('NODE_ENV', 'production');
    expect(seedRefusal()).toMatch(/public password/i);
  });

  it('allows production-mode only for an explicit staging deployment', () => {
    setEnv('NODE_ENV', 'production');
    setEnv('DEPLOY_ENVIRONMENT', 'staging');
    expect(seedRefusal()).toBeNull();
  });
});
