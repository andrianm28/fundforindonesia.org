import { describe, it, expect } from 'vitest';
import { assertExactlyOnePayoutSubject, InvalidPayoutSubjectError } from './payout-subject';

describe('assertExactlyOnePayoutSubject', () => {
  it('accepts campaignId alone', () => {
    expect(() => assertExactlyOnePayoutSubject({ campaignId: 'camp-1' })).not.toThrow();
  });

  it('accepts volunteerTripId alone', () => {
    expect(() => assertExactlyOnePayoutSubject({ volunteerTripId: 'trip-1' })).not.toThrow();
  });

  it('rejects both set', () => {
    expect(() =>
      assertExactlyOnePayoutSubject({ campaignId: 'camp-1', volunteerTripId: 'trip-1' }),
    ).toThrow(InvalidPayoutSubjectError);
  });

  it('rejects neither set', () => {
    expect(() => assertExactlyOnePayoutSubject({})).toThrow(InvalidPayoutSubjectError);
  });

  it('rejects both explicitly null', () => {
    expect(() =>
      assertExactlyOnePayoutSubject({ campaignId: null, volunteerTripId: null }),
    ).toThrow(InvalidPayoutSubjectError);
  });

  it('treats an empty string id as set, not absent', () => {
    // An empty string is a real (if unusual) value, not "absent" -- only
    // null/undefined mean "not set". Guards against a loose falsy check.
    expect(() =>
      assertExactlyOnePayoutSubject({ campaignId: '', volunteerTripId: 'trip-1' }),
    ).toThrow(InvalidPayoutSubjectError);
  });

  it('words its message for any refused subject, a Program included', () => {
    const message = new InvalidPayoutSubjectError().message;
    expect(message).toMatch(/exactly one Campaign or one Volunteer Trip/);
    expect(message).toMatch(/Program/);
  });
});
