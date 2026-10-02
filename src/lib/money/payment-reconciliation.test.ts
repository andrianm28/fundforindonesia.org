import { describe, it, expect, vi, afterEach } from 'vitest';
import { PaymentStatus } from '@/generated/prisma/client';
import {
  WEBHOOK_OUTCOME,
  WEBHOOK_OUTCOMES_NEEDING_REVIEW,
  lateSettlementOutcome,
  recordChargeWriteFailure,
  sanitizeError,
} from './payment-reconciliation';

afterEach(() => vi.restoreAllMocks());

describe('sanitizeError', () => {
  it('keeps the error name and code, and drops everything else for a message-less error', () => {
    const err = Object.assign(new Error(''), { name: 'PrismaClientKnownRequestError', code: 'P2002' });
    expect(sanitizeError(err)).toBe('PrismaClientKnownRequestError [P2002]');
  });

  it('masks emails, bearer tokens, key=value secrets, URL query strings and long opaque strings', () => {
    const err = new Error(
      'POST https://api.provider.test/v1/charge?server_key=SB-Mid-abc123 failed for donor@example.com: ' +
        'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig token=abc123 ' +
        'ref aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    );
    const out = sanitizeError(err);
    expect(out).not.toContain('donor@example.com');
    expect(out).not.toContain('SB-Mid-abc123');
    expect(out).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    expect(out).not.toContain('abc123');
    expect(out).not.toContain('aaaaaaaaaaaaaaaaaaaaaaaa');
    expect(out).toContain('Error:');
    expect(out).toContain('[email]');
  });

  it('truncates the message to 200 characters', () => {
    const out = sanitizeError(new Error('x '.repeat(500)));
    expect(out.length).toBeLessThanOrEqual('Error: '.length + 200);
  });

  it('handles a thrown string and a non-error value without leaking an object', () => {
    expect(sanitizeError('boom for a@b.co')).toBe('string: boom for [email]');
    expect(sanitizeError({ email: 'a@b.co' })).toBe('object');
  });
});

describe('recordChargeWriteFailure', () => {
  const params = {
    provider: 'mock',
    providerRef: 'ref-1',
    subjectType: 'donation' as const,
    subjectId: 'donation-1',
    amount: 100_000,
  };

  it('stores and logs only the sanitized error, never the raw message or object', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const create = vi.fn().mockResolvedValue({});
    const error = new Error('insert failed for donor@example.com token=s3cr3t-value');

    await recordChargeWriteFailure({ chargeWriteFailure: { create } } as never, { ...params, error });

    const stored = create.mock.calls[0][0].data.errorMessage as string;
    expect(stored).toContain('Error:');
    expect(stored).not.toContain('donor@example.com');
    expect(stored).not.toContain('s3cr3t-value');
    for (const call of consoleErrorSpy.mock.calls) {
      expect(call.some((arg) => typeof arg === 'object')).toBe(false);
      expect(call.join(' ')).not.toContain('donor@example.com');
      expect(call.join(' ')).not.toContain('s3cr3t-value');
    }
  });

  it('never throws when the write itself fails, and does not print that raw error either', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const create = vi.fn().mockRejectedValue(new Error('connection to db.internal refused for user@example.com'));

    await expect(
      recordChargeWriteFailure({ chargeWriteFailure: { create } } as never, { ...params, error: new Error('x') }),
    ).resolves.toBeUndefined();

    for (const call of consoleErrorSpy.mock.calls) {
      expect(call.some((arg) => typeof arg === 'object')).toBe(false);
      expect(call.join(' ')).not.toContain('user@example.com');
    }
  });
});

describe('lateSettlementOutcome and the review list', () => {
  it('labels only EXPIRED and FAILED Payments as late settlements', () => {
    expect(lateSettlementOutcome(PaymentStatus.EXPIRED)).toBe('PAID_AFTER_EXPIRED');
    expect(lateSettlementOutcome(PaymentStatus.FAILED)).toBe('PAID_AFTER_FAILED');
    expect(lateSettlementOutcome(PaymentStatus.PENDING)).toBeNull();
    expect(lateSettlementOutcome(PaymentStatus.PAID)).toBeNull();
  });

  it('puts a failed late-settlement refund in front of an Admin', () => {
    expect(WEBHOOK_OUTCOMES_NEEDING_REVIEW).toContain(WEBHOOK_OUTCOME.LATE_SETTLEMENT_REFUND_FAILED);
  });
});
