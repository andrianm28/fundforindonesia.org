/**
 * Form validation utilities for donation, email, password, and required fields.
 */

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

const DEFAULT_MIN_DONATION = 1000;
const DEFAULT_MAX_DONATION = 1_000_000_000;

/**
 * Validates a donation amount.
 * @param amount - The donation amount in Rupiah
 * @param min - Minimum allowed amount (default: 1000)
 * @param max - Maximum allowed amount (default: 1,000,000,000)
 */
export function validateDonationAmount(
  amount: number,
  min: number = DEFAULT_MIN_DONATION,
  max: number = DEFAULT_MAX_DONATION
): ValidationResult {
  if (!Number.isFinite(amount) || !Number.isInteger(amount)) {
    return { valid: false, error: 'Jumlah donasi harus berupa bilangan bulat' };
  }

  if (amount < min) {
    return { valid: false, error: `Donasi minimal Rp${min.toLocaleString('id-ID')}` };
  }

  if (amount > max) {
    return { valid: false, error: `Donasi maksimal Rp${max.toLocaleString('id-ID')}` };
  }

  return { valid: true };
}

/**
 * Validates an email address format.
 */
export function validateEmail(email: string): ValidationResult {
  if (!email || email.trim().length === 0) {
    return { valid: false, error: 'Email wajib diisi' };
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email.trim())) {
    return { valid: false, error: 'Format email tidak valid' };
  }

  return { valid: true };
}

/**
 * Validates a password (minimum 8 characters).
 */
export function validatePassword(password: string): ValidationResult {
  if (!password || password.length === 0) {
    return { valid: false, error: 'Password wajib diisi' };
  }

  if (password.length < 8) {
    return { valid: false, error: 'Password minimal 8 karakter' };
  }

  return { valid: true };
}

/**
 * Validates that a required field is not empty.
 */
export function validateRequired(value: string, fieldName: string): ValidationResult {
  if (!value || value.trim().length === 0) {
    return { valid: false, error: `${fieldName} wajib diisi` };
  }

  return { valid: true };
}
