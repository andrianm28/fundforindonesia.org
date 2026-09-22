import { describe, it, expect } from 'vitest';
import { assertExactlyOnePaymentSubject, InvalidPaymentSubjectError } from './payment-subject';

describe('assertExactlyOnePaymentSubject', () => {
  it('accepts donationId alone', () => {
    expect(() => assertExactlyOnePaymentSubject({ donationId: 'don-1' })).not.toThrow();
  });

  it('accepts registrationId alone', () => {
    expect(() => assertExactlyOnePaymentSubject({ registrationId: 'reg-1' })).not.toThrow();
  });

  it('rejects both set', () => {
    expect(() =>
      assertExactlyOnePaymentSubject({ donationId: 'don-1', registrationId: 'reg-1' }),
    ).toThrow(InvalidPaymentSubjectError);
  });

  it('rejects neither set', () => {
    expect(() => assertExactlyOnePaymentSubject({})).toThrow(InvalidPaymentSubjectError);
  });

  it('rejects both explicitly null', () => {
    expect(() =>
      assertExactlyOnePaymentSubject({ donationId: null, registrationId: null }),
    ).toThrow(InvalidPaymentSubjectError);
  });

  it('treats an empty string id as set, not absent', () => {
    // An empty string is a real (if unusual) value, not "absent" -- only
    // null/undefined mean "not set". Guards against a loose falsy check.
    expect(() => assertExactlyOnePaymentSubject({ donationId: '', registrationId: 'reg-1' })).toThrow(
      InvalidPaymentSubjectError,
    );
  });
});
