import { describe, it, expect } from 'vitest';
import {
  setUrgent,
  InvalidTransitionError,
} from './campaign-lifecycle';
import { campaignRow, makeCampaignDb, type CampaignRow } from '../../tests/support/in-memory-campaign-db';

const NOW = new Date('2026-09-25T10:00:00Z');
const admin = { userId: 'admin-1', assignments: ['ADMIN' as const] };
const REASON = 'Korban banjir bertambah, butuh bantuan segera';

function activeCampaign(overrides: Partial<CampaignRow> = {}) {
  return makeCampaignDb({
    campaigns: [campaignRow({ lifecycleStatus: 'ACTIVE', ...overrides })],
  });
}

describe('setUrgent', () => {
  it('an Admin sets Urgent on an Active Campaign, logged as URGENT_SET in the Admin capacity with the reason', async () => {
    const db = activeCampaign();

    const result = await setUrgent(db.prisma as never, {
      campaignId: 'campaign-1',
      actor: admin,
      urgent: true,
      reason: REASON,
      now: NOW,
    });

    expect(result.campaign).toEqual({
      id: 'campaign-1',
      slug: 'bantu-korban-banjir',
      lifecycleStatus: 'ACTIVE',
      isUrgent: true,
    });
    expect(db.campaign()).toMatchObject({ isUrgent: true, lifecycleStatus: 'ACTIVE' });
    expect(db.statusChanges).toEqual([
      expect.objectContaining({
        campaignId: 'campaign-1',
        action: 'URGENT_SET',
        fromStatus: null,
        toStatus: null,
        actorId: 'admin-1',
        capacity: 'ADMIN',
        reason: REASON,
        createdAt: NOW,
      }),
    ]);
  });

  it('an Admin clears Urgent, logged as URGENT_CLEARED in the Admin capacity with the reason', async () => {
    const db = activeCampaign({ isUrgent: true });

    const result = await setUrgent(db.prisma as never, {
      campaignId: 'campaign-1',
      actor: admin,
      urgent: false,
      reason: 'Kebutuhan sudah terpenuhi',
      now: NOW,
    });

    expect(result.campaign).toMatchObject({ lifecycleStatus: 'ACTIVE', isUrgent: false });
    expect(db.campaign().isUrgent).toBe(false);
    expect(db.statusChanges).toEqual([
      expect.objectContaining({
        action: 'URGENT_CLEARED',
        fromStatus: null,
        toStatus: null,
        actorId: 'admin-1',
        capacity: 'ADMIN',
        reason: 'Kebutuhan sudah terpenuhi',
        createdAt: NOW,
      }),
    ]);
  });

  describe('who may act', () => {
    it('lets a person holding both assignments act, recorded in the Admin capacity', async () => {
      const db = activeCampaign();
      const both = { userId: 'admin-2', assignments: ['VERIFIER' as const, 'ADMIN' as const] };

      await setUrgent(db.prisma as never, { campaignId: 'campaign-1', actor: both, urgent: true, reason: REASON, now: NOW });

      expect(db.statusChanges).toEqual([expect.objectContaining({ actorId: 'admin-2', capacity: 'ADMIN' })]);
    });
  });

  describe('reason', () => {
    it('records the reason trimmed, and accepts exactly 1000 characters', async () => {
      const db = activeCampaign();
      const longest = 'b'.repeat(1000);

      await setUrgent(db.prisma as never, {
        campaignId: 'campaign-1',
        actor: admin,
        urgent: true,
        reason: `  ${longest}\n`,
        now: NOW,
      });

      expect(db.statusChanges[0].reason).toBe(longest);
    });
  });

  describe('status', () => {
    it.each([
      ['DRAFT'],
      ['SUBMITTED'],
      ['REJECTED'],
      ['SUSPENDED'],
      ['CANCELLED'],
      ['COMPLETED'],
      ['EXPIRED'],
    ] as const)('refuses to set Urgent on a %s Campaign with InvalidTransitionError and changes nothing', async (lifecycleStatus) => {
      const db = makeCampaignDb({ campaigns: [campaignRow({ lifecycleStatus })] });

      const refusal = await setUrgent(db.prisma as never, {
        campaignId: 'campaign-1',
        actor: admin,
        urgent: true,
        reason: REASON,
        now: NOW,
      }).catch((error: unknown) => error);

      expect(refusal).toBeInstanceOf(InvalidTransitionError);
      expect(refusal).toMatchObject({ currentStatus: lifecycleStatus });
      expect(db.campaign()).toMatchObject({ lifecycleStatus, isUrgent: false });
      expect(db.statusChanges).toEqual([]);
    });

    it('sets Urgent on an Active Campaign before its deadline', async () => {
      const db = activeCampaign({ deadline: new Date('2026-10-01T00:00:00Z') });

      const result = await setUrgent(db.prisma as never, { campaignId: 'campaign-1', actor: admin, urgent: true, reason: REASON, now: NOW });

      expect(result.campaign).toMatchObject({ lifecycleStatus: 'ACTIVE', isUrgent: true });
    });

    it.each([
      ['SUSPENDED'],
      ['COMPLETED'],
      ['EXPIRED'],
    ] as const)('clears an Urgent flag left on a %s Campaign, since clearing is allowed whenever the flag is set', async (lifecycleStatus) => {
      const db = makeCampaignDb({ campaigns: [campaignRow({ lifecycleStatus, isUrgent: true })] });

      const result = await setUrgent(db.prisma as never, {
        campaignId: 'campaign-1',
        actor: admin,
        urgent: false,
        reason: REASON,
        now: NOW,
      });

      expect(result.campaign).toMatchObject({ lifecycleStatus, isUrgent: false });
      expect(db.campaign()).toMatchObject({ lifecycleStatus, isUrgent: false });
      expect(db.statusChanges).toEqual([
        expect.objectContaining({ action: 'URGENT_CLEARED', actorId: 'admin-1', capacity: 'ADMIN', reason: REASON }),
      ]);
    });
  });

  describe('a change that is already in place', () => {
    it('setting Urgent that is already set answers the Campaign as it is and logs nothing', async () => {
      const db = activeCampaign({ isUrgent: true });

      const result = await setUrgent(db.prisma as never, { campaignId: 'campaign-1', actor: admin, urgent: true, reason: REASON, now: NOW });

      expect(result.campaign).toMatchObject({ lifecycleStatus: 'ACTIVE', isUrgent: true });
      expect(db.statusChanges).toEqual([]);
    });

    it.each([
      ['ACTIVE'],
      ['SUSPENDED'],
    ] as const)('clearing Urgent on a %s Campaign that is not Urgent answers the Campaign as it is and logs nothing', async (lifecycleStatus) => {
      const db = makeCampaignDb({ campaigns: [campaignRow({ lifecycleStatus })] });

      const result = await setUrgent(db.prisma as never, { campaignId: 'campaign-1', actor: admin, urgent: false, reason: REASON, now: NOW });

      expect(result.campaign).toMatchObject({ lifecycleStatus, isUrgent: false });
      expect(db.statusChanges).toEqual([]);
    });

    it.each([true, false])(
      'finds another Admin already set Urgent to %s, committed while it waited for the lock: one log row, not two',
      async (urgent) => {
        const db = activeCampaign({ isUrgent: !urgent });
        db.beforeNextRowLock((data) => {
          data.campaigns[0].isUrgent = urgent;
          data.statusChanges.push({
            id: 'change-other', campaignId: 'campaign-1', action: urgent ? 'URGENT_SET' : 'URGENT_CLEARED',
            fromStatus: null, toStatus: null, actorId: 'admin-2', capacity: 'ADMIN', reason: 'Admin lain', createdAt: NOW,
          });
        });

        const result = await setUrgent(db.prisma as never, { campaignId: 'campaign-1', actor: admin, urgent, reason: REASON, now: NOW });

        expect(result.campaign.isUrgent).toBe(urgent);
        expect(db.statusChanges).toEqual([expect.objectContaining({ id: 'change-other', actorId: 'admin-2' })]);
      },
    );

    it('clearing Urgent on an Active Campaign past its deadline finds the expiry already cleared it (capacity SYSTEM)', async () => {
      const db = activeCampaign({ isUrgent: true, deadline: new Date('2026-09-01T00:00:00Z') });

      const result = await setUrgent(db.prisma as never, { campaignId: 'campaign-1', actor: admin, urgent: false, reason: REASON, now: NOW });

      expect(result.campaign).toMatchObject({ lifecycleStatus: 'EXPIRED', isUrgent: false });
      expect(db.statusChanges.map((change) => [change.action, change.capacity])).toEqual([
        ['EXPIRED', 'SYSTEM'],
        ['URGENT_CLEARED', 'SYSTEM'],
      ]);
    });
  });
});
