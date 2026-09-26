import { describe, it, expect } from 'vitest';
import {
  liftSuspension,
  suspendCampaign,
  InvalidTransitionError,
  SameAdminLiftError,
} from './campaign-lifecycle';
import {
  campaignRow,
  makeCampaignDb,
  type CampaignRow,
} from '../../tests/support/in-memory-campaign-db';

/**
 * Suspension and lifting it (ADR 0015, FFI-07b), run against the in-memory
 * Prisma stand-in: assertions are about the rows a command leaves behind.
 */
const NOW = new Date('2026-09-25T10:00:00Z');
const PAST = new Date('2026-09-20T00:00:00Z');
const FUTURE = new Date('2026-12-31T00:00:00Z');

const adminA = { userId: 'admin-a', assignments: ['ADMIN' as const] };
const adminB = { userId: 'admin-b', assignments: ['ADMIN' as const] };

function active(overrides: Partial<CampaignRow> = {}): CampaignRow {
  return campaignRow({ lifecycleStatus: 'ACTIVE', deadline: FUTURE, ...overrides });
}

function suspend(db: ReturnType<typeof makeCampaignDb>, overrides: Record<string, unknown> = {}) {
  return suspendCampaign(db.prisma as never, {
    campaignId: 'campaign-1',
    actor: adminA,
    reason: 'Laporan penipuan terverifikasi',
    now: NOW,
    ...overrides,
  });
}

function lift(db: ReturnType<typeof makeCampaignDb>, overrides: Record<string, unknown> = {}) {
  return liftSuspension(db.prisma as never, {
    campaignId: 'campaign-1',
    actor: adminB,
    reason: 'Klarifikasi diterima',
    now: NOW,
    ...overrides,
  });
}

describe('suspendCampaign', () => {
  it('suspends an Active Campaign in both columns and records the Admin, capacity ADMIN and reason', async () => {
    const db = makeCampaignDb({ campaigns: [active()] });

    const result = await suspend(db);

    expect(result.campaign).toEqual({
      id: 'campaign-1',
      slug: 'bantu-korban-banjir',
      lifecycleStatus: 'SUSPENDED',
      isUrgent: false,
    });
    expect(db.campaign()).toMatchObject({ lifecycleStatus: 'SUSPENDED' });
    expect(db.statusChanges).toEqual([
      expect.objectContaining({
        campaignId: 'campaign-1',
        action: 'SUSPENDED',
        fromStatus: 'ACTIVE',
        toStatus: 'SUSPENDED',
        actorId: 'admin-a',
        capacity: 'ADMIN',
        reason: 'Laporan penipuan terverifikasi',
        createdAt: NOW,
      }),
    ]);
  });

  it('lets a person holding both assignments suspend, recorded in the Admin capacity', async () => {
    const db = makeCampaignDb({ campaigns: [active()] });

    await suspend(db, { actor: { userId: 'admin-a', assignments: ['VERIFIER', 'ADMIN'] } });

    expect(db.statusChanges).toEqual([
      expect.objectContaining({ action: 'SUSPENDED', actorId: 'admin-a', capacity: 'ADMIN' }),
    ]);
  });

  it.each([
    ['expired', 'EXPIRED'],
    ['completed', 'COMPLETED'],
  ] as const)('suspends a %s Campaign (ADR 0015), logging where it came from', async (status, lifecycleStatus) => {
    const db = makeCampaignDb({ campaigns: [campaignRow({ lifecycleStatus, deadline: PAST })] });

    const result = await suspend(db);

    expect(result.campaign.lifecycleStatus).toBe('SUSPENDED');
    expect(db.campaign()).toMatchObject({ lifecycleStatus: 'SUSPENDED' });
    expect(db.statusChanges).toEqual([
      expect.objectContaining({ action: 'SUSPENDED', fromStatus: lifecycleStatus, toStatus: 'SUSPENDED' }),
    ]);
  });

  it('records a lazy expiry first, then suspends the now Expired Campaign', async () => {
    const db = makeCampaignDb({ campaigns: [active({ deadline: PAST })] });

    await suspend(db);

    expect(db.campaign().lifecycleStatus).toBe('SUSPENDED');
    expect(db.statusChanges).toEqual([
      expect.objectContaining({ action: 'EXPIRED', fromStatus: 'ACTIVE', toStatus: 'EXPIRED', capacity: 'SYSTEM' }),
      expect.objectContaining({ action: 'SUSPENDED', fromStatus: 'EXPIRED', toStatus: 'SUSPENDED', capacity: 'ADMIN' }),
    ]);
  });

  it.each([
    ['suspended', 'SUSPENDED'],
    ['cancelled', 'CANCELLED'],
    ['rejected', 'REJECTED'],
    ['pending', 'SUBMITTED'],
  ] as const)('refuses to suspend a Campaign that is %s with InvalidTransitionError and changes nothing', async (status, lifecycleStatus) => {
    const db = makeCampaignDb({ campaigns: [campaignRow({ lifecycleStatus })] });

    const refusal = suspend(db);

    await expect(refusal).rejects.toBeInstanceOf(InvalidTransitionError);
    await expect(refusal).rejects.toMatchObject({ currentStatus: lifecycleStatus });
    expect(db.campaign().lifecycleStatus).toBe(lifecycleStatus);
    expect(db.statusChanges).toEqual([]);
    expect(db.notifications).toEqual([]);
  });

  it('clears Urgent when suspending an Active Campaign, logged with capacity SYSTEM', async () => {
    const db = makeCampaignDb({ campaigns: [active({ isUrgent: true })] });

    const result = await suspend(db);

    expect(result.campaign.isUrgent).toBe(false);
    expect(db.campaign().isUrgent).toBe(false);
    expect(db.statusChanges).toEqual([
      expect.objectContaining({ action: 'SUSPENDED', capacity: 'ADMIN' }),
      expect.objectContaining({ action: 'URGENT_CLEARED', capacity: 'SYSTEM', actorId: null }),
    ]);
  });

  it('notifies the Fundraiser in-app with the reason', async () => {
    const db = makeCampaignDb({ campaigns: [active()] });

    await suspend(db);

    expect(db.notifications).toEqual([
      expect.objectContaining({
        userId: 'creator-1',
        type: 'campaign_status',
        link: '/campaign/bantu-korban-banjir',
        message: expect.stringContaining('Laporan penipuan terverifikasi'),
      }),
    ]);
    expect(db.notifications[0].message).not.toMatch(/moderator/i);
  });

  it('stores the reason trimmed and accepts exactly 1000 characters', async () => {
    const db = makeCampaignDb({ campaigns: [active()] });
    const reason = 'y'.repeat(1000);

    await suspend(db, { reason: `  ${reason}  ` });

    expect(db.statusChanges[0].reason).toBe(reason);
  });
});

/** A Campaign suspended by admin-a from `from`, as a real Suspension leaves it. */
function suspendedFrom(
  from: 'ACTIVE' | 'EXPIRED' | 'COMPLETED',
  overrides: Partial<CampaignRow> = {},
  suspendedBy = 'admin-a',
) {
  const db = makeCampaignDb({
    campaigns: [campaignRow({ lifecycleStatus: 'SUSPENDED', deadline: FUTURE, ...overrides })],
    statusChanges: [
      {
        id: 'suspension-1', campaignId: 'campaign-1', action: 'SUSPENDED', fromStatus: from,
        toStatus: 'SUSPENDED', actorId: suspendedBy, capacity: 'ADMIN', reason: 'Laporan penipuan',
        createdAt: new Date('2026-09-21T00:00:00Z'),
      },
    ],
  });
  return db;
}

describe('liftSuspension', () => {
  it('returns a Campaign suspended while Active to Active, logging the lift with actor, capacity ADMIN and reason', async () => {
    const db = suspendedFrom('ACTIVE');

    const result = await lift(db);

    expect(result.campaign).toEqual({
      id: 'campaign-1',
      slug: 'bantu-korban-banjir',
      lifecycleStatus: 'ACTIVE',
      isUrgent: false,
    });
    expect(db.campaign()).toMatchObject({ lifecycleStatus: 'ACTIVE' });
    expect(db.statusChanges.slice(1)).toEqual([
      expect.objectContaining({
        campaignId: 'campaign-1',
        action: 'SUSPENSION_LIFTED',
        fromStatus: 'SUSPENDED',
        toStatus: 'ACTIVE',
        actorId: 'admin-b',
        capacity: 'ADMIN',
        reason: 'Klarifikasi diterima',
        createdAt: NOW,
      }),
    ]);
  });

  it.each([
    ['EXPIRED'],
    ['COMPLETED'],
  ] as const)('returns a Campaign suspended while %s to that status, never to Active', async (from) => {
    const db = suspendedFrom(from, { deadline: PAST });

    const result = await lift(db);

    expect(result.campaign.lifecycleStatus).toBe(from);
    expect(db.campaign()).toMatchObject({ lifecycleStatus: from });
    expect(db.statusChanges[1]).toMatchObject({ action: 'SUSPENSION_LIFTED', fromStatus: 'SUSPENDED', toStatus: from });
  });

  it('lands a Campaign suspended while Active on Expired when its deadline passed during the Suspension', async () => {
    const db = suspendedFrom('ACTIVE', { deadline: PAST });

    const result = await lift(db);

    expect(result.campaign.lifecycleStatus).toBe('EXPIRED');
    expect(db.campaign()).toMatchObject({ lifecycleStatus: 'EXPIRED' });
    expect(db.statusChanges.slice(1)).toEqual([
      expect.objectContaining({ action: 'SUSPENSION_LIFTED', fromStatus: 'SUSPENDED', toStatus: 'EXPIRED', capacity: 'ADMIN' }),
    ]);
    expect(db.notifications[0].message).toContain('Expired');
  });

  it('returns a Campaign suspended while Active and without a deadline to Active', async () => {
    const db = suspendedFrom('ACTIVE', { deadline: null });

    expect((await lift(db)).campaign.lifecycleStatus).toBe('ACTIVE');
  });

  it('restores from the latest Suspension, not an earlier one', async () => {
    const db = makeCampaignDb({
      campaigns: [campaignRow({ lifecycleStatus: 'SUSPENDED', deadline: FUTURE })],
      statusChanges: [
        {
          id: 's-old', campaignId: 'campaign-1', action: 'SUSPENDED', fromStatus: 'ACTIVE', toStatus: 'SUSPENDED',
          actorId: 'admin-b', capacity: 'ADMIN', reason: 'lama', createdAt: new Date('2026-09-01T00:00:00Z'),
        },
        {
          id: 'l-old', campaignId: 'campaign-1', action: 'SUSPENSION_LIFTED', fromStatus: 'SUSPENDED', toStatus: 'ACTIVE',
          actorId: 'admin-a', capacity: 'ADMIN', reason: 'lama', createdAt: new Date('2026-09-02T00:00:00Z'),
        },
        {
          id: 'c', campaignId: 'campaign-1', action: 'COMPLETED', fromStatus: 'ACTIVE', toStatus: 'COMPLETED',
          actorId: 'creator-1', capacity: 'FUNDRAISER', reason: null, createdAt: new Date('2026-09-03T00:00:00Z'),
        },
        {
          id: 's-new', campaignId: 'campaign-1', action: 'SUSPENDED', fromStatus: 'COMPLETED', toStatus: 'SUSPENDED',
          actorId: 'admin-a', capacity: 'ADMIN', reason: 'baru', createdAt: new Date('2026-09-04T00:00:00Z'),
        },
      ],
    });

    // admin-b imposed only the earlier Suspension, so may lift the latest one.
    const result = await lift(db);
    expect(result.campaign.lifecycleStatus).toBe('COMPLETED');

    // admin-a imposed the latest one, so may not.
    const again = suspendedFrom('ACTIVE');
    await expect(lift(again, { actor: adminA })).rejects.toBeInstanceOf(SameAdminLiftError);
  });

  it('refuses the Admin who imposed the latest Suspension with SameAdminLiftError and changes nothing', async () => {
    const db = suspendedFrom('ACTIVE');

    const refusal = lift(db, { actor: adminA });

    await expect(refusal).rejects.toBeInstanceOf(SameAdminLiftError);
    await expect(refusal).rejects.toThrow(/Admin lain/);
    expect(db.campaign().lifecycleStatus).toBe('SUSPENDED');
    expect(db.statusChanges).toHaveLength(1);
    expect(db.notifications).toEqual([]);
  });

  it.each([
    ['active', 'ACTIVE'],
    ['expired', 'EXPIRED'],
    ['completed', 'COMPLETED'],
    ['cancelled', 'CANCELLED'],
    ['rejected', 'REJECTED'],
    ['pending', 'SUBMITTED'],
  ] as const)('refuses to lift a Campaign that is %s with InvalidTransitionError and changes nothing', async (status, lifecycleStatus) => {
    const db = makeCampaignDb({ campaigns: [campaignRow({ lifecycleStatus, deadline: FUTURE })] });

    const refusal = lift(db);

    await expect(refusal).rejects.toBeInstanceOf(InvalidTransitionError);
    await expect(refusal).rejects.toMatchObject({ currentStatus: lifecycleStatus });
    expect(db.campaign().lifecycleStatus).toBe(lifecycleStatus);
    expect(db.statusChanges).toEqual([]);
  });

  it('refuses a Suspension with no recorded history (imposed before the log existed) rather than guessing its prior status', async () => {
    const db = makeCampaignDb({
      campaigns: [campaignRow({ lifecycleStatus: 'SUSPENDED' })],
    });

    const refusal = lift(db);

    await expect(refusal).rejects.toBeInstanceOf(InvalidTransitionError);
    await expect(refusal).rejects.toThrow(/sebelum riwayat status dicatat/);
    expect(db.campaign().lifecycleStatus).toBe('SUSPENDED');
    expect(db.statusChanges).toEqual([]);
  });

  it('never restores Urgent: a Campaign Urgent before its Suspension comes back Active but not Urgent', async () => {
    const db = makeCampaignDb({ campaigns: [active({ isUrgent: true })] });

    await suspend(db);
    const result = await lift(db);

    expect(result.campaign).toMatchObject({ lifecycleStatus: 'ACTIVE', isUrgent: false });
    expect(db.campaign().isUrgent).toBe(false);
    expect(db.statusChanges.map((s) => s.action)).toEqual(['SUSPENDED', 'URGENT_CLEARED', 'SUSPENSION_LIFTED']);
  });

  it('notifies the Fundraiser in-app with the reason and the restored status', async () => {
    const db = suspendedFrom('COMPLETED');

    await lift(db);

    expect(db.notifications).toEqual([
      expect.objectContaining({
        userId: 'creator-1',
        type: 'campaign_status',
        link: '/campaign/bantu-korban-banjir',
        message: expect.stringContaining('Klarifikasi diterima'),
      }),
    ]);
    expect(db.notifications[0].message).toContain('Completed');
    expect(db.notifications[0].message).not.toMatch(/moderator/i);
  });
});
