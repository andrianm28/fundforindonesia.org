import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { paymentProviderProductionRefusal } from './production-readiness';
import { PAYMENT_PROVIDER_NAMES } from './provider-names';

/**
 * The refusal that keeps a real donation site from taking real rupiah through a
 * provider that is only a sandbox.
 *
 * It used to live in src/lib/donations.ts as two string literals compared
 * against PAYMENT_PROVIDER, in a file with nothing to do with the registry, and
 * the donation route calls it BEFORE getPaymentProvider is reached. So its
 * coverage was a second list of the providers this build has, and the two could
 * drift: a name in the registry and not in those two was a provider taking real
 * money with nothing having looked at whether it was a sandbox.
 *
 * These tests are about that, not about any one provider's rule. A rule that
 * says "refuse" is worth having; a provider nobody thought about is not.
 */

const KEYS = ['PAYMENT_PROVIDER', 'SUMOPOD_BASE_URL', 'BETA_SANDBOX'] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('paymentProviderProductionRefusal', () => {
  it('refuses every provider this build knows, in a production environment that has configured none of them', () => {
    // The claim that makes the table a rule rather than a convention: no
    // provider is allowed by default. A bare production environment -- no
    // PAYMENT_PROVIDER, no base url -- must be refused for every name the
    // registry knows, so a provider added tomorrow with a permissive rule and no
    // judgement behind it fails HERE rather than on a donor's card.
    for (const name of PAYMENT_PROVIDER_NAMES) {
      expect(paymentProviderProductionRefusal(name)).not.toBeNull();
    }
  });

  it('refuses a name the registry does not know, rather than consulting no rule and allowing it', () => {
    // The hole the second list left: a name that is neither 'mock' nor 'sumopod'
    // matched neither branch and every donation was allowed. Not a name this
    // build can have judged, so refused -- and named in the reason, because the
    // person who has to fix it reads this in a log.
    const reason = paymentProviderProductionRefusal('xendit');

    expect(reason).toMatch(/xendit/);
  });

  it('asks the registry rather than the spelling, so a name typed in any case is the provider it means', () => {
    process.env.SUMOPOD_BASE_URL = 'https://api-pay.sumopod.com/api/v1';

    expect(paymentProviderProductionRefusal('SumoPod')).toBeNull();
    expect(paymentProviderProductionRefusal('MOCK')).toMatch(/mock/i);
  });

  it('allows a provider whose own configuration says it is live, and refuses the same provider sandboxed', () => {
    // The per-provider rules themselves, still: a rule that refuses everything
    // would satisfy the test above and take donations in production.
    process.env.SUMOPOD_BASE_URL = 'https://api-pay.sumopod.com/api/v1';
    expect(paymentProviderProductionRefusal('sumopod')).toBeNull();

    process.env.SUMOPOD_BASE_URL = 'https://api-pay-sandbox.sumopod.com/api/v1';
    expect(paymentProviderProductionRefusal('sumopod')).toMatch(/sandbox/i);
  });
});

/**
 * The public beta (ticket rilis-1-benda/92) is the one place the sandbox is
 * allowed to take charges while the process still runs with NODE_ENV=production
 * (the image sets it). The permission is an explicit marker, never a default,
 * and it cuts both ways: a beta stack that points at the live base url is
 * refused too, because the reason the beta exists is that no real rupiah moves.
 */
describe('paymentProviderProductionRefusal in the beta', () => {
  const SANDBOX = 'https://api-pay-sandbox.sumopod.com/api/v1';
  const LIVE = 'https://api-pay.sumopod.com/api/v1';

  it('allows the Sumopod sandbox only when BETA_SANDBOX is exactly true', () => {
    process.env.SUMOPOD_BASE_URL = SANDBOX;
    expect(paymentProviderProductionRefusal('sumopod')).toMatch(/sandbox/i);

    process.env.BETA_SANDBOX = 'true';
    expect(paymentProviderProductionRefusal('sumopod')).toBeNull();
  });

  it('does not read a near miss as the beta: the permissive direction is the dangerous one', () => {
    process.env.SUMOPOD_BASE_URL = SANDBOX;
    for (const almost of ['True', 'TRUE', ' true', 'true ', '1', 'yes', 'beta', 'false', '']) {
      process.env.BETA_SANDBOX = almost;
      expect(paymentProviderProductionRefusal('sumopod'), JSON.stringify(almost)).toMatch(/sandbox/i);
    }
  });

  it('refuses the live base url in the beta, so the beta can never take real money', () => {
    process.env.BETA_SANDBOX = 'true';
    process.env.SUMOPOD_BASE_URL = LIVE;

    expect(paymentProviderProductionRefusal('sumopod')).toMatch(/beta/i);
  });

  it('refuses a live or lookalike url that merely contains "sandbox" in the beta', () => {
    process.env.BETA_SANDBOX = 'true';
    for (const lookalike of [
      'https://api-pay.sumopod.com/api/v1?x=sandbox',
      'https://api-pay.sumopod.com/sandbox/api/v1',
      'https://sandbox.evil.example/api/v1',
      'https://api-pay-sandbox.sumopod.com.evil.example/api/v1',
      'https://evil.example/api-pay-sandbox.sumopod.com',
      'https://api-pay-sandbox.sumopod.com@evil.example/api/v1',
      'http://api-pay-sandbox.sumopod.com/api/v1',
      'not a url sandbox',
    ]) {
      process.env.SUMOPOD_BASE_URL = lookalike;
      expect(paymentProviderProductionRefusal('sumopod'), lookalike).toMatch(/beta/i);
    }
  });

  it('still refuses an unset base url in the beta, and the mock adapter, and an unknown provider', () => {
    process.env.BETA_SANDBOX = 'true';

    expect(paymentProviderProductionRefusal('sumopod')).not.toBeNull();
    expect(paymentProviderProductionRefusal('mock')).toMatch(/mock/i);
    expect(paymentProviderProductionRefusal('xendit')).toMatch(/xendit/);
  });
});
