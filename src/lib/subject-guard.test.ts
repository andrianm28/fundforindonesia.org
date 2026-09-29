import { describe, it, expect } from 'vitest';
import { CampaignStatus, StatusChangeCapacity, VolunteerTripStatus, type Kind } from '@/generated/prisma/client';
import {
  lockAndLoad,
  requireActiveContentFieldsEditable,
  requireNotOwnerAsAdmin,
  requirePayoutAllowed,
  isEscrowReleaseFrozen,
  ActiveContentFrozenError,
  PayoutNotAllowedForStatusError,
  type SubjectState,
} from './subject-guard';
import { domainErrorToHttp } from './campaign-lifecycle';
import { OwnSubjectConflictError } from './capacity';

const NOW = new Date('2026-09-25T10:00:00Z');
const PAST = new Date('2026-09-20T00:00:00Z');
const FUTURE = new Date('2026-10-20T00:00:00Z');

type CampaignRow = { id: string; creatorId: string; isDemo: boolean; lifecycleStatus: CampaignStatus; deadline: Date | null; kind: Kind; collectingEntityId: string | null };
type TripRow = { id: string; fundraiserId: string; status: VolunteerTripStatus };

/**
 * A transaction that records, in order, every row lock and every subject
 * read, so a test can see that the lock comes first. Reads honour `select`
 * the way Prisma does.
 */
function makeTx(seed: { campaigns?: CampaignRow[]; trips?: TripRow[] } = {}) {
  const events: string[] = [];
  const pick = (row: Record<string, unknown> | undefined, select?: Record<string, boolean>) => {
    if (!row) return null;
    if (!select) return { ...row };
    return Object.fromEntries(Object.keys(select).filter((k) => select[k]).map((k) => [k, row[k]]));
  };
  const tx = {
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const table = /FROM "(\w+)" WHERE id = \$?\s*FOR UPDATE/.exec(strings.join(''))?.[1];
      events.push(`lock ${table}:${String(values[0])}`);
      return [{ id: values[0] }];
    },
    campaign: {
      findUnique: async ({ where, select }: { where: { id: string }; select?: Record<string, boolean> }) => {
        events.push(`read Campaign:${where.id}`);
        return pick(seed.campaigns?.find((c) => c.id === where.id), select);
      },
    },
    volunteerTrip: {
      findUnique: async ({ where, select }: { where: { id: string }; select?: Record<string, boolean> }) => {
        events.push(`read VolunteerTrip:${where.id}`);
        return pick(seed.trips?.find((t) => t.id === where.id), select);
      },
    },
  };
  return { tx, events };
}

const campaign = (overrides: Partial<CampaignRow> = {}): CampaignRow => ({
  id: 'campaign-1',
  creatorId: 'fundraiser-1',
  isDemo: false,
  lifecycleStatus: CampaignStatus.ACTIVE,
  deadline: FUTURE,
  kind: 'ZAKAT',
  collectingEntityId: 'partner-1',
  ...overrides,
});

const trip = (overrides: Partial<TripRow> = {}): TripRow => ({
  id: 'trip-1',
  fundraiserId: 'trip-fundraiser-1',
  status: VolunteerTripStatus.ACTIVE,
  ...overrides,
});

describe('lockAndLoad', () => {
  it('locks the Campaign row, then reads its owner, demo flag, effective status, Kind and deadline', async () => {
    const { tx, events } = makeTx({ campaigns: [campaign({ isDemo: true })] });

    const state = await lockAndLoad(tx as never, { type: 'campaign', campaignId: 'campaign-1' }, NOW);

    expect(state).toEqual({
      kind: 'campaign',
      id: 'campaign-1',
      ownerId: 'fundraiser-1',
      isDemo: true,
      effectiveStatus: CampaignStatus.ACTIVE,
      campaignKind: 'ZAKAT',
      deadline: FUTURE,
      collectingEntityId: 'partner-1',
    });
    expect(events).toEqual(['lock Campaign:campaign-1', 'read Campaign:campaign-1']);
  });

  it('reports an Active Campaign past its deadline as Expired, before anyone has recorded it', async () => {
    const { tx } = makeTx({ campaigns: [campaign({ deadline: PAST })] });

    const state = await lockAndLoad(tx as never, { type: 'campaign', campaignId: 'campaign-1' }, NOW);

    expect(state?.effectiveStatus).toBe(CampaignStatus.EXPIRED);
  });

  it('takes any other stored Campaign status as it is', async () => {
    const { tx } = makeTx({ campaigns: [campaign({ lifecycleStatus: CampaignStatus.SUSPENDED, deadline: PAST })] });

    const state = await lockAndLoad(tx as never, { type: 'campaign', campaignId: 'campaign-1' }, NOW);

    expect(state?.effectiveStatus).toBe(CampaignStatus.SUSPENDED);
  });

  it('locks the Volunteer Trip row, then reads it: the Fundraiser is the owner, never a demo, its own status', async () => {
    const { tx, events } = makeTx({ trips: [trip({ status: VolunteerTripStatus.COMPLETED })] });

    const state = await lockAndLoad(tx as never, { type: 'trip', tripId: 'trip-1' }, NOW);

    expect(state).toEqual({
      kind: 'trip',
      id: 'trip-1',
      ownerId: 'trip-fundraiser-1',
      isDemo: false,
      effectiveStatus: VolunteerTripStatus.COMPLETED,
    });
    expect(events).toEqual(['lock VolunteerTrip:trip-1', 'read VolunteerTrip:trip-1']);
  });

  it('returns null for a Campaign or Trip that does not exist, after taking the lock', async () => {
    const { tx, events } = makeTx();

    expect(await lockAndLoad(tx as never, { type: 'campaign', campaignId: 'missing' }, NOW)).toBeNull();
    expect(await lockAndLoad(tx as never, { type: 'trip', tripId: 'missing' }, NOW)).toBeNull();
    expect(events).toEqual([
      'lock Campaign:missing',
      'read Campaign:missing',
      'lock VolunteerTrip:missing',
      'read VolunteerTrip:missing',
    ]);
  });
});

const campaignState = (effectiveStatus: CampaignStatus, ownerId = 'fundraiser-1'): SubjectState => ({
  kind: 'campaign',
  id: 'campaign-1',
  ownerId,
  isDemo: false,
  effectiveStatus,
  campaignKind: 'DONATION',
  deadline: null,
  collectingEntityId: null,
});

const tripState = (effectiveStatus: VolunteerTripStatus, ownerId = 'trip-fundraiser-1'): SubjectState => ({
  kind: 'trip',
  id: 'trip-1',
  ownerId,
  isDemo: false,
  effectiveStatus,
});

describe('requirePayoutAllowed', () => {
  const allowed = [CampaignStatus.ACTIVE, CampaignStatus.EXPIRED, CampaignStatus.COMPLETED];
  const refused = Object.values(CampaignStatus).filter((s) => !allowed.includes(s as never));

  it.each(allowed)('lets a %s Campaign pay out', (status) => {
    expect(() => requirePayoutAllowed(campaignState(status))).not.toThrow();
  });

  it.each(refused)('refuses a %s Campaign with a coded, Indonesian 409', (status) => {
    let caught: unknown;
    try {
      requirePayoutAllowed(campaignState(status));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(PayoutNotAllowedForStatusError);
    expect(domainErrorToHttp(caught)).toEqual({
      status: 409,
      body: { code: 'PAYOUT_NOT_ALLOWED_FOR_STATUS', error: expect.stringMatching(/Payout tidak dapat/) },
    });
  });

  const tripPasses = Object.values(VolunteerTripStatus).filter((s) => s !== VolunteerTripStatus.SUSPENDED);

  it.each(tripPasses)('leaves a %s Volunteer Trip to the rule it has today: no status check', (status) => {
    expect(() => requirePayoutAllowed(tripState(status))).not.toThrow();
  });

  it('refuses a SUSPENDED Volunteer Trip with the same coded, Indonesian 409 as a Suspended Campaign', () => {
    let caught: unknown;
    try {
      requirePayoutAllowed(tripState(VolunteerTripStatus.SUSPENDED));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(PayoutNotAllowedForStatusError);
    expect(domainErrorToHttp(caught)).toEqual({
      status: 409,
      body: { code: 'PAYOUT_NOT_ALLOWED_FOR_STATUS', error: expect.stringMatching(/Payout tidak dapat/) },
    });
  });
});

describe('requireActiveContentFieldsEditable', () => {
  it.each(['title', 'description'])('refuses a %s edit on an Active Campaign, coded and Indonesian', (field) => {
    let caught: unknown;
    try {
      requireActiveContentFieldsEditable(campaignState(CampaignStatus.ACTIVE), { [field]: 'apa saja' });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ActiveContentFrozenError);
    expect(domainErrorToHttp(caught)).toEqual({
      status: 409,
      body: { code: 'ACTIVE_CONTENT_FROZEN', error: expect.stringMatching(/Judul dan deskripsi/) },
    });
  });

  it('passes an Active Campaign edit that touches neither field', () => {
    expect(() =>
      requireActiveContentFieldsEditable(campaignState(CampaignStatus.ACTIVE), { story: '<p>Baru</p>' }),
    ).not.toThrow();
  });

  it.each(Object.values(CampaignStatus).filter((s) => s !== CampaignStatus.ACTIVE))(
    'passes a title and description edit on a %s Campaign -- requireContentEditable judges other statuses',
    (status) => {
      expect(() =>
        requireActiveContentFieldsEditable(campaignState(status), { title: 't', description: 'd' }),
      ).not.toThrow();
    },
  );

  it('leaves a Volunteer Trip untouched: it has no title/description freeze', () => {
    expect(() =>
      requireActiveContentFieldsEditable(tripState(VolunteerTripStatus.ACTIVE), { title: 't' }),
    ).not.toThrow();
  });
});

describe('isEscrowReleaseFrozen', () => {
  it('holds a Suspended Campaign\'s matured money in Escrow Hold', () => {
    expect(isEscrowReleaseFrozen(campaignState(CampaignStatus.SUSPENDED))).toBe(true);
  });

  it.each(Object.values(CampaignStatus).filter((s) => s !== CampaignStatus.SUSPENDED))(
    'releases as today for a %s Campaign',
    (status) => {
      expect(isEscrowReleaseFrozen(campaignState(status))).toBe(false);
    },
  );

  it.each(Object.values(VolunteerTripStatus))('releases as today for a %s Volunteer Trip', (status) => {
    expect(isEscrowReleaseFrozen(tripState(status))).toBe(false);
  });
});

describe('requireNotOwnerAsAdmin', () => {
  it('refuses an Admin on their own Campaign with the own-Campaign conflict', () => {
    expect(() => requireNotOwnerAsAdmin(campaignState(CampaignStatus.ACTIVE, 'admin-1'), 'admin-1')).toThrow(
      new OwnSubjectConflictError('campaign', StatusChangeCapacity.ADMIN),
    );
    expect(() => requireNotOwnerAsAdmin(campaignState(CampaignStatus.ACTIVE, 'admin-1'), 'admin-1')).toThrow(
      expect.objectContaining({ code: 'OWN_CAMPAIGN_CONFLICT' }),
    );
  });

  it('refuses an Admin on their own Volunteer Trip with the own-Trip conflict', () => {
    expect(() => requireNotOwnerAsAdmin(tripState(VolunteerTripStatus.ACTIVE, 'admin-1'), 'admin-1')).toThrow(
      new OwnSubjectConflictError('trip', StatusChangeCapacity.ADMIN),
    );
    expect(() => requireNotOwnerAsAdmin(tripState(VolunteerTripStatus.ACTIVE, 'admin-1'), 'admin-1')).toThrow(
      expect.objectContaining({ code: 'OWN_TRIP_CONFLICT' }),
    );
  });

  it('lets an Admin act on a Campaign or Trip someone else owns', () => {
    expect(() => requireNotOwnerAsAdmin(campaignState(CampaignStatus.ACTIVE), 'admin-1')).not.toThrow();
    expect(() => requireNotOwnerAsAdmin(tripState(VolunteerTripStatus.ACTIVE), 'admin-1')).not.toThrow();
  });
});
