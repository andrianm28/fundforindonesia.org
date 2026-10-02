import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { donationsEnabled, sandboxInProductionReason } from './donations';
import { setEnv } from '../../tests/support/mutable-env';

/**
 * The gate is now two decisions, not one.
 *
 * `donationsEnabled` is the deliberate switch: off unless somebody turns it
 * on, so development can run the whole flow against the Sumopod sandbox
 * while production stays shut.
 *
 * `sandboxInProductionReason` is the interlock behind it, and it is the one
 * that matters. Sandbox credentials in production take real rupiah into an
 * account that settles nowhere: the donor pays, sees a receipt page, and the
 * money does not exist. No amount of care at deploy time makes that
 * recoverable, so it is refused in code rather than remembered in a runbook.
 */

const KEYS = ['NEXT_PUBLIC_DONATIONS_ENABLED', 'PAYMENT_PROVIDER', 'SUMOPOD_BASE_URL', 'NODE_ENV'] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) setEnv(k, undefined);
});

afterEach(() => {
  for (const k of KEYS) setEnv(k, saved[k]);
});

describe('donationsEnabled', () => {
  it('is off when nothing is set, so a fresh deployment never takes money by accident', () => {
    expect(donationsEnabled()).toBe(false);
  });

  it('is on only for the exact string true', () => {
    setEnv('NEXT_PUBLIC_DONATIONS_ENABLED', 'true');

    expect(donationsEnabled()).toBe(true);
  });

  it('is off for false', () => {
    setEnv('NEXT_PUBLIC_DONATIONS_ENABLED', 'false');

    expect(donationsEnabled()).toBe(false);
  });

  it('is off for anything else, rather than guessing what was meant', () => {
    // "1", "yes", "TRUE" and a stray space are all somebody almost turning
    // it on. Guessing in the permissive direction turns a typo into live
    // money collection.
    for (const value of ['1', 'yes', 'TRUE', 'true ', '']) {
      setEnv('NEXT_PUBLIC_DONATIONS_ENABLED', value);
      expect(donationsEnabled()).toBe(false);
    }
  });
});

describe('sandboxInProductionReason', () => {
  it('allows the sandbox outside production, which is how development runs', () => {
    setEnv('NODE_ENV', 'development');
    setEnv('PAYMENT_PROVIDER', 'sumopod');
    setEnv('SUMOPOD_BASE_URL', 'https://api-pay-sandbox.sumopod.com/api/v1');

    expect(sandboxInProductionReason()).toBeNull();
  });

  it('refuses the sandbox in production', () => {
    setEnv('NODE_ENV', 'production');
    setEnv('PAYMENT_PROVIDER', 'sumopod');
    setEnv('SUMOPOD_BASE_URL', 'https://api-pay-sandbox.sumopod.com/api/v1');

    expect(sandboxInProductionReason()).toMatch(/sandbox/i);
  });

  it('allows a production base url in production', () => {
    setEnv('NODE_ENV', 'production');
    setEnv('PAYMENT_PROVIDER', 'sumopod');
    setEnv('SUMOPOD_BASE_URL', 'https://api-pay.sumopod.com/api/v1');

    expect(sandboxInProductionReason()).toBeNull();
  });

  it('refuses a missing base url in production rather than assuming it is live', () => {
    setEnv('NODE_ENV', 'production');
    setEnv('PAYMENT_PROVIDER', 'sumopod');

    expect(sandboxInProductionReason()).not.toBeNull();
  });

  it('refuses the mock provider in production, whatever the urls say', () => {
    // The mock fabricates a VA number no bank issued. It is not a sandbox
    // that settles late; it is a charge nobody can ever pay.
    setEnv('NODE_ENV', 'production');
    setEnv('PAYMENT_PROVIDER', 'mock');

    expect(sandboxInProductionReason()).toMatch(/mock/i);
  });

  it('allows the mock outside production', () => {
    setEnv('NODE_ENV', 'test');
    setEnv('PAYMENT_PROVIDER', 'mock');

    expect(sandboxInProductionReason()).toBeNull();
  });

  it('refuses a PAYMENT_PROVIDER this build has no provider for, rather than passing an unknown one through', () => {
    // The bug this closes: the guard compared the name against two string
    // literals of its own, so a name the registry does not know matched
    // neither and every donation was allowed. Its coverage came from a list
    // separate from the one that says which providers exist, which is how
    // adding a third one has to touch two places and forget this one.
    //
    // Refused rather than passed through, on the module's own rule: the safe
    // reading of a misconfiguration on the money path is "do not take money".
    // Nothing is lost by it -- getPaymentProvider throws on the same name a
    // few lines later, so this route was already refusing, as a 500.
    setEnv('NODE_ENV', 'production');
    setEnv('PAYMENT_PROVIDER', 'xendit');

    expect(sandboxInProductionReason()).toMatch(/xendit/);
  });

  it('refuses a PAYMENT_PROVIDER nobody can read at all, rather than assuming the default is live', () => {
    // The same refusal for a name that is not a name: whatever the operator
    // meant to write, this build cannot resolve it, so it cannot have judged
    // its sandbox.
    setEnv('NODE_ENV', 'production');
    setEnv('PAYMENT_PROVIDER', '   ');

    expect(sandboxInProductionReason()).not.toBeNull();
  });
});
