import { describe, it, expect, vi } from 'vitest';
import { findOwnLiveRegistration, getVolunteerRegistration, listVolunteerRegistrations } from './registration-view';

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

describe('payment instructions of a HOLD (ticket 37: Lanjutkan pembayaran)', () => {
  const later = new Date(NOW.getTime() + 20 * 60 * 1000);
  const live = (payment: Record<string, unknown> | null) =>
    row({
      status: 'HOLD',
      holdExpiresAt: later,
      payment: payment && { amount: 500_000, refunds: [], ...payment },
    });
  const view = (r: unknown) => getVolunteerRegistration(db(r), { registrationId: 'reg-1', userId: 'vol-1', now: NOW });

  it('hands back the stored QRIS link of a live HOLD whose Payment is still PENDING', async () => {
    const v = await view(live({ status: 'PENDING', expiresAt: later, redirectUrl: 'https://pay.example/abc', vaNumber: null }));
    expect(v?.paymentInstructions).toEqual({ redirectUrl: 'https://pay.example/abc', vaNumber: null });
  });

  it('hands back a stored Virtual Account number too', async () => {
    const v = await view(live({ status: 'PENDING', expiresAt: later, redirectUrl: null, vaNumber: '8808123' }));
    expect(v?.paymentInstructions).toEqual({ redirectUrl: null, vaNumber: '8808123' });
  });

  it.each([
    ['no Payment was ever written', null],
    ['the Payment predates stored instructions', { status: 'PENDING', expiresAt: later, redirectUrl: null, vaNumber: null }],
    ['the Payment already expired', { status: 'PENDING', expiresAt: NOW, redirectUrl: 'https://pay.example/abc', vaNumber: null }],
    ['the Payment failed', { status: 'FAILED', expiresAt: later, redirectUrl: 'https://pay.example/abc', vaNumber: null }],
    ['the link is not http(s)', { status: 'PENDING', expiresAt: later, redirectUrl: 'javascript:alert(1)', vaNumber: null }],
  ])('offers nothing when %s', async (_, payment) => {
    expect((await view(live(payment)))?.paymentInstructions).toBeNull();
  });

  it('offers nothing once the seat hold lapsed, even with a stored link', async () => {
    const lapsed = row({
      status: 'HOLD',
      holdExpiresAt: NOW,
      payment: { amount: 1, status: 'PENDING', expiresAt: later, redirectUrl: 'https://pay.example/abc', vaNumber: null, refunds: [] },
    });
    expect((await view(lapsed))?.paymentInstructions).toBeNull();
  });

  it('offers nothing on a CONFIRMED Registration', async () => {
    expect((await view(row()))?.paymentInstructions).toBeNull();
  });
});

describe('listVolunteerRegistrations (dashboard)', () => {
  const listDb = (rows: unknown[]) => ({ registration: { findMany: vi.fn().mockResolvedValue(rows) } });
  const full = (over: Record<string, unknown> = {}) => ({
    ...row(),
    attended: false,
    certificate: null,
    batch: { ...row().batch, status: 'OPEN' },
    ...over,
  });

  it('asks only for the signed-in Volunteer’s own Registrations, newest first', async () => {
    const d = listDb([]);
    await listVolunteerRegistrations(d as never, { userId: 'vol-1', now: NOW });
    expect(d.registration.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { volunteerId: 'vol-1' }, orderBy: { createdAt: 'desc' } }),
    );
  });

  it('carries status, refunds, the tiered cancel amount and the certificate code', async () => {
    const d = listDb([full({ certificate: { code: 'abcdefghijklmnopqrstuv' } })]);
    const { registrations } = await listVolunteerRegistrations(d as never, { userId: 'vol-1', now: NOW });
    expect(registrations).toEqual([
      expect.objectContaining({
        id: 'reg-1',
        status: 'CONFIRMED',
        cancelRefundAmount: 500_000,
        refunds: [{ id: 'rf-1', amount: 100, status: 'REQUESTED' }],
        certificateCode: 'abcdefghijklmnopqrstuv',
      }),
    ]);
  });

  it('lists as completed Trips only attended CONFIRMED Registrations on a COMPLETED Batch', async () => {
    const completedBatch = { ...row().batch, status: 'COMPLETED' };
    const done = full({ id: 'done', attended: true, batch: completedBatch });
    const absent = full({ id: 'absent', attended: false, batch: completedBatch });
    const open = full({ id: 'open', attended: false });
    const cancelled = full({ id: 'x', status: 'CANCELLED', attended: true, batch: completedBatch });
    const { completed } = await listVolunteerRegistrations(listDb([done, absent, open, cancelled]) as never, {
      userId: 'vol-1',
      now: NOW,
    });
    expect(completed).toEqual([
      { registrationId: 'done', title: 'Trip', destination: 'Sumba', startDate: completedBatch.startDate, endDate: completedBatch.endDate },
    ]);
  });
});

describe('findOwnLiveRegistration', () => {
  it('asks only for the Volunteer own CONFIRMED or unexpired HOLD on the Batch, and returns its id', async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: 'reg-3', status: 'HOLD' });
    const found = await findOwnLiveRegistration({ registration: { findFirst } } as never, { batchId: 'b1', userId: 'vol-1', now: NOW });
    expect(found).toEqual({ id: 'reg-3', status: 'HOLD' });
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { batchId: 'b1', volunteerId: 'vol-1', OR: [{ status: 'CONFIRMED' }, { status: 'HOLD', holdExpiresAt: { gt: NOW } }] },
      }),
    );
  });

  it('returns null when there is none', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    expect(await findOwnLiveRegistration({ registration: { findFirst } } as never, { batchId: 'b1', userId: 'v', now: NOW })).toBeNull();
  });
});
