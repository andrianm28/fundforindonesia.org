import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

const db = vi.hoisted(() => ({
  recurringDonation: { findMany: vi.fn() },
  recurringDonationCycle: { create: vi.fn(), update: vi.fn() },
  notification: { create: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: db }));
vi.mock('@/lib/donations', () => ({ donationsEnabled: () => true, sandboxInProductionReason: () => null }));
vi.mock('@/lib/operations', () => ({ donationsSwitchedOff: vi.fn().mockResolvedValue(false) }));
vi.mock('@/lib/donation-retry', () => ({ RETRY_CAMPAIGN_SELECT: {}, campaignRetryRefusal: vi.fn().mockReturnValue(null) }));
vi.mock('@/lib/zakat', () => ({ zakatCheckoutRefusal: vi.fn().mockResolvedValue(null) }));
vi.mock('@/lib/payments', () => ({ PaymentProviderNotConfiguredError: class extends Error {} }));
vi.mock('@/lib/payments/active-provider', () => ({
  resolveActivePaymentProvider: vi.fn().mockResolvedValue({ provider: {}, enabledMethods: ['qris_redirect'] }),
}));
vi.mock('@/lib/money/create-charged-donation', () => ({ createChargedDonation: vi.fn() }));
vi.mock('@/lib/mail', () => ({ sendReportingFailure: vi.fn().mockResolvedValue(true) }));
vi.mock('@/lib/mail/recurring-donation', () => ({ recurringDonationBillEmail: vi.fn().mockReturnValue({}) }));
vi.mock('@/lib/contact-fields', () => ({ readUserEmail: () => 'donor@example.test', SELECT_USER_EMAIL: {} }));
vi.mock('./stop-token', () => ({
  recurringStopPath: (t: string) => `/donasi-rutin/berhenti/${t}`,
  signRecurringStopToken: () => 'tok',
}));

import { runRecurringDonationBilling } from './billing';
import { createChargedDonation } from '@/lib/money/create-charged-donation';
import { zakatCheckoutRefusal } from '@/lib/zakat';

const mockCreateCharged = createChargedDonation as unknown as Mock;

const HOUR = 3_600_000;
const NOW = new Date('2026-12-01T03:00:00.000Z');

function recurring(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rec-1',
    amount: 50_000,
    period: 'MONTHLY',
    // Cycle 1 is due on 1 December: the first one is long settled.
    startDate: new Date('2026-11-01T00:00:00.000Z'),
    donorId: 'donor-1',
    campaign: { id: 'camp-1', title: 'Sumur untuk Desa', kind: 'DONATION', category: 'lingkungan' },
    donor: { name: 'Budi' },
    cycles: [],
    ...overrides,
  };
}

const okCharge = (id = 'don-1') => ({
  ok: true,
  donation: { id },
  charge: { method: 'qris_redirect', redirectUrl: 'https://pay.example.test/x', expiresAt: null },
  paymentId: 'pay-1',
});

describe('runRecurringDonationBilling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    db.recurringDonationCycle.create.mockResolvedValue({ id: 'cycle-1' });
    db.recurringDonationCycle.update.mockResolvedValue({});
    db.notification.create.mockResolvedValue({});
    mockCreateCharged.mockResolvedValue(okCharge());
  });

  it('bills a due cycle', async () => {
    db.recurringDonation.findMany.mockResolvedValue([recurring()]);
    const result = await runRecurringDonationBilling(NOW);
    expect(result.issuedCount).toBe(1);
    expect(db.recurringDonationCycle.create).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['the zakat module is off', { status: 404, error: 'Campaign tidak ditemukan' }],
    ['the Campaign is not the configured recipient', { status: 403, error: 'Zakat hanya diterima melalui lembaga penerima zakat yang ditetapkan.' }],
  ])('skips a zakat Campaign when %s: no cycle claimed, no Donation, no charge', async (_why, refusal) => {
    (zakatCheckoutRefusal as unknown as Mock).mockResolvedValueOnce(refusal);
    db.recurringDonation.findMany.mockResolvedValue([
      recurring({ campaign: { id: 'camp-z', title: 'Zakat', kind: 'ZAKAT', category: 'zakat', collectingEntity: { id: 'org-x' } } }),
    ]);

    const result = await runRecurringDonationBilling(NOW);

    expect(result).toMatchObject({ consideredCount: 1, issuedCount: 0, skippedCount: 1, failedCount: 0 });
    expect(db.recurringDonationCycle.create).not.toHaveBeenCalled();
    expect(mockCreateCharged).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('rec-1'));
  });

  it('skips a wakaf Campaign at billing time: no cycle claimed, no Donation, no charge', async () => {
    // Registered while it was something else, or tampered with: the bill cannot carry the ikrar.
    db.recurringDonation.findMany.mockResolvedValue([
      recurring({ campaign: { id: 'camp-w', title: 'Wakaf Sumur', kind: 'WAKAF', category: 'wakaf' } }),
    ]);

    const result = await runRecurringDonationBilling(NOW);

    expect(result).toMatchObject({ consideredCount: 1, issuedCount: 0, skippedCount: 1, failedCount: 0 });
    expect(db.recurringDonationCycle.create).not.toHaveBeenCalled();
    expect(mockCreateCharged).not.toHaveBeenCalled();
  });

  describe('when the Donation was inserted but the bill then breaks', () => {
    it('lets createChargedDonation attach the Donation to its cycle before the provider is asked, so a throw leaves no orphan', async () => {
      db.recurringDonation.findMany.mockResolvedValue([recurring()]);
      mockCreateCharged.mockImplementation(async (params: { onDonationCreated: (d: { id: string }) => Promise<void> }) => {
        await params.onDonationCreated({ id: 'don-9' });
        throw new Error('provider exploded');
      });

      const result = await runRecurringDonationBilling(NOW);

      expect(db.recurringDonationCycle.update).toHaveBeenCalledWith({ where: { id: 'cycle-1' }, data: { donationId: 'don-9' } });
      expect(result).toMatchObject({ issuedCount: 0, failedCount: 1 });
      expect(db.notification.create).not.toHaveBeenCalled();
      // Logged with the ids, so the row can be found.
      const logged = vi.mocked(console.error).mock.calls.flat().join(' ');
      expect(logged).toContain('cycle-1');
      expect(logged).toContain('don-9');
    });

    it('tries once more to link the Donation when linking it failed, and still bills nothing twice', async () => {
      db.recurringDonation.findMany.mockResolvedValue([recurring()]);
      db.recurringDonationCycle.update.mockRejectedValueOnce(new Error('link failed')).mockResolvedValue({});
      mockCreateCharged.mockImplementation(async (params: { onDonationCreated: (d: { id: string }) => Promise<void> }) => {
        // createChargedDonation closes the Donation out failed and rethrows.
        await params.onDonationCreated({ id: 'don-9' });
        return okCharge('don-9');
      });

      const result = await runRecurringDonationBilling(NOW);

      expect(db.recurringDonationCycle.update).toHaveBeenCalledTimes(2);
      expect(db.recurringDonationCycle.update).toHaveBeenLastCalledWith({
        where: { id: 'cycle-1' },
        data: { donationId: 'don-9' },
      });
      expect(result).toMatchObject({ issuedCount: 0, failedCount: 1 });
      expect(db.recurringDonationCycle.create).toHaveBeenCalledTimes(1);
      expect(db.notification.create).not.toHaveBeenCalled();
    });

    it('does not bill the same cycle again on the next run: its row stays, and it is not past the claim grace', async () => {
      db.recurringDonation.findMany.mockResolvedValue([
        recurring({ cycles: [{ cycleIndex: 1, createdAt: new Date(NOW.getTime() - 60_000), donation: null }] }),
      ]);
      const result = await runRecurringDonationBilling(NOW);
      expect(result.skippedCount).toBe(1);
      expect(mockCreateCharged).not.toHaveBeenCalled();
    });
  });

  describe('a pending cycle that never got an expiry webhook', () => {
    const lastCycle = (expiresAt: Date | null) => ({
      cycleIndex: 0,
      createdAt: new Date('2026-11-01T03:00:00.000Z'),
      donation: { paymentStatus: 'pending', payments: [{ expiresAt }] },
    });

    it('still blocks the next bill while the payment link is open', async () => {
      db.recurringDonation.findMany.mockResolvedValue([
        recurring({ cycles: [lastCycle(new Date(NOW.getTime() + HOUR))] }),
      ]);
      const result = await runRecurringDonationBilling(NOW);
      expect(result.skippedCount).toBe(1);
      expect(mockCreateCharged).not.toHaveBeenCalled();
    });

    it('stops blocking once the link expired long ago, so billing does not stop forever', async () => {
      db.recurringDonation.findMany.mockResolvedValue([
        recurring({ cycles: [lastCycle(new Date('2026-11-02T03:00:00.000Z'))] }),
      ]);
      const result = await runRecurringDonationBilling(NOW);
      expect(result.issuedCount).toBe(1);
    });
  });
});
