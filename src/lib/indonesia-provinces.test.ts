import { describe, it, expect } from 'vitest';
import { INDONESIA_PROVINCES, isProvinceCode, provinceName } from './indonesia-provinces';

describe('INDONESIA_PROVINCES', () => {
  it('lists the 38 provinces, each code and name once', () => {
    expect(INDONESIA_PROVINCES).toHaveLength(38);
    expect(new Set(INDONESIA_PROVINCES.map((p) => p.code)).size).toBe(38);
    expect(new Set(INDONESIA_PROVINCES.map((p) => p.name)).size).toBe(38);
  });

  it('uses two-digit Kemendagri codes', () => {
    for (const p of INDONESIA_PROVINCES) expect(p.code).toMatch(/^\d{2}$/);
  });

  it('includes the provinces created in 2022', () => {
    expect(provinceName('93')).toBe('Papua Selatan');
    expect(provinceName('96')).toBe('Papua Barat Daya');
  });
});

describe('isProvinceCode / provinceName', () => {
  it('accepts a listed code and refuses anything else', () => {
    expect(isProvinceCode('31')).toBe(true);
    expect(isProvinceCode('99')).toBe(false);
    expect(isProvinceCode('DKI Jakarta')).toBe(false);
    expect(isProvinceCode('')).toBe(false);
  });

  it('names a code, or undefined for an unknown one', () => {
    expect(provinceName('31')).toBe('DKI Jakarta');
    expect(provinceName('00')).toBeUndefined();
    expect(provinceName(null)).toBeUndefined();
  });
});
