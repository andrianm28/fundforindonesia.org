import { describe, it, expect } from 'vitest';
import {
  setUrgent,
  CampaignNotFoundError,
  ConcurrentTransitionError,
  InvalidTransitionError,
  LifecycleValidationError,
  NotAuthorizedError,
  OwnCampaignConflictError,
} from './campaign-lifecycle';
import { campaignRow, makeCampaignDb, type CampaignRow } from '../../tests/support/in-memory-campaign-db';

const NOW = new Date('2026-09-25T10:00:00Z');
const admin = { userId: 'admin-1', assignments: ['ADMIN' as const] };
const REASON = 'Korban banjir bertambah, butuh bantuan segera';

function activeCampaign(overrides: Partial<CampaignRow> = {}) {
  return makeCampaignDb({
    campaigns: [campaignRow({ status: 'active', lifecycleStatus: 'ACTIVE', ...overrides })],
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
    expect(db.campaign()).toMatchObject({ isUrgent: true, status: 'active', lifecycleStatus: 'ACTIVE' });
    expect(db.statusChanges).toEqual([
      expect.objectContaining({
        campaignId: 'campaign-1',
        action: 'URGENT_SET',
        fromStatus: null,
        toStatus: null,
        actorId: 'admin-1',
        capacity: 'ADMIN',
        reason: REASON,
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
      }),
    ]);
  });

  describe('who may act', () => {
    it.each([
      ['a Verifier', { userId: 'verifier-1', assignments: ['VERIFIER' as const] }],
      ['a person with no assignment', { userId: 'someone-1', assignments: [] }],
      ['the Fundraiser of the Campaign', { userId: 'creator-1', assignments: [] }],
    ])('refuses %s with NotAuthorizedError and changes nothing', async (_who, actor) => {
      const db = activeCampaign();

      await expect(
        setUrgent(db.prisma as never, { campaignId: 'campaign-1', actor, urgent: true, reason: REASON, now: NOW }),
      ).rejects.toBeInstanceOf(NotAuthorizedError);
      expect(db.campaign().isUrgent).toBe(false);
      expect(db.statusChanges).toEqual([]);
    });

    it.each([true, false])(
      'refuses an Admin who owns the Campaign (urgent: %s) with OwnCampaignConflictError and changes nothing',
      async (urgent) => {
        const db = activeCampaign({ isUrgent: !urgent });
        const ownerAdmin = { userId: 'creator-1', assignments: ['ADMIN' as const] };

        await expect(
          setUrgent(db.prisma as never, { campaignId: 'campaign-1', actor: ownerAdmin, urgent, reason: REASON, now: NOW }),
        ).rejects.toBeInstanceOf(OwnCampaignConflictError);
        expect(db.campaign().isUrgent).toBe(!urgent);
        expect(db.statusChanges).toEqual([]);
      },
    );

    it('lets a person holding both assignments act, recorded in the Admin capacity', async () => {
      const db = activeCampaign();
      const both = { userId: 'admin-2', assignments: ['VERIFIER' as const, 'ADMIN' as const] };

      await setUrgent(db.prisma as never, { campaignId: 'campaign-1', actor: both, urgent: true, reason: REASON, now: NOW });

      expect(db.statusChanges).toEqual([expect.objectContaining({ actorId: 'admin-2', capacity: 'ADMIN' })]);
    });

    it('refuses an unknown Campaign with CampaignNotFoundError', async () => {
      const db = activeCampaign();

      await expect(
        setUrgent(db.prisma as never, { campaignId: 'nope', actor: admin, urgent: true, reason: REASON, now: NOW }),
      ).rejects.toBeInstanceOf(CampaignNotFoundError);
      expect(db.statusChanges).toEqual([]);
    });
  });

  describe('reason', () => {
    it.each([
      ['missing', undefined],
      ['blank', '   '],
      ['not text', 42],
      ['longer than 1000 characters', 'a'.repeat(1001)],
    ])('refuses a %s reason with LifecycleValidationError on the reason field, for set and clear', async (_what, reason) => {
      for (const urgent of [true, false]) {
        const db = activeCampaign({ isUrgent: !urgent });

        const refusal = await setUrgent(db.prisma as never, {
          campaignId: 'campaign-1',
          actor: admin,
          urgent,
          reason,
          now: NOW,
        }).catch((error: unknown) => error);

        expect(refusal).toBeInstanceOf(LifecycleValidationError);
        expect(refusal).toMatchObject({ field: 'reason' });
        expect(db.campaign().isUrgent).toBe(!urgent);
        expect(db.statusChanges).toEqual([]);
      }
    });

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
      ['DRAFT', 'draft'],
      ['SUBMITTED', 'pending'],
      ['REJECTED', 'rejected'],
      ['SUSPENDED', 'suspended'],
      ['CANCELLED', 'cancelled'],
      ['COMPLETED', 'completed'],
      ['EXPIRED', 'expired'],
    ] as const)('refuses to set Urgent on a %s Campaign with InvalidTransitionError and changes nothing', async (lifecycleStatus, status) => {
      const db = makeCampaignDb({ campaigns: [campaignRow({ lifecycleStatus, status })] });

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

    it('records an Active Campaign past its deadline as Expired, refuses to set Urgent, and keeps the expiry', async () => {
      const db = activeCampaign({ deadline: new Date('2026-09-01T00:00:00Z') });

      const refusal = await setUrgent(db.prisma as never, {
        campaignId: 'campaign-1',
        actor: admin,
        urgent: true,
        reason: REASON,
        now: NOW,
      }).catch((error: unknown) => error);

      expect(refusal).toBeInstanceOf(InvalidTransitionError);
      expect(refusal).toMatchObject({ currentStatus: 'EXPIRED' });
      expect(db.campaign()).toMatchObject({ status: 'expired', lifecycleStatus: 'EXPIRED', isUrgent: false });
      expect(db.statusChanges).toEqual([
        expect.objectContaining({ action: 'EXPIRED', fromStatus: 'ACTIVE', toStatus: 'EXPIRED', capacity: 'SYSTEM', actorId: null }),
      ]);
    });

    it.each([
      ['SUSPENDED', 'suspended'],
      ['COMPLETED', 'completed'],
      ['EXPIRED', 'expired'],
    ] as const)('clears an Urgent flag left on a %s Campaign, since clearing is allowed whenever the flag is set', async (lifecycleStatus, status) => {
      const db = makeCampaignDb({ campaigns: [campaignRow({ lifecycleStatus, status, isUrgent: true })] });

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
      ['ACTIVE', 'active'],
      ['SUSPENDED', 'suspended'],
    ] as const)('clearing Urgent on a %s Campaign that is not Urgent answers the Campaign as it is and logs nothing', async (lifecycleStatus, status) => {
      const db = makeCampaignDb({ campaigns: [campaignRow({ lifecycleStatus, status })] });

      const result = await setUrgent(db.prisma as never, { campaignId: 'campaign-1', actor: admin, urgent: false, reason: REASON, now: NOW });

      expect(result.campaign).toMatchObject({ lifecycleStatus, isUrgent: false });
      expect(db.statusChanges).toEqual([]);
    });

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

  describe('concurrency', () => {
    it('loses with ConcurrentTransitionError when the Campaign leaves Active between the read and the write', async () => {
      const db = activeCampaign();
      db.beforeNextCampaignWrite((data) => {
        Object.assign(data.campaigns[0], { status: 'suspended', lifecycleStatus: 'SUSPENDED' });
      });

      await expect(
        setUrgent(db.prisma as never, { campaignId: 'campaign-1', actor: admin, urgent: true, reason: REASON, now: NOW }),
      ).rejects.toBeInstanceOf(ConcurrentTransitionError);
      expect(db.campaign()).toMatchObject({ lifecycleStatus: 'SUSPENDED', isUrgent: false });
      expect(db.statusChanges).toEqual([]);
    });

    it.each([true, false])(
      'loses with ConcurrentTransitionError when another Admin flips the flag to %s first: one change, no second log row',
      async (urgent) => {
        const db = activeCampaign({ isUrgent: !urgent });
        db.beforeNextCampaignWrite((data) => {
          data.campaigns[0].isUrgent = urgent;
        });

        await expect(
          setUrgent(db.prisma as never, { campaignId: 'campaign-1', actor: admin, urgent, reason: REASON, now: NOW }),
        ).rejects.toBeInstanceOf(ConcurrentTransitionError);
        expect(db.campaign().isUrgent).toBe(urgent);
        expect(db.statusChanges).toEqual([]);
      },
    );
  });
});
