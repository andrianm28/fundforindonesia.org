import { describe, it, expect } from 'vitest';
import { validateDonationAmount, validateEmail, validatePassword, validateRequired } from './validation';

describe('validateDonationAmount', () => {
  it('accepts valid amounts', () => {
    expect(validateDonationAmount(1000)).toEqual({ valid: true });
    expect(validateDonationAmount(50000)).toEqual({ valid: true });
    expect(validateDonationAmount(1_000_000_000)).toEqual({ valid: true });
  });

  it('rejects amounts below minimum', () => {
    const result = validateDonationAmount(999);
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('rejects amounts above maximum', () => {
    const result = validateDonationAmount(1_000_000_001);
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('rejects non-integer amounts', () => {
    const result = validateDonationAmount(1000.5);
    expect(result.valid).toBe(false);
  });

  it('respects custom min/max', () => {
    expect(validateDonationAmount(500, 500, 10000)).toEqual({ valid: true });
    expect(validateDonationAmount(499, 500, 10000).valid).toBe(false);
    expect(validateDonationAmount(10001, 500, 10000).valid).toBe(false);
  });
});

describe('validateEmail', () => {
  it('accepts valid emails', () => {
    expect(validateEmail('user@example.com')).toEqual({ valid: true });
    expect(validateEmail('test.name@domain.co.id')).toEqual({ valid: true });
  });

  it('rejects empty email', () => {
    expect(validateEmail('').valid).toBe(false);
    expect(validateEmail('   ').valid).toBe(false);
  });

  it('rejects invalid format', () => {
    expect(validateEmail('notanemail').valid).toBe(false);
    expect(validateEmail('missing@domain').valid).toBe(false);
    expect(validateEmail('@nodomain.com').valid).toBe(false);
  });
});

describe('validatePassword', () => {
  it('accepts valid passwords', () => {
    expect(validatePassword('password123')).toEqual({ valid: true });
    expect(validatePassword('12345678')).toEqual({ valid: true });
  });

  it('rejects empty password', () => {
    expect(validatePassword('').valid).toBe(false);
  });

  it('rejects short passwords', () => {
    expect(validatePassword('1234567').valid).toBe(false);
  });
});

describe('validateRequired', () => {
  it('accepts non-empty values', () => {
    expect(validateRequired('hello', 'Nama')).toEqual({ valid: true });
  });

  it('rejects empty strings', () => {
    const result = validateRequired('', 'Nama');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Nama wajib diisi');
  });

  it('rejects whitespace-only strings', () => {
    expect(validateRequired('   ', 'Nama').valid).toBe(false);
  });
});
