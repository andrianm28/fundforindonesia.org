import { describe, it, expect } from 'vitest';
import { sanitizeTrafficSource, TRAFFIC_SOURCE_MAX_LENGTH } from './traffic-source';

// The `src` query parameter on a shared link (ticket 24, "Traffic Source on
// Donation") is untrusted input: a visitor can put anything in a URL. This
// is the one place that decides what of it is ever allowed to reach the
// Donation row -- absent or malformed input must never block a Donation, so
// this never throws or signals failure, only degrades to null.
describe('sanitizeTrafficSource', () => {
  it('keeps a well-formed source unchanged', () => {
    expect(sanitizeTrafficSource('whatsapp')).toBe('whatsapp');
  });

  it('returns null for undefined (no source param at all)', () => {
    expect(sanitizeTrafficSource(undefined)).toBeNull();
  });

  it('returns null for null', () => {
    expect(sanitizeTrafficSource(null)).toBeNull();
  });

  it('returns null for a non-string value', () => {
    expect(sanitizeTrafficSource(12345)).toBeNull();
    expect(sanitizeTrafficSource({ a: 1 })).toBeNull();
    expect(sanitizeTrafficSource(['whatsapp'])).toBeNull();
  });

  it('returns null for an empty or whitespace-only string', () => {
    expect(sanitizeTrafficSource('')).toBeNull();
    expect(sanitizeTrafficSource('   ')).toBeNull();
  });

  it('trims surrounding whitespace', () => {
    expect(sanitizeTrafficSource('  whatsapp  ')).toBe('whatsapp');
  });

  it('caps length rather than rejecting an overlong value', () => {
    const long = 'a'.repeat(500);
    const result = sanitizeTrafficSource(long);
    expect(result).toBe('a'.repeat(TRAFFIC_SOURCE_MAX_LENGTH));
    expect(result?.length).toBe(TRAFFIC_SOURCE_MAX_LENGTH);
  });

  it('strips characters outside the safe set instead of rejecting the whole value', () => {
    // A visitor-supplied value must never be reflected unescaped. Restricting
    // the stored value to a known-safe character set (letters, digits,
    // dash, underscore) makes every later consumer -- an aggregate count
    // label, a URL -- safe by construction, with no escaping to remember.
    expect(sanitizeTrafficSource('whats app!')).toBe('whatsapp');
    expect(sanitizeTrafficSource('<script>alert(1)</script>')).toBe('scriptalert1script');
    expect(sanitizeTrafficSource('email-blast_2026')).toBe('email-blast_2026');
  });

  it('returns null when nothing safe remains after stripping', () => {
    expect(sanitizeTrafficSource('!!!???')).toBeNull();
  });
});
