import { describe, it, expect } from 'vitest';
import {
  completeCampaign,
  InvalidTransitionError,
  LifecycleValidationError,
  MissingCampaignUpdateError,
} from './campaign-lifecycle';
import { campaignRow, makeCampaignDb } from '../../tests/support/in-memory-campaign-db';

const NOW = new Date('2026-09-25T10:00:00Z');
const owner = { userId: 'creator-1', assignments: [] as const };
const ownerWhoIsAdmin = { userId: 'creator-1', assignments: ['ADMIN' as const] };
const admin = { userId: 'admin-1', assignments: ['ADMIN' as const] };
const REASON = 'Program selesai dan laporan akhir sudah terbit.';

function activeWithUpdate(overrides: Parameters<typeof campaignRow>[0] = {}) {
  return makeCampaignDb({
    campaigns: [campaignRow({ lifecycleStatus: 'ACTIVE', ...overrides })],
    campaignUpdates: [{ id: 'update-1', campaignId: 'campaign-1' }],
  });
}

describe('completeCampaign', () => {
  it('the owner marks their Active Campaign Completed in both columns, logged in the Fundraiser capacity', async () => {
    const db = activeWithUpdate();

    const result = await completeCampaign(db.prisma as never, { campaignId: 'campaign-1', actor: owner, now: NOW });

    expect(result.campaign).toEqual({
      id: 'campaign-1',
      slug: 'bantu-korban-banjir',
      lifecycleStatus: 'COMPLETED',
      isUrgent: false,
    });
    expect(db.campaign()).toMatchObject({ lifecycleStatus: 'COMPLETED' });
    expect(db.statusChanges).toEqual([
      expect.objectContaining({
        action: 'COMPLETED',
        fromStatus: 'ACTIVE',
        toStatus: 'COMPLETED',
        actorId: 'creator-1',
        capacity: 'FUNDRAISER',
        reason: null,
        createdAt: NOW,
      }),
    ]);
  });

  it('an owner who also holds ADMIN acts as Fundraiser: no reason needed, no Notification', async () => {
    const db = activeWithUpdate();

    await completeCampaign(db.prisma as never, { campaignId: 'campaign-1', actor: ownerWhoIsAdmin, now: NOW });

    expect(db.statusChanges).toEqual([
      expect.objectContaining({ action: 'COMPLETED', actorId: 'creator-1', capacity: 'FUNDRAISER' }),
    ]);
    expect(db.notifications).toEqual([]);
  });

  it('the owner may still leave a reason, which is recorded trimmed', async () => {
    const db = activeWithUpdate();

    await completeCampaign(db.prisma as never, { campaignId: 'campaign-1', actor: owner, reason: `  ${REASON}  `, now: NOW });

    expect(db.statusChanges[0].reason).toBe(REASON);
  });

  it('treats a blank owner reason as no reason', async () => {
    const db = activeWithUpdate();

    await completeCampaign(db.prisma as never, { campaignId: 'campaign-1', actor: owner, reason: '   ', now: NOW });

    expect(db.campaign().lifecycleStatus).toBe('COMPLETED');
    expect(db.statusChanges[0].reason).toBeNull();
  });

  it('the owner is not notified of their own completion', async () => {
    const db = activeWithUpdate();

    await completeCampaign(db.prisma as never, { campaignId: 'campaign-1', actor: owner, now: NOW });

    expect(db.notifications).toEqual([]);
  });

  it('completes a Campaign without a deadline (a wakaf Campaign has no other ending)', async () => {
    const db = activeWithUpdate({ deadline: null });

    const result = await completeCampaign(db.prisma as never, { campaignId: 'campaign-1', actor: owner, now: NOW });

    expect(result.campaign.lifecycleStatus).toBe('COMPLETED');
  });

  it('completes an Active Campaign whose deadline is still ahead', async () => {
    const db = activeWithUpdate({ deadline: new Date('2026-10-01T00:00:00Z') });

    const result = await completeCampaign(db.prisma as never, { campaignId: 'campaign-1', actor: owner, now: NOW });

    expect(result.campaign.lifecycleStatus).toBe('COMPLETED');
  });

  describe('as Admin on a Campaign they do not own', () => {
    it('completes it with a reason, logged in the Admin capacity', async () => {
      const db = activeWithUpdate();

      const result = await completeCampaign(db.prisma as never, { campaignId: 'campaign-1', actor: admin, reason: `  ${REASON} `, now: NOW });

      expect(result.campaign.lifecycleStatus).toBe('COMPLETED');
      expect(db.campaign()).toMatchObject({ lifecycleStatus: 'COMPLETED' });
      expect(db.statusChanges).toEqual([
        expect.objectContaining({
          action: 'COMPLETED',
          fromStatus: 'ACTIVE',
          toStatus: 'COMPLETED',
          actorId: 'admin-1',
          capacity: 'ADMIN',
          reason: REASON,
        }),
      ]);
    });

    it('notifies the Fundraiser in-app, carrying the reason', async () => {
      const db = activeWithUpdate();

      await completeCampaign(db.prisma as never, { campaignId: 'campaign-1', actor: admin, reason: REASON, now: NOW });

      expect(db.notifications).toEqual([
        expect.objectContaining({ userId: 'creator-1', type: 'campaign_status', link: '/campaign/bantu-korban-banjir' }),
      ]);
      expect(db.notifications[0].message).toContain(REASON);
      expect(db.notifications[0].message).toContain('Bantu Korban Banjir');
    });

    it('accepts a reason of exactly 1000 characters', async () => {
      const db = activeWithUpdate();

      await completeCampaign(db.prisma as never, { campaignId: 'campaign-1', actor: admin, reason: 'a'.repeat(1000), now: NOW });

      expect(db.campaign().lifecycleStatus).toBe('COMPLETED');
    });
  });

  it('refuses an owner reason longer than 1000 characters', async () => {
    const db = activeWithUpdate();

    const error = await completeCampaign(db.prisma as never, { campaignId: 'campaign-1', actor: owner, reason: 'a'.repeat(1001), now: NOW }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(LifecycleValidationError);
    expect(db.campaign().lifecycleStatus).toBe('ACTIVE');
  });

  it.each([
    ['the owner', owner, undefined],
    ['an Admin', admin, REASON],
  ])('refuses %s while the Campaign has no Campaign Update', async (_label, actor, reason) => {
    const db = makeCampaignDb({
      campaigns: [campaignRow({ lifecycleStatus: 'ACTIVE' })],
      campaignUpdates: [{ id: 'update-9', campaignId: 'another-campaign' }],
    });

    const error = await completeCampaign(db.prisma as never, { campaignId: 'campaign-1', actor, reason, now: NOW }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(MissingCampaignUpdateError);
    expect(db.campaign().lifecycleStatus).toBe('ACTIVE');
    expect(db.statusChanges).toEqual([]);
    expect(db.notifications).toEqual([]);
  });

  describe.each([
    ['the owner', owner, undefined],
    ['an Admin', admin, REASON],
  ])('outside Active, for %s', (_label, actor, reason) => {
    it.each([
      ['SUBMITTED'],
      ['REJECTED'],
      ['SUSPENDED'],
      ['EXPIRED'],
      ['CANCELLED'],
      ['COMPLETED'],
    ] as const)('refuses a %s Campaign, leaving it as it was', async (lifecycleStatus) => {
      const db = activeWithUpdate({ lifecycleStatus });

      const error = await completeCampaign(db.prisma as never, { campaignId: 'campaign-1', actor, reason, now: NOW }).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(InvalidTransitionError);
      expect((error as InvalidTransitionError).currentStatus).toBe(lifecycleStatus);
      expect(db.campaign()).toMatchObject({ lifecycleStatus });
      expect(db.statusChanges).toEqual([]);
      expect(db.notifications).toEqual([]);
    });
  });

  it('clears Urgent on the way out of Active and logs it with capacity SYSTEM', async () => {
    const db = activeWithUpdate({ isUrgent: true });

    const result = await completeCampaign(db.prisma as never, { campaignId: 'campaign-1', actor: admin, reason: REASON, now: NOW });

    expect(result.campaign.isUrgent).toBe(false);
    expect(db.campaign().isUrgent).toBe(false);
    expect(db.statusChanges).toEqual([
      expect.objectContaining({ action: 'COMPLETED', capacity: 'ADMIN' }),
      expect.objectContaining({ action: 'URGENT_CLEARED', capacity: 'SYSTEM', actorId: null, fromStatus: null, toStatus: null }),
    ]);
  });
});
