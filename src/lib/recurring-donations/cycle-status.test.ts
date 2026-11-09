import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/donation-retry', () => ({ RETRY_CAMPAIGN_SELECT: {} }));
vi.mock('@/lib/campaign-lifecycle', () => ({ campaignAcceptsDonations: vi.fn(), donationBlock: vi.fn() }));

import { cycleStatus, PENDING_EXPIRY_MARGIN_MS, UNKNOWN_EXPIRY_GRACE_MS } from './service';

const HOUR = 3_600_000;
const CLAIMED = new Date('2026-11-01T03:00:00.000Z');
const expiry = new Date(CLAIMED.getTime() + 24 * HOUR);
const pending = (expiresAt: Date | null) => ({
  createdAt: CLAIMED,
  donation: { paymentStatus: 'pending', payments: [{ expiresAt }] },
});

describe('cycleStatus', () => {
  it('reads what the webhook wrote: confirmed is paid, failed is overdue', () => {
    const now = new Date(CLAIMED.getTime() + HOUR);
    expect(cycleStatus({ createdAt: CLAIMED, donation: { paymentStatus: 'confirmed' } }, now)).toBe('PAID');
    expect(cycleStatus({ createdAt: CLAIMED, donation: { paymentStatus: 'failed' } }, now)).toBe('OVERDUE');
  });

  it('stays pending while the payment link is still open', () => {
    expect(cycleStatus(pending(expiry), new Date(expiry.getTime() - HOUR))).toBe('PENDING');
  });

  it('stays pending just after the link expires, for the margin a late webhook needs', () => {
    expect(cycleStatus(pending(expiry), new Date(expiry.getTime() + PENDING_EXPIRY_MARGIN_MS - 1))).toBe('PENDING');
  });

  it('is overdue once the link expiry plus the margin has passed with no webhook, so billing does not stop forever', () => {
    expect(cycleStatus(pending(expiry), new Date(expiry.getTime() + PENDING_EXPIRY_MARGIN_MS + 1))).toBe('OVERDUE');
  });

  it('falls back to the claim time plus a grace when the provider gave no expiry', () => {
    const before = new Date(CLAIMED.getTime() + UNKNOWN_EXPIRY_GRACE_MS - 1);
    const after = new Date(CLAIMED.getTime() + UNKNOWN_EXPIRY_GRACE_MS + PENDING_EXPIRY_MARGIN_MS + 1);
    expect(cycleStatus(pending(null), before)).toBe('PENDING');
    expect(cycleStatus(pending(null), after)).toBe('OVERDUE');
  });

  it('never calls a paid cycle overdue, however old', () => {
    const later = new Date(CLAIMED.getTime() + 400 * 24 * HOUR);
    expect(cycleStatus({ createdAt: CLAIMED, donation: { paymentStatus: 'confirmed', payments: [{ expiresAt: expiry }] } }, later)).toBe('PAID');
  });

  it('treats a claim with no Donation as pending, then overdue once abandoned', () => {
    expect(cycleStatus({ createdAt: CLAIMED, donation: null }, new Date(CLAIMED.getTime() + HOUR - 1))).toBe('PENDING');
    expect(cycleStatus({ createdAt: CLAIMED, donation: null }, new Date(CLAIMED.getTime() + HOUR + 1))).toBe('OVERDUE');
  });
});
