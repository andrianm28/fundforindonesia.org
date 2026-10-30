import { describe, it, expect } from 'vitest';
import { campaignLocationSchema, campaignLocationLabel } from './campaign-location';

describe('campaignLocationSchema', () => {
  it('accepts a body with none of the fields', () => {
    expect(campaignLocationSchema.safeParse({}).success).toBe(true);
  });

  it('accepts a full, valid set and trims the text', () => {
    const r = campaignLocationSchema.parse({
      province: '32',
      regency: '  Kabupaten Garut ',
      beneficiaryDescription: ' Anak yatim ',
      beneficiaryCount: 40,
    });
    expect(r).toEqual({
      province: '32',
      regency: 'Kabupaten Garut',
      beneficiaryDescription: 'Anak yatim',
      beneficiaryCount: 40,
    });
  });

  it('turns blank text into null so a field can be cleared', () => {
    const r = campaignLocationSchema.parse({ province: '', regency: '   ', beneficiaryDescription: '', beneficiaryCount: null });
    expect(r).toEqual({ province: null, regency: null, beneficiaryDescription: null, beneficiaryCount: null });
  });

  it('refuses a province outside the list', () => {
    expect(campaignLocationSchema.safeParse({ province: '99' }).success).toBe(false);
    expect(campaignLocationSchema.safeParse({ province: 'Jawa Barat' }).success).toBe(false);
  });

  it('refuses over-long text', () => {
    expect(campaignLocationSchema.safeParse({ regency: 'a'.repeat(101) }).success).toBe(false);
    expect(campaignLocationSchema.safeParse({ regency: 'a'.repeat(100) }).success).toBe(true);
    expect(campaignLocationSchema.safeParse({ beneficiaryDescription: 'a'.repeat(201) }).success).toBe(false);
    expect(campaignLocationSchema.safeParse({ beneficiaryDescription: 'a'.repeat(200) }).success).toBe(true);
  });

  it('wants a positive whole number for the count', () => {
    for (const bad of [0, -3, 2.5, '12', Number.NaN]) {
      expect(campaignLocationSchema.safeParse({ beneficiaryCount: bad }).success).toBe(false);
    }
    expect(campaignLocationSchema.safeParse({ beneficiaryCount: 1 }).success).toBe(true);
  });

  it('refuses a count that overflows a 32-bit column', () => {
    expect(campaignLocationSchema.safeParse({ beneficiaryCount: 2_147_483_648 }).success).toBe(false);
  });
});

describe('campaignLocationLabel', () => {
  it('joins regency and province name', () => {
    expect(campaignLocationLabel({ province: '32', regency: 'Garut', location: 'lama' })).toBe('Garut, Jawa Barat');
  });
  it('shows either part alone', () => {
    expect(campaignLocationLabel({ province: '32', regency: null, location: null })).toBe('Jawa Barat');
    expect(campaignLocationLabel({ province: null, regency: 'Garut', location: null })).toBe('Garut');
  });
  it('falls back to the legacy free-text location', () => {
    expect(campaignLocationLabel({ province: null, regency: null, location: 'Banten' })).toBe('Banten');
  });
  it('is null when nothing is known', () => {
    expect(campaignLocationLabel({ province: null, regency: null, location: null })).toBeNull();
    expect(campaignLocationLabel({})).toBeNull();
  });
});
