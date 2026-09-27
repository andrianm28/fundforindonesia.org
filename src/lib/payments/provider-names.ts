/**
 * The names this build knows a Payment Provider by, and nothing else.
 *
 * It is a leaf on purpose. index.ts holds the adapters, and importing that
 * barrel means loading every one of them -- sumopod-provider reaches
 * node:crypto -- while the money layer needs only to know WHICH provider a
 * name refers to. Naming a provider must not require an adapter to exist, to
 * load, or to be configured, and the code that has to name one is the code
 * that moves money: the ledger stamps the string on entries, the Provider
 * Balance is split by exact string equality, and an Admin types it on a form.
 * So the names are here, index.ts re-exports them, and the seam every other
 * caller already uses keeps saying what it always said.
 */

/**
 * Every provider this build can speak to, by the name that appears in its
 * webhook URL. Adding one is a new name here plus a builder in index.ts and a
 * production rule in production-readiness.ts, and the latter two are both keyed
 * on the type below -- so a name with no adapter, or a provider this build would
 * charge money in production without having judged it, is a compile error rather
 * than a gap.
 *
 * A list rather than the builder map itself, which is the point: the map holds
 * functions that construct adapters, and this module holds no functions that
 * construct anything. Exported as a value as well as a type, so a test can walk
 * the names themselves rather than a second list written beside them.
 */
export const PAYMENT_PROVIDER_NAMES = ['mock', 'sumopod'] as const;

export type PaymentProviderName = (typeof PAYMENT_PROVIDER_NAMES)[number];

function isRegisteredName(name: string): name is PaymentProviderName {
  return (PAYMENT_PROVIDER_NAMES as readonly string[]).includes(name);
}

/**
 * Raised when something asks for a provider this build does not have.
 *
 * Kept apart from the "unconfigured" refusal index.ts raises, because the two
 * deserve different answers: an unconfigured provider is an outage worth
 * retrying, an unknown one never becomes valid no matter how often it is
 * retried. The distinction also stops the old behaviour, where the webhook
 * route ignored the provider in its URL and verified every delivery as if it
 * were Midtrans -- so any path under /api/webhooks/ reached a verifier that
 * was never meant to see it.
 */
export class UnknownPaymentProviderError extends Error {
  constructor(name: string) {
    super(`No payment provider named ${JSON.stringify(name)} is registered.`);
    this.name = 'UnknownPaymentProviderError';
  }
}

/**
 * The one name this build knows a provider by, or UnknownPaymentProviderError.
 *
 * Split from getPaymentProvider because a provider's name is needed by code
 * that never talks to the provider: the money layer stamps it on ledger
 * entries, and the Provider Balance is split by exact string equality
 * (ledger.ts's providerBalances). So an Admin who writes "Sumopod" -- the
 * spelling on the dashboard -- and a webhook that stamps "sumopod" are two
 * pots to the ledger, and the sweep's credit lands in a bucket the pot that
 * was checked never had. Every piece of code that names a provider goes
 * through here, which is what makes the registry the one list rather than a
 * convention.
 *
 * No adapter is built, and none is needed: the answer is which name, not
 * whether the provider is reachable. Only the webhook path, which actually
 * calls the provider, has to care about configuration.
 *
 * Membership, not a property lookup: a name is a name only if it is in the
 * list, so `constructor` and `__proto__` -- which an object-literal registry
 * would answer from Object.prototype -- are refused like any other unknown.
 * For the money layer that matters more than for a bad lookup: the string
 * would land on a ledger entry and become a Provider Balance bucket that no
 * code can ever settle against.
 */
export function canonicalPaymentProviderName(name: string): PaymentProviderName {
  const canonical = name.toLowerCase();
  if (!isRegisteredName(canonical)) throw new UnknownPaymentProviderError(name);
  return canonical;
}
