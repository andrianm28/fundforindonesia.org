import { describe, it, expect } from 'vitest';
import { EMPTY_LOCATION_FORM, locationErrors, locationPayload } from './campaign-form';

describe('locationErrors', () => {
  it('asks for nothing: an empty form is fine', () => {
    expect(locationErrors(EMPTY_LOCATION_FORM)).toEqual({});
  });

  it('judges only what was typed', () => {
    expect(locationErrors({ ...EMPTY_LOCATION_FORM, province: '99' }).province).toBeDefined();
    expect(locationErrors({ ...EMPTY_LOCATION_FORM, regency: 'a'.repeat(101) }).regency).toBeDefined();
    expect(locationErrors({ ...EMPTY_LOCATION_FORM, beneficiaryDescription: 'a'.repeat(201) }).beneficiaryDescription).toBeDefined();
    for (const bad of ['0', '-4', '2.5', 'abc', '99999999999']) {
      expect(locationErrors({ ...EMPTY_LOCATION_FORM, beneficiaryCount: bad }).beneficiaryCount).toBeDefined();
    }
    expect(locationErrors({ province: '32', regency: 'Garut', beneficiaryDescription: 'Yatim', beneficiaryCount: '40' })).toEqual({});
  });
});

describe('locationPayload', () => {
  it('sends null for blanks so an edit clears them', () => {
    expect(locationPayload({ ...EMPTY_LOCATION_FORM, regency: '   ' })).toEqual({
      province: null,
      regency: null,
      beneficiaryDescription: null,
      beneficiaryCount: null,
    });
  });

  it('trims text and turns the count into a number', () => {
    expect(locationPayload({ province: '32', regency: ' Garut ', beneficiaryDescription: ' Yatim ', beneficiaryCount: '40' })).toEqual({
      province: '32',
      regency: 'Garut',
      beneficiaryDescription: 'Yatim',
      beneficiaryCount: 40,
    });
  });
});
