// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  canonicalMerchantEntity,
  merchantEntityForPurpose,
  merchantEnvKeys,
  merchantFromUrlSegment,
  MERCHANT_ENTITIES,
  UnknownMerchantEntityError,
} from './merchant';

describe('merchantEntityForPurpose (pure routing, ADR 0027)', () => {
  it('sends every donation to YAYASAN', () => {
    expect(merchantEntityForPurpose({ kind: 'donation' })).toBe('YAYASAN');
  });

  it('cannot be overridden for a donation, whatever else is passed', () => {
    const sneaky = { kind: 'donation', commercial: true, merchant: 'BADAN_USAHA' } as unknown as Parameters<
      typeof merchantEntityForPurpose
    >[0];
    expect(merchantEntityForPurpose(sneaky)).toBe('YAYASAN');
  });

  it('keeps a trip fee at YAYASAN unless the Admin marked it commercial', () => {
    expect(merchantEntityForPurpose({ kind: 'trip_fee' })).toBe('YAYASAN');
    expect(merchantEntityForPurpose({ kind: 'trip_fee', commercial: false })).toBe('YAYASAN');
    expect(merchantEntityForPurpose({ kind: 'trip_fee', commercial: true })).toBe('BADAN_USAHA');
  });

  it('sends a commercial service to BADAN_USAHA', () => {
    expect(merchantEntityForPurpose({ kind: 'commercial_service' })).toBe('BADAN_USAHA');
  });

  it('keeps off-gateway movements and payouts at YAYASAN', () => {
    expect(merchantEntityForPurpose({ kind: 'payout' })).toBe('YAYASAN');
    expect(merchantEntityForPurpose({ kind: 'off_gateway' })).toBe('YAYASAN');
  });
});

describe('merchant names', () => {
  it('lists exactly the two entities', () => {
    expect([...MERCHANT_ENTITIES]).toEqual(['YAYASAN', 'BADAN_USAHA']);
  });

  it('canonicalises a typed name and refuses an unknown one', () => {
    expect(canonicalMerchantEntity('yayasan')).toBe('YAYASAN');
    expect(canonicalMerchantEntity('badan_usaha')).toBe('BADAN_USAHA');
    expect(() => canonicalMerchantEntity('constructor')).toThrow(UnknownMerchantEntityError);
  });

  it('maps a webhook URL segment to an entity', () => {
    expect(merchantFromUrlSegment('yayasan')).toBe('YAYASAN');
    expect(merchantFromUrlSegment('badan-usaha')).toBe('BADAN_USAHA');
    expect(() => merchantFromUrlSegment('badan_usaha')).toThrow(UnknownMerchantEntityError);
    expect(() => merchantFromUrlSegment('x')).toThrow(UnknownMerchantEntityError);
  });

  it('names the env per merchant, with the legacy names only for YAYASAN', () => {
    expect(merchantEnvKeys('YAYASAN')).toEqual({
      apiKey: ['SUMOPOD_YAYASAN_API_KEY', 'SUMOPOD_API_KEY'],
      webhookSecret: ['SUMOPOD_YAYASAN_WEBHOOK_SECRET', 'SUMOPOD_WEBHOOK_SECRET'],
      baseUrl: ['SUMOPOD_YAYASAN_BASE_URL', 'SUMOPOD_BASE_URL'],
    });
    expect(merchantEnvKeys('BADAN_USAHA')).toEqual({
      apiKey: ['SUMOPOD_BADAN_USAHA_API_KEY'],
      webhookSecret: ['SUMOPOD_BADAN_USAHA_WEBHOOK_SECRET'],
      baseUrl: ['SUMOPOD_BADAN_USAHA_BASE_URL'],
    });
  });
});
