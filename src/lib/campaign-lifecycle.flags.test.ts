import { describe, it, expect } from 'vitest';
import {
  dismissFlag,
  flagCampaign,
  FlagAlreadyResolvedError,
  FlagNotFoundError,
  InvalidTransitionError,
  domainErrorToHttp,
  OwnSubjectConflictError,
  suspendCampaign,
} from './campaign-lifecycle';
import {
  campaignFlagRow,
  campaignRow,
  makeCampaignDb,
  type CampaignRow,
} from '../../tests/support/in-memory-campaign-db';

/**
 * Flags from a Verifier (ticket 06): raising a Flag, an Admin dismissing
 * it, and a Suspension resolving every open one. Run against the in-memory
 * Prisma stand-in: assertions are about the rows a command leaves behind.
 */
const NOW = new Date('2026-09-25T10:00:00Z');
const PAST = new Date('2026-09-20T00:00:00Z');
const FUTURE = new Date('2026-12-31T00:00:00Z');

const verifier = { userId: 'verifier-1', assignments: ['VERIFIER' as const] };
const adminA = { userId: 'admin-a', assignments: ['ADMIN' as const] };

function active(overrides: Partial<CampaignRow> = {}): CampaignRow {
  return campaignRow({ lifecycleStatus: 'ACTIVE', deadline: FUTURE, ...overrides });
}

function flag(db: ReturnType<typeof makeCampaignDb>, overrides: Record<string, unknown> = {}) {
  return flagCampaign(db.prisma as never, {
    campaignId: 'campaign-1',
    actor: verifier,
    reason: 'Foto pasien diambil dari berita lama',
    now: NOW,
    ...overrides,
  });
}

describe('flagCampaign', () => {
  it('raises an open Flag on an Active Campaign with the Verifier and reason, leaving the Campaign unchanged', async () => {
    const db = makeCampaignDb({ campaigns: [active({ isUrgent: true })] });

    const result = await flag(db);

    expect(result.campaign).toEqual({
      id: 'campaign-1',
      slug: 'bantu-korban-banjir',
      lifecycleStatus: 'ACTIVE',
      isUrgent: true,
    });
    expect(result.flag).toMatchObject({
      campaignId: 'campaign-1',
      verifierId: 'verifier-1',
      reason: 'Foto pasien diambil dari berita lama',
      createdAt: NOW,
      resolution: null,
      resolvedById: null,
      resolutionReason: null,
      resolvedAt: null,
    });
    expect(db.campaignFlags).toEqual([result.flag]);
    expect(db.campaign()).toMatchObject({ lifecycleStatus: 'ACTIVE', isUrgent: true });
    expect(db.statusChanges).toEqual([]);
  });

  it('stores the reason trimmed and accepts exactly 1000 characters', async () => {
    const db = makeCampaignDb({ campaigns: [active()] });

    await flag(db, { reason: '  Donasi dialihkan  ' });
    await flag(db, { reason: 'y'.repeat(1000) });

    expect(db.campaignFlags.map((f) => f.reason)).toEqual(['Donasi dialihkan', 'y'.repeat(1000)]);
  });

  it.each([
    ['expired', 'EXPIRED'],
    ['completed', 'COMPLETED'],
  ] as const)('raises a Flag on a Campaign that is already %s, leaving it unchanged', async (status, lifecycleStatus) => {
    const db = makeCampaignDb({ campaigns: [campaignRow({ lifecycleStatus, deadline: PAST })] });

    const result = await flag(db);

    expect(result.campaign.lifecycleStatus).toBe(lifecycleStatus);
    expect(result.flag.resolution).toBeNull();
    expect(db.campaignFlags).toHaveLength(1);
    expect(db.statusChanges).toEqual([]);
  });

  it.each([
    ['suspended', 'SUSPENDED'],
    ['cancelled', 'CANCELLED'],
    ['rejected', 'REJECTED'],
    ['pending', 'SUBMITTED'],
  ] as const)('refuses a Campaign that is %s with InvalidTransitionError and raises nothing', async (status, lifecycleStatus) => {
    const db = makeCampaignDb({ campaigns: [campaignRow({ lifecycleStatus })] });

    const error = await flag(db).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(InvalidTransitionError);
    expect((error as InvalidTransitionError).currentStatus).toBe(lifecycleStatus);
    expect(db.campaignFlags).toEqual([]);
  });

  it('refuses a Draft Campaign with InvalidTransitionError', async () => {
    const db = makeCampaignDb({ campaigns: [campaignRow({ lifecycleStatus: 'DRAFT' })] });

    await expect(flag(db)).rejects.toBeInstanceOf(InvalidTransitionError);
    expect(db.campaignFlags).toEqual([]);
  });

  it('records a lazy expiry first, then raises the Flag on the now Expired Campaign', async () => {
    const db = makeCampaignDb({ campaigns: [active({ deadline: PAST, isUrgent: true })] });

    const result = await flag(db);

    expect(result.campaign).toMatchObject({ lifecycleStatus: 'EXPIRED', isUrgent: false });
    expect(db.statusChanges.map((s) => [s.action, s.capacity])).toEqual([
      ['EXPIRED', 'SYSTEM'],
      ['URGENT_CLEARED', 'SYSTEM'],
    ]);
    expect(db.campaignFlags).toHaveLength(1);
  });

  it('keeps several open Flags on the same Campaign separately, each with its own author and reason', async () => {
    const db = makeCampaignDb({ campaigns: [active()] });
    const otherVerifier = { userId: 'verifier-2', assignments: ['VERIFIER' as const] };

    const first = await flag(db, { reason: 'Foto palsu' });
    const second = await flag(db, { actor: otherVerifier, reason: 'Rekening atas nama orang lain' });
    const third = await flag(db, { reason: 'Nomor telepon tidak aktif' });

    expect(new Set([first.flag.id, second.flag.id, third.flag.id]).size).toBe(3);
    expect(db.campaignFlags.map((f) => [f.verifierId, f.reason, f.resolution])).toEqual([
      ['verifier-1', 'Foto palsu', null],
      ['verifier-2', 'Rekening atas nama orang lain', null],
      ['verifier-1', 'Nomor telepon tidak aktif', null],
    ]);
  });

  it('lets a person holding both assignments flag, and never notifies the Fundraiser', async () => {
    const db = makeCampaignDb({ campaigns: [active()] });

    await flag(db, { actor: { userId: 'admin-a', assignments: ['ADMIN', 'VERIFIER'] } });

    expect(db.campaignFlags).toEqual([expect.objectContaining({ verifierId: 'admin-a' })]);
    expect(db.notifications).toEqual([]);
  });
});

describe('suspendCampaign resolving Flags', () => {
  const EARLIER = new Date('2026-09-10T00:00:00Z');

  function suspend(db: ReturnType<typeof makeCampaignDb>, overrides: Record<string, unknown> = {}) {
    return suspendCampaign(db.prisma as never, {
      campaignId: 'campaign-1',
      actor: adminA,
      reason: 'Penipuan terverifikasi',
      now: NOW,
      ...overrides,
    });
  }

  it('marks every open Flag on the Campaign SUSPENDED, resolved by the suspending Admin with the reason and time', async () => {
    const db = makeCampaignDb({
      campaigns: [active(), active({ id: 'campaign-2', slug: 'lain' })],
      campaignFlags: [
        campaignFlagRow({ id: 'flag-a' }),
        campaignFlagRow({ id: 'flag-b', verifierId: 'verifier-2' }),
        campaignFlagRow({
          id: 'flag-dismissed', resolution: 'DISMISSED', resolvedById: 'admin-b',
          resolutionReason: 'Sudah diklarifikasi', resolvedAt: EARLIER,
        }),
        campaignFlagRow({ id: 'flag-other-campaign', campaignId: 'campaign-2' }),
      ],
    });

    await suspend(db, { reason: '  Penipuan terverifikasi  ' });

    const resolved = {
      resolution: 'SUSPENDED', resolvedById: 'admin-a',
      resolutionReason: 'Penipuan terverifikasi', resolvedAt: NOW,
    };
    expect(db.campaignFlag('flag-a')).toMatchObject(resolved);
    expect(db.campaignFlag('flag-b')).toMatchObject(resolved);
    expect(db.campaignFlag('flag-dismissed')).toMatchObject({
      resolution: 'DISMISSED', resolvedById: 'admin-b', resolutionReason: 'Sudah diklarifikasi', resolvedAt: EARLIER,
    });
    expect(db.campaignFlag('flag-other-campaign').resolution).toBeNull();
  });

  it('suspends a Campaign without any Flag', async () => {
    const db = makeCampaignDb({ campaigns: [active()] });

    const result = await suspend(db);

    expect(result.campaign.lifecycleStatus).toBe('SUSPENDED');
    expect(db.campaignFlags).toEqual([]);
  });

  it('resolves Flags on an Expired or Completed Campaign it suspends', async () => {
    const db = makeCampaignDb({
      campaigns: [campaignRow({ lifecycleStatus: 'COMPLETED' })],
      campaignFlags: [campaignFlagRow()],
    });

    await suspend(db);

    expect(db.campaignFlag().resolution).toBe('SUSPENDED');
  });

  it('leaves the Flags open when the Suspension is refused', async () => {
    const db = makeCampaignDb({
      campaigns: [active({ creatorId: 'admin-a' })],
      campaignFlags: [campaignFlagRow()],
    });

    await expect(suspend(db)).rejects.toBeInstanceOf(OwnSubjectConflictError);
    expect(db.campaignFlag().resolution).toBeNull();
  });

  it('resolves a Flag raised just before, since the Flag took the row lock first', async () => {
    const db = makeCampaignDb({ campaigns: [active()] });

    await flag(db);
    await suspend(db);

    expect(db.campaignFlags).toEqual([expect.objectContaining({ resolution: 'SUSPENDED', resolvedById: 'admin-a' })]);
  });
});

describe('dismissFlag', () => {
  function dismiss(db: ReturnType<typeof makeCampaignDb>, overrides: Record<string, unknown> = {}) {
    return dismissFlag(db.prisma as never, {
      campaignId: 'campaign-1',
      flagId: 'flag-1',
      actor: adminA,
      reason: 'Foto sudah dikonfirmasi milik pasien',
      now: NOW,
      ...overrides,
    });
  }

  it('marks the Flag DISMISSED with the Admin, reason and time, leaving the Campaign and other Flags unchanged', async () => {
    const db = makeCampaignDb({
      campaigns: [active({ isUrgent: true })],
      campaignFlags: [campaignFlagRow(), campaignFlagRow({ id: 'flag-2' })],
    });

    const result = await dismiss(db, { reason: '  Foto sudah dikonfirmasi milik pasien  ' });

    expect(result.campaign).toEqual({
      id: 'campaign-1', slug: 'bantu-korban-banjir', lifecycleStatus: 'ACTIVE', isUrgent: true,
    });
    const dismissed = {
      id: 'flag-1', campaignId: 'campaign-1', verifierId: 'verifier-1',
      resolution: 'DISMISSED', resolvedById: 'admin-a',
      resolutionReason: 'Foto sudah dikonfirmasi milik pasien', resolvedAt: NOW,
    };
    expect(result.flag).toMatchObject(dismissed);
    expect(db.campaignFlag('flag-1')).toMatchObject(dismissed);
    expect(db.campaignFlag('flag-2').resolution).toBeNull();
    expect(db.campaign()).toMatchObject({ lifecycleStatus: 'ACTIVE', isUrgent: true });
    expect(db.statusChanges).toEqual([]);
    expect(db.notifications).toEqual([]);
  });

  it.each([
    ['DISMISSED', 'admin-b', 'Sudah diklarifikasi'],
    ['SUSPENDED', 'admin-b', 'Penipuan terverifikasi'],
  ] as const)('refuses a Flag already %s with FlagAlreadyResolvedError and keeps the first resolution', async (resolution, resolvedById, resolutionReason) => {
    const resolvedAt = new Date('2026-09-24T12:00:00Z');
    const db = makeCampaignDb({
      campaigns: [active()],
      campaignFlags: [campaignFlagRow({ resolution, resolvedById, resolutionReason, resolvedAt })],
    });

    const error = await dismiss(db).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(FlagAlreadyResolvedError);
    expect(domainErrorToHttp(error)?.status).toBe(409);
    expect(db.campaignFlag()).toMatchObject({ resolution, resolvedById, resolutionReason, resolvedAt });
  });

  it('refuses an unknown Flag, or a Flag of another Campaign, with FlagNotFoundError (404)', async () => {
    const db = makeCampaignDb({
      campaigns: [active(), active({ id: 'campaign-2', slug: 'lain' })],
      campaignFlags: [campaignFlagRow({ id: 'flag-other', campaignId: 'campaign-2' })],
    });

    const unknown = await dismiss(db, { flagId: 'no-such-flag' }).catch((e: unknown) => e);
    const elsewhere = await dismiss(db, { flagId: 'flag-other' }).catch((e: unknown) => e);

    expect(unknown).toBeInstanceOf(FlagNotFoundError);
    expect(elsewhere).toBeInstanceOf(FlagNotFoundError);
    expect(domainErrorToHttp(unknown)?.status).toBe(404);
    expect(db.campaignFlag('flag-other').resolution).toBeNull();
  });

  it.each([
    ['suspended', 'SUSPENDED'],
    ['expired', 'EXPIRED'],
    ['completed', 'COMPLETED'],
  ] as const)('dismisses an open Flag on a %s Campaign without changing its status', async (status, lifecycleStatus) => {
    const db = makeCampaignDb({
      campaigns: [campaignRow({ lifecycleStatus })],
      campaignFlags: [campaignFlagRow()],
    });

    const result = await dismiss(db);

    expect(result.campaign.lifecycleStatus).toBe(lifecycleStatus);
    expect(db.campaignFlag().resolution).toBe('DISMISSED');
  });
});
