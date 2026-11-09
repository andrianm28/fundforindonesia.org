import { describe, it, expect, vi, beforeEach } from 'vitest';

const holder = vi.hoisted(() => ({ off: false }));

vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/operations', () => ({ donationsSwitchedOff: vi.fn(async () => holder.off) }));
vi.mock('@/lib/campaign-lifecycle', () => ({
  campaignAcceptsDonations: () => true,
  donationBlock: () => null,
}));

import { campaignRetryRefusal, campaignRetryRefusalWithSwitch } from './donation-retry';

const campaign = { id: 'c1', isDemo: false } as never;
const now = new Date('2026-11-09T00:00:00Z');

beforeEach(() => {
  holder.off = false;
  vi.stubEnv('NEXT_PUBLIC_DONATIONS_ENABLED', 'true');
});

describe('campaignRetryRefusalWithSwitch', () => {
  it('offers the retry when the env gate and the Admin switch are both open', async () => {
    expect(campaignRetryRefusal(campaign, now)).toBeNull();
    expect(await campaignRetryRefusalWithSwitch(campaign, now)).toBeNull();
  });

  it('refuses with the closed message (503) while the Admin switch is off', async () => {
    holder.off = true;
    const refusal = await campaignRetryRefusalWithSwitch(campaign, now);
    expect(refusal?.status).toBe(503);
    expect(refusal?.error).toMatch(/donasi/i);
  });

  it('refuses while the env gate is closed, whatever the switch says', async () => {
    vi.stubEnv('NEXT_PUBLIC_DONATIONS_ENABLED', 'false');
    expect((await campaignRetryRefusalWithSwitch(campaign, now))?.status).toBe(503);
  });
});
