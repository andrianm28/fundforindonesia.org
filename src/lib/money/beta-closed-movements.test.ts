// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestCampaignTransfer } from './campaign-transfers';
import { recordProviderWithdrawal } from './provider-withdrawals';

/**
 * Two movements of REAL money have no mode of their own to keep test money
 * apart (a Campaign Transfer moves a Campaign Balance, a Provider Withdrawal
 * sweeps the Collection Account to a bank), so they are closed while the beta
 * marker is on (ticket rilis-1-benda/94, scope 4: no real transfer path open).
 *
 * The stand-ins below throw on any use, so a refusal that came after reading or
 * writing anything would fail these as a TypeError rather than pass.
 */
afterEach(() => vi.unstubAllEnvs());

const touchesNothing = new Proxy({}, { get: () => { throw new Error('database touched'); } });

describe('Campaign Transfer in the beta', () => {
  it('is refused before any lock or read', async () => {
    vi.stubEnv('BETA_SANDBOX', 'true');
    await expect(
      requestCampaignTransfer(touchesNothing as never, {
        sourceId: 'campaign-a',
        targetId: 'campaign-b',
        reason: 'uji',
        requestedById: 'admin-1',
      }),
    ).rejects.toMatchObject({ code: 'CAMPAIGN_TRANSFER_INVALID', message: expect.stringContaining('Beta') });
  });
});

describe('Provider Withdrawal in the beta', () => {
  it('is refused before the transaction opens, so nothing is posted', async () => {
    vi.stubEnv('BETA_SANDBOX', 'true');
    const prisma = { $transaction: vi.fn() };
    await expect(
      recordProviderWithdrawal(prisma as never, {
        provider: 'sumopod',
        reference: 'WD-1',
        destinationName: 'PT Jaya Korpora Prima',
        amount: 1_000_000,
        providerBalanceBefore: 5_000_000,
        providerBalanceAfter: 4_000_000,
        proofReference: 'bukti',
        recordedById: 'admin-1',
      } as never),
    ).rejects.toMatchObject({ message: expect.stringContaining('Beta') });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
