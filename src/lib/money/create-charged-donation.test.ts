import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

const db = vi.hoisted(() => ({ donation: { create: vi.fn(), update: vi.fn() }, payment: { count: vi.fn() } }));
vi.mock('@/lib/prisma', () => ({ prisma: db }));
vi.mock('@/lib/money/donation-charge', () => ({ chargeDonation: vi.fn() }));

import { createChargedDonation } from './create-charged-donation';
import { chargeDonation } from '@/lib/money/donation-charge';

const mockCharge = chargeDonation as unknown as Mock;

const params = {
  provider: {} as never,
  campaign: { id: 'c1', kind: 'DONATION' as const, category: 'lingkungan' },
  method: 'qris_redirect' as const,
  donation: { amount: 50_000, isAnonymous: false, paymentMethod: 'qris' },
};

describe('createChargedDonation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    db.donation.create.mockResolvedValue({ id: 'd1', paymentStatus: 'pending' });
    db.donation.update.mockResolvedValue({});
    db.payment.count.mockResolvedValue(0);
  });

  it('hands the caller the Donation as soon as it exists, before the provider is asked', async () => {
    const order: string[] = [];
    mockCharge.mockImplementation(async () => {
      order.push('charge');
      return { ok: true, charge: { method: 'qris_redirect' }, paymentId: 'p1' };
    });

    await createChargedDonation({ ...params, onDonationCreated: async (d) => void order.push(`created:${d.id}`) });

    expect(order).toEqual(['created:d1', 'charge']);
  });

  it('closes the Donation out failed, and rethrows, when the charge throws after the insert', async () => {
    mockCharge.mockRejectedValue(new Error('provider down'));

    await expect(createChargedDonation(params)).rejects.toThrow('provider down');

    expect(db.donation.update).toHaveBeenCalledWith({ where: { id: 'd1' }, data: { paymentStatus: 'failed' } });
  });

  it('closes the Donation out failed, without charging, when the caller cannot record it', async () => {
    await expect(
      createChargedDonation({
        ...params,
        onDonationCreated: async () => {
          throw new Error('link failed');
        },
      }),
    ).rejects.toThrow('link failed');

    expect(mockCharge).not.toHaveBeenCalled();
    expect(db.donation.update).toHaveBeenCalledWith({ where: { id: 'd1' }, data: { paymentStatus: 'failed' } });
  });

  it('still rethrows the original error when marking failed also fails, and logs the Donation id', async () => {
    mockCharge.mockRejectedValue(new Error('provider down'));
    db.donation.update.mockRejectedValue(new Error('db down'));

    await expect(createChargedDonation(params)).rejects.toThrow('provider down');

    expect(vi.mocked(console.error).mock.calls.flat().join(' ')).toContain('d1');
  });

  it('leaves the Donation pending when a Payment was already issued, so a later PAID webhook is not contradicted', async () => {
    mockCharge.mockRejectedValue(new Error('crash after link'));
    db.payment.count.mockResolvedValue(1);

    await expect(createChargedDonation(params)).rejects.toThrow('crash after link');

    expect(db.donation.update).not.toHaveBeenCalled();
  });
});
