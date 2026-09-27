import { describe, it, expect } from 'vitest';
import { generateReceiptToken } from './receipt-token';

/**
 * The Receipt print page is reached by this token alone (CONTEXT.md, Receipt)
 * -- a Guest Donor has no account to authenticate with, so the token is the
 * only thing standing between the page and anyone who finds the link.
 */
describe('generateReceiptToken', () => {
  it('is long enough and from wide enough an alphabet that guessing it is not feasible', () => {
    const token = generateReceiptToken();

    expect(token.length).toBeGreaterThanOrEqual(32);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('never repeats across calls', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generateReceiptToken()));

    expect(tokens.size).toBe(200);
  });
});
