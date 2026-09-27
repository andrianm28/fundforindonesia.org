import { describe, it, expect } from 'vitest';
import {
  decideVerificationRequest,
  domainErrorToHttp,
  TooManyActiveCampaignsError,
} from './campaign-lifecycle';
import {
  campaignRow,
  checklistItemRow,
  makeCampaignDb,
  verificationRequestRow,
} from '../../tests/support/in-memory-campaign-db';

/**
 * A Fundraiser may run three Active Campaigns before their first Usage Report
 * (prd-compliance 38, PRD §"Anti penyalahgunaan": "batas tiga Campaign Active
 * sebelum Usage Report pertama"). The only point in the lifecycle where that
 * can be enforced without stranding anybody is the approval that would make
 * the Campaign Active: a fourth simultaneous appeal is refused, while every
 * Campaign already collecting keeps collecting untouched.
 */
const NOW = new Date('2026-09-28T06:00:00Z');
const FUTURE = new Date('2026-12-31T00:00:00Z');
const PAST = new Date('2026-09-01T00:00:00Z');

const verifier = { userId: 'verifier-1', assignments: ['VERIFIER' as const] };
const CHECKLIST = [checklistItemRow({ id: 'rencana-anggaran', label: 'Rencana anggaran', position: 1 })];

function submittedDb(
  others: { id: string; lifecycleStatus?: 'ACTIVE' | 'EXPIRED' | 'COMPLETED'; deadline?: Date | null; creatorId?: string; isDemo?: boolean }[] = [],
  abuseThresholds?: { kind: string; value: number; setAt: string }[]
) {
  return makeCampaignDb({
    campaigns: [
      campaignRow({ lifecycleStatus: 'SUBMITTED', deadline: FUTURE, targetAmount: 50_000_000 }),
      ...others.map((other) =>
        campaignRow({
          id: other.id,
          creatorId: other.creatorId ?? 'creator-1',
          lifecycleStatus: other.lifecycleStatus ?? 'ACTIVE',
          deadline: other.deadline === undefined ? FUTURE : other.deadline,
          isDemo: other.isDemo ?? false,
        })
      ),
    ],
    checklistItems: CHECKLIST,
    verificationRequests: [
      verificationRequestRow({
        id: 'request-1',
        kind: 'SUBMISSION',
        checklist: [{ id: 'rencana-anggaran', label: 'Rencana anggaran', required: true, position: 1, ticked: false }],
      }),
    ],
    abuseThresholds,
  });
}

function approve(db: ReturnType<typeof submittedDb>) {
  return decideVerificationRequest(db.prisma as never, {
    campaignId: 'campaign-1',
    requestId: 'request-1',
    actor: verifier,
    decision: 'approve',
    ticked: ['rencana-anggaran'],
    now: NOW,
  });
}

describe('the Active Campaign limit on approving a submission', () => {
  it('lets a Fundraiser who runs two Active Campaigns open a third', async () => {
    const db = submittedDb([{ id: 'campaign-2' }, { id: 'campaign-3' }]);

    await approve(db);

    expect(db.campaign('campaign-1').lifecycleStatus).toBe('ACTIVE');
  });

  it('refuses the fourth Active Campaign, leaving the request undecided and the Campaign Submitted', async () => {
    const db = submittedDb([{ id: 'campaign-2' }, { id: 'campaign-3' }, { id: 'campaign-4' }]);

    const error = await approve(db).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(TooManyActiveCampaignsError);
    expect(domainErrorToHttp(error)).toMatchObject({ status: 409, body: { code: 'TOO_MANY_ACTIVE_CAMPAIGNS' } });
    expect(db.campaign('campaign-1').lifecycleStatus).toBe('SUBMITTED');
    expect(db.verificationRequests[0].outcome).toBe('PENDING');
    expect(db.statusChanges).toEqual([]);
  });

  it('counts a Campaign whose deadline has passed as no longer Active', async () => {
    const db = submittedDb([
      { id: 'campaign-2' },
      { id: 'campaign-3' },
      { id: 'campaign-4', deadline: PAST },
    ]);

    await approve(db);

    expect(db.campaign('campaign-1').lifecycleStatus).toBe('ACTIVE');
  });

  it('counts only this Fundraiser\'s own Campaigns', async () => {
    const db = submittedDb([
      { id: 'campaign-2' },
      { id: 'campaign-3' },
      { id: 'campaign-4', creatorId: 'creator-2' },
    ]);

    await approve(db);

    expect(db.campaign('campaign-1').lifecycleStatus).toBe('ACTIVE');
  });

  it('counts no Demo Campaign, whose collected figure is fiction', async () => {
    const db = submittedDb([
      { id: 'campaign-2' },
      { id: 'campaign-3' },
      { id: 'campaign-4', isDemo: true },
    ]);

    await approve(db);

    expect(db.campaign('campaign-1').lifecycleStatus).toBe('ACTIVE');
  });

  it('counts a Completed Campaign as no longer Active', async () => {
    const db = submittedDb([
      { id: 'campaign-2' },
      { id: 'campaign-3' },
      { id: 'campaign-4', lifecycleStatus: 'COMPLETED' },
    ]);

    await approve(db);

    expect(db.campaign('campaign-1').lifecycleStatus).toBe('ACTIVE');
  });

  it('takes the limit an Admin has set, not the PRD three', async () => {
    const db = submittedDb(
      [{ id: 'campaign-2' }, { id: 'campaign-3' }, { id: 'campaign-4' }],
      [{ kind: 'ACTIVE_CAMPAIGNS_PER_FUNDRAISER', value: 5, setAt: '2026-09-20T00:00:00Z' }]
    );

    await approve(db);

    expect(db.campaign('campaign-1').lifecycleStatus).toBe('ACTIVE');
  });
});
