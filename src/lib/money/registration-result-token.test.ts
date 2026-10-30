import { describe, it, expect } from 'vitest';
import {
  REGISTRATION_RESULT_TTL_SECONDS,
  registrationResultPath,
  signRegistrationResultToken,
  verifyRegistrationResultToken,
} from './registration-result-token';
import { signPaymentResultToken, verifyPaymentResultToken } from './payment-result-token';

const SECRET = 'test-secret-for-registration-result';
const NOW = Date.UTC(2026, 9, 16, 10, 0, 0);

describe('registration result token (ticket 99)', () => {
  it('verifies back to the Registration it was signed for', () => {
    const token = signRegistrationResultToken('cmreg123', NOW, SECRET);
    expect(verifyRegistrationResultToken(token, NOW + 60_000, SECRET)).toBe('cmreg123');
  });

  it('is refused after it expires', () => {
    const token = signRegistrationResultToken('cmreg123', NOW, SECRET);
    expect(verifyRegistrationResultToken(token, NOW + REGISTRATION_RESULT_TTL_SECONDS * 1000 - 1000, SECRET)).toBe('cmreg123');
    expect(verifyRegistrationResultToken(token, NOW + REGISTRATION_RESULT_TTL_SECONDS * 1000, SECRET)).toBeNull();
  });

  it('is refused when signed with another secret', () => {
    const token = signRegistrationResultToken('cmreg123', NOW, 'another-secret');
    expect(verifyRegistrationResultToken(token, NOW, SECRET)).toBeNull();
  });

  it('refuses malformed input without throwing', () => {
    for (const junk of [undefined, null, 42, '', 'abc', 'a.b.c', 'cmreg123', '!!.??', 'x'.repeat(600)]) {
      expect(verifyRegistrationResultToken(junk, NOW, SECRET)).toBeNull();
    }
  });

  it('has its own domain: a Donation token never opens a Registration page, nor the reverse', () => {
    const donationToken = signPaymentResultToken('same-id', NOW, SECRET);
    const registrationToken = signRegistrationResultToken('same-id', NOW, SECRET);
    expect(verifyRegistrationResultToken(donationToken, NOW, SECRET)).toBeNull();
    expect(verifyPaymentResultToken(registrationToken, NOW, SECRET)).toBeNull();
  });

  it('builds the page path, with a cancel marker when the Volunteer backed out', () => {
    const token = signRegistrationResultToken('cmreg123', NOW, SECRET);
    expect(registrationResultPath(token)).toBe(`/volunteer-trip/hasil/${token}`);
    expect(registrationResultPath(token, { cancelled: true })).toBe(`/volunteer-trip/hasil/${token}?batal=1`);
  });
});
