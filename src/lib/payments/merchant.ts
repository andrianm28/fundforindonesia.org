/**
 * The two Merchant Accounts inside Fund for Indonesia (ADR 0027, extending
 * ADR 0011). One gateway (Sumopod) per platform, but two merchants at it:
 *
 *  - YAYASAN: donations, zakat, wakaf/hibah. The account of the licence holder.
 *  - BADAN_USAHA: platform/commercial revenue (a Trip Fee the Admin marks
 *    commercial, paid services). Never donated money.
 *
 * A leaf module on purpose, like provider-names.ts: the money layer needs the
 * names and the routing rule without loading an adapter.
 */

export const MERCHANT_ENTITIES = ['YAYASAN', 'BADAN_USAHA'] as const;
export type MerchantEntity = (typeof MERCHANT_ENTITIES)[number];

export class UnknownMerchantEntityError extends Error {
  constructor(name: string) {
    super(`No merchant entity named ${JSON.stringify(name)} exists.`);
    this.name = 'UnknownMerchantEntityError';
  }
}

/** Membership, not a property lookup: `constructor` is not an entity. */
export function canonicalMerchantEntity(name: string): MerchantEntity {
  const upper = name.toUpperCase();
  const found = MERCHANT_ENTITIES.find((m) => m === upper);
  if (!found) throw new UnknownMerchantEntityError(name);
  return found;
}

/** The segment each merchant has in its own webhook URL, /api/webhooks/<provider>/<segment>. */
const URL_SEGMENTS: Record<MerchantEntity, string> = {
  YAYASAN: 'yayasan',
  BADAN_USAHA: 'badan-usaha',
};

export function merchantUrlSegment(merchant: MerchantEntity): string {
  return URL_SEGMENTS[merchant];
}

/** Exact match on the segment spelling; no case folding, so one URL per merchant. */
export function merchantFromUrlSegment(segment: string): MerchantEntity {
  const found = MERCHANT_ENTITIES.find((m) => URL_SEGMENTS[m] === segment);
  if (!found) throw new UnknownMerchantEntityError(segment);
  return found;
}

/**
 * What a charge is for, as far as choosing a merchant goes. A discriminated
 * union so that a donation has no `commercial` or `merchant` field to set.
 */
export type MerchantPurpose =
  | { kind: 'donation' }
  | { kind: 'trip_fee'; commercial?: boolean }
  | { kind: 'commercial_service' }
  /** A Payout approved/completed/failed: Fundraisers' donated money. */
  | { kind: 'payout' }
  /** A movement that never touched the gateway (Manual Contribution, Campaign Transfer). */
  | { kind: 'off_gateway' };

/**
 * The one pure function that maps a purpose to a merchant. Donations are
 * YAYASAN always; there is no input that changes that.
 */
export function merchantEntityForPurpose(purpose: MerchantPurpose): MerchantEntity {
  switch (purpose.kind) {
    case 'donation':
    case 'payout':
    case 'off_gateway':
      return 'YAYASAN';
    case 'trip_fee':
      return purpose.commercial === true ? 'BADAN_USAHA' : 'YAYASAN';
    case 'commercial_service':
      return 'BADAN_USAHA';
  }
}

/**
 * Env variable names per merchant, in lookup order. YAYASAN falls back to the
 * pre-ADR-0027 names so production does not change until the owner fills in
 * the new ones. BADAN_USAHA has NO fallback: a commercial charge must never
 * land on the yayasan's account because a variable is missing.
 */
export function merchantEnvKeys(merchant: MerchantEntity): {
  apiKey: string[];
  webhookSecret: string[];
  baseUrl: string[];
} {
  const keys = MERCHANT_ENV[merchant];
  return { apiKey: [...keys.apiKey], webhookSecret: [...keys.webhookSecret], baseUrl: [...keys.baseUrl] };
}

/**
 * Spelled out in full rather than built from a prefix, so that grep finds every
 * variable, and src/__tests__/docker-compose-prod.test.ts can check each one is
 * passed through docker-compose (it reads this file's text).
 */
const MERCHANT_ENV: Record<MerchantEntity, { apiKey: readonly string[]; webhookSecret: readonly string[]; baseUrl: readonly string[] }> = {
  YAYASAN: {
    apiKey: ['SUMOPOD_YAYASAN_API_KEY', 'SUMOPOD_API_KEY'],
    webhookSecret: ['SUMOPOD_YAYASAN_WEBHOOK_SECRET', 'SUMOPOD_WEBHOOK_SECRET'],
    baseUrl: ['SUMOPOD_YAYASAN_BASE_URL', 'SUMOPOD_BASE_URL'],
  },
  BADAN_USAHA: {
    apiKey: ['SUMOPOD_BADAN_USAHA_API_KEY'],
    webhookSecret: ['SUMOPOD_BADAN_USAHA_WEBHOOK_SECRET'],
    baseUrl: ['SUMOPOD_BADAN_USAHA_BASE_URL'],
  },
};

/** The value of the first of `keys` that is set and non-empty (empty is unset), else undefined. */
export function firstSetEnv(keys: readonly string[]): { key: string; value: string } | undefined {
  for (const key of keys) {
    const value = process.env[key];
    if (value) return { key, value };
  }
  return undefined;
}
