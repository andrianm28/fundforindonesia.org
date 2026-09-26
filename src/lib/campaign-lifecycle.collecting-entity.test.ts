import { describe, it, expect } from 'vitest';
import {
  assignCollectingEntity,
  CollectingEntityAlreadySetError,
  CollectingEntityNotEligibleError,
  domainErrorToHttp,
  InvalidTransitionError,
  LifecycleValidationError,
  NotAuthorizedError,
  OwnSubjectConflictError,
} from './campaign-lifecycle';
import {
  campaignRow,
  makeCampaignDb,
  partnerOrganisationRow,
} from '../../tests/support/in-memory-campaign-db';

/**
 * An Active Campaign without a Collecting Entity refuses Donations until an
 * Admin or Verifier assigns one (prd-compliance 10). Assigning is recorded in
 * the Campaign's status log like Urgent (no status moves), with a reason, in
 * the Capacity the person acts in, and the Fundraiser is told.
 */
const NOW = new Date('2026-09-26T10:00:00Z');
const verifier = { userId: 'verifier-1', assignments: ['VERIFIER' as const] };
const admin = { userId: 'admin-1', assignments: ['ADMIN' as const] };
const REASON = 'Campaign lama sebelum Collecting Entity dicatat; dihimpun Yayasan Contoh Peduli.';

function legacyActive(overrides: Parameters<typeof campaignRow>[0] = {}) {
  return makeCampaignDb({
    campaigns: [campaignRow({ lifecycleStatus: 'ACTIVE', collectingEntityId: null, ...overrides })],
  });
}

const assign = (db: ReturnType<typeof makeCampaignDb>, params: Record<string, unknown> = {}) =>
  assignCollectingEntity(db.prisma as never, {
    campaignId: 'campaign-1',
    actor: verifier,
    collectingEntityId: 'partner-1',
    reason: REASON,
    now: NOW,
    ...params,
  });

describe('assignCollectingEntity', () => {
  it.each([
    ['a Verifier', verifier, 'VERIFIER'],
    ['an Admin', admin, 'ADMIN'],
  ])('lets %s name the Collecting Entity of an Active Campaign that has none, logged and told', async (_who, actor, capacity) => {
    const db = legacyActive();

    const result = await assign(db, { actor });

    expect(result.campaign.lifecycleStatus).toBe('ACTIVE');
    expect(db.campaign()).toMatchObject({ lifecycleStatus: 'ACTIVE', collectingEntityId: 'partner-1' });
    expect(db.statusChanges).toEqual([
      expect.objectContaining({
        action: 'COLLECTING_ENTITY_ASSIGNED',
        fromStatus: null,
        toStatus: null,
        actorId: actor.userId,
        capacity,
        reason: REASON,
        createdAt: NOW,
      }),
    ]);
    expect(db.notifications).toEqual([
      expect.objectContaining({ userId: 'creator-1', link: '/campaign/bantu-korban-banjir' }),
    ]);
  });

  it('refuses a Campaign that already names one with 409, changing nothing', async () => {
    const db = legacyActive({ collectingEntityId: 'partner-1' });

    const error = await assign(db).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(CollectingEntityAlreadySetError);
    expect(domainErrorToHttp(error)?.status).toBe(409);
    expect(db.statusChanges).toEqual([]);
  });

  it.each(['DRAFT', 'SUBMITTED', 'SUSPENDED', 'COMPLETED'] as const)('refuses a %s Campaign with 409', async (lifecycleStatus) => {
    const db = legacyActive({ lifecycleStatus });

    const error = await assign(db).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(InvalidTransitionError);
    expect(db.campaign().collectingEntityId).toBeNull();
  });

  it('refuses an organisation that does not accept individual Campaigns for an individual Fundraiser', async () => {
    const db = makeCampaignDb({
      campaigns: [campaignRow({ lifecycleStatus: 'ACTIVE', collectingEntityId: null })],
      partnerOrganisations: [partnerOrganisationRow({ acceptsIndividualCampaigns: false })],
    });

    const error = await assign(db).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(CollectingEntityNotEligibleError);
    expect(db.campaign().collectingEntityId).toBeNull();
  });

  it('refuses an id that names no Partner Organisation, so nothing else can ever collect', async () => {
    const db = legacyActive();

    const error = await assign(db, { collectingEntityId: 'pt-jaya-korpora-prima' }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(CollectingEntityNotEligibleError);
    expect(db.campaign().collectingEntityId).toBeNull();
  });

  it.each([
    ['no reason', { reason: '  ' }, 'reason'],
    ['no Collecting Entity', { collectingEntityId: '' }, 'collectingEntityId'],
  ])('refuses %s with 400 before reading anything', async (_what, params, field) => {
    const db = legacyActive();

    const error = await assign(db, params).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(LifecycleValidationError);
    expect((error as LifecycleValidationError).field).toBe(field);
    expect(db.rowLocks).toEqual([]);
  });

  it('refuses someone who is neither Admin nor Verifier with 403', async () => {
    const db = legacyActive();

    const error = await assign(db, { actor: { userId: 'creator-1', assignments: [] } }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(NotAuthorizedError);
    expect(db.campaign().collectingEntityId).toBeNull();
  });

  it('refuses a Verifier acting on their own Campaign', async () => {
    const db = legacyActive({ creatorId: 'verifier-1' });

    const error = await assign(db).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(OwnSubjectConflictError);
  });
});
