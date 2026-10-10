/**
 * Whether a Payment Provider may take money in this environment, per provider.
 *
 * It lives beside the registry rather than in the code that consumes the
 * answer, because the failure it exists to prevent is a provider that the
 * guard has no opinion on. That guard used to compare PAYMENT_PROVIDER against
 * two string literals of its own, in a file that had nothing to do with the
 * registry: its coverage was a second list of the same names, which drifts.
 * A name in the second list and not the first -- or a new provider added to
 * the registry and to neither -- is a provider taking real rupiah with nothing
 * checking whether it is a sandbox.
 *
 * So the knowledge is keyed on the registry's OWN union, and a name the
 * registry does not know is refused before any of it is consulted. Adding a
 * provider is then one name in provider-names.ts, one builder in index.ts, and
 * one rule here, and the first two are already a compile error if the third is
 * missing.
 *
 * Each rule answers for its own provider only, and reads only that provider's
 * own configuration. It never decides whether a reading is TRUE -- nobody here
 * can -- only whether the environment is one this platform should be charging
 * money in.
 */

import { isBetaSandbox } from '@/lib/deploy-environment';
import { canonicalPaymentProviderName, type PaymentProviderName } from './provider-names';

const SUMOPOD_SANDBOX_HOST = 'api-pay-sandbox.sumopod.com';

/**
 * Whether the url is, exactly, the Sumopod sandbox over https. The substring
 * test below is right for production, where a false "sandbox" only refuses;
 * the beta reads the answer the other way round, so there a url that merely
 * mentions "sandbox" (a query string, a path, a lookalike host) must not count.
 */
function isExactlySumopodSandbox(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    return url.protocol === 'https:' && url.hostname === SUMOPOD_SANDBOX_HOST;
  } catch {
    return false;
  }
}

/**
 * One rule per provider this build can speak to: null when it may take money
 * here, and the reason when it may not.
 *
 * Typed on the registry's union on purpose. A name with no rule below is a
 * compile error rather than a provider nobody thought about, which is the whole
 * point of moving the knowledge here.
 */
const PRODUCTION_RULES: Record<PaymentProviderName, () => string | null> = {
  mock: () =>
    'PAYMENT_PROVIDER is the mock adapter in production. It fabricates a virtual ' +
    'account number no bank issued, so every donation would be unpayable.',

  sumopod: () => {
    const baseUrl = process.env.SUMOPOD_BASE_URL;
    // Missing is refused rather than assumed live: an unset url is a
    // misconfiguration, and the safe reading of a misconfiguration on the
    // money path is "do not take money".
    if (!baseUrl) {
      return 'SUMOPOD_BASE_URL is not set in production, so there is no way to tell sandbox from live.';
    }
    // The public beta is the one deployment allowed to charge through the
    // sandbox, and only on the explicit marker (src/lib/deploy-environment.ts).
    // It is also the one deployment that must NOT have the live url: the beta
    // exists so that no real rupiah moves, so the permission is a requirement,
    // not merely a relaxation.
    if (isBetaSandbox()) {
      return isExactlySumopodSandbox(baseUrl)
        ? null
        : 'SUMOPOD_BASE_URL is not the Sumopod sandbox while BETA_SANDBOX is on. The beta must never ' +
            'take real money, so it is refused rather than charged for real.';
    }
    if (baseUrl.includes('sandbox')) {
      return (
        'SUMOPOD_BASE_URL points at the Sumopod sandbox in production. Donations would be ' +
        'charged for real and settle nowhere.'
      );
    }
    return null;
  },
};

/**
 * Why this provider must not take money in this environment, or null if it may.
 *
 * A name the registry does not know is refused rather than passed through: this
 * build has no provider by that name, so it cannot have judged anything about
 * it, and `getPaymentProvider` throws on the same name a moment later anyway --
 * which used to be the only thing standing between an unknown provider and a
 * live donation route, as a 500 rather than a refusal.
 */
export function paymentProviderProductionRefusal(name: string): string | null {
  let registered;
  try {
    registered = canonicalPaymentProviderName(name);
  } catch {
    return (
      `PAYMENT_PROVIDER is ${JSON.stringify(name)}, which is not a payment provider this build has ` +
      'registered, so whether it takes money in a sandbox cannot be known. Donations are refused ' +
      'rather than taken on a provider nobody can name.'
    );
  }

  return PRODUCTION_RULES[registered]();
}
