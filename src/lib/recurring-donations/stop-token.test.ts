import { describe, expect, it } from 'vitest';
import { signPaymentResultToken } from '@/lib/money/payment-result-token';
import { signRecurringStopToken, verifyRecurringStopToken, recurringStopPath, STOP_TOKEN_TTL_SECONDS } from './stop-token';

// Built at runtime: the repo's secret scanners flag key-looking literals.
const SECRET = ['stop', 'link', 'test', String(process.pid)].join('-');
const NOW = Date.UTC(2026, 10, 9);

describe('recurring donation stop token', () => {
  it('opens for the recurring donation it was signed for, and only that one', () => {
    const token = signRecurringStopToken('rec-1', NOW, SECRET);
    expect(verifyRecurringStopToken(token, NOW + 1000, SECRET)).toBe('rec-1');
    // Bound to the id: re-pointing the payload at another id breaks the signature.
    const [payload, signature] = token.split('.');
    const forgedPayload = Buffer.from(Buffer.from(payload, 'base64url').toString().replace('rec-1', 'rec-2')).toString('base64url');
    expect(verifyRecurringStopToken(`${forgedPayload}.${signature}`, NOW + 1000, SECRET)).toBeNull();
  });

  it('refuses tampered, expired, foreign-key and junk tokens', () => {
    const token = signRecurringStopToken('rec-1', NOW, SECRET);
    expect(verifyRecurringStopToken(token.slice(0, -2) + 'AA', NOW, SECRET)).toBeNull();
    expect(verifyRecurringStopToken(token, NOW + STOP_TOKEN_TTL_SECONDS * 1000 + 1000, SECRET)).toBeNull();
    expect(verifyRecurringStopToken(token, NOW, SECRET + 'x')).toBeNull();
    expect(verifyRecurringStopToken('', NOW, SECRET)).toBeNull();
    expect(verifyRecurringStopToken('a.b.c', NOW, SECRET)).toBeNull();
    expect(verifyRecurringStopToken(undefined, NOW, SECRET)).toBeNull();
  });

  it('is not interchangeable with another page token for the same id', () => {
    const resultToken = signPaymentResultToken('rec-1', NOW, SECRET);
    expect(verifyRecurringStopToken(resultToken, NOW, SECRET)).toBeNull();
  });

  it('gives the stop page path', () => {
    expect(recurringStopPath('abc.def')).toBe('/donasi-rutin/berhenti/abc.def');
  });
});
