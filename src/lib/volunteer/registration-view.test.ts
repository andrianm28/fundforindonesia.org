import { describe, it, expect, vi } from 'vitest';
import { getVolunteerRegistration } from './registration-view';

const NOW = new Date('2026-10-01T10:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

function row(over: Record<string, unknown> = {}) {
  return {
    id: 'reg-1',
    volunteerId: 'vol-1',
    status: 'CONFIRMED',
    holdExpiresAt: new Date(NOW.getTime() - DAY),
    batch: { startDate: new Date(NOW.getTime() + 20 * DAY), endDate: new Date(NOW.getTime() + 23 * DAY), trip: { slug: 't', title: 'Trip', destination: 'Sumba', tripFeeAmount: 500_000 } },
    payment: { amount: 500_000, status: 'PAID', refunds: [{ id: 'rf-1', amount: 100, status: 'REQUESTED' }] },
    ...over,
  };
}
const db = (r: unknown) => ({ registration: { findUnique: vi.fn().mockResolvedValue(r) } }) as never;

describe('getVolunteerRegistration', () => {
  it('returns null for someone else’s Registration, as if it did not exist', async () => {
    expect(await getVolunteerRegistration(db(row()), { registrationId: 'reg-1', userId: 'other', now: NOW })).toBeNull();
    expect(await getVolunteerRegistration(db(null), { registrationId: 'x', userId: 'vol-1', now: NOW })).toBeNull();
  });

  it('previews the tiered amount a cancel would refund now, from the paid Trip Fee', async () => {
    const view = await getVolunteerRegistration(db(row()), { registrationId: 'reg-1', userId: 'vol-1', now: NOW });
    expect(view).toMatchObject({ status: 'CONFIRMED', cancelRefundAmount: 500_000, refunds: [{ id: 'rf-1', amount: 100, status: 'REQUESTED' }] });
    const half = row({ batch: { ...row().batch, startDate: new Date(NOW.getTime() + 5 * DAY) } });
    expect((await getVolunteerRegistration(db(half), { registrationId: 'reg-1', userId: 'vol-1', now: NOW }))?.cancelRefundAmount).toBe(250_000);
    const none = row({ batch: { ...row().batch, startDate: new Date(NOW.getTime() + 2 * DAY) } });
    expect((await getVolunteerRegistration(db(none), { registrationId: 'reg-1', userId: 'vol-1', now: NOW }))?.cancelRefundAmount).toBe(0);
  });

  it('shows a HOLD past its window as EXPIRED, and a live HOLD as nothing refundable', async () => {
    const lapsed = row({ status: 'HOLD', holdExpiresAt: NOW, payment: null });
    expect((await getVolunteerRegistration(db(lapsed), { registrationId: 'reg-1', userId: 'vol-1', now: NOW }))?.status).toBe('EXPIRED');
    const live = row({ status: 'HOLD', holdExpiresAt: new Date(NOW.getTime() + 1000), payment: null });
    expect(await getVolunteerRegistration(db(live), { registrationId: 'reg-1', userId: 'vol-1', now: NOW })).toMatchObject({
      status: 'HOLD',
      cancelRefundAmount: 0,
      paidAmount: null,
    });
  });
});
