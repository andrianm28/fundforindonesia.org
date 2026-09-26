import { describe, it, expect } from 'vitest';
import {
  addChecklistItem,
  ChecklistItemNotFoundError,
  editChecklistItem,
  InvalidChecklistChangeError,
  listChecklistItems,
  moveChecklistItem,
} from './verification-checklist';
import { submitCampaign } from './campaign-lifecycle';
import { campaignRow, checklistItemRow, makeCampaignDb, verificationRequestRow } from '../../tests/support/in-memory-campaign-db';

/**
 * The Admin's checklist editor (verification-request 04): items are added,
 * reworded, reordered, marked required or optional, and deactivated or
 * reactivated, never deleted, and every change leaves an audit row with the
 * actor, the time, and the item before and after. Run against the in-memory
 * Prisma stand-in: assertions are about the rows left behind.
 */
const NOW = new Date('2026-09-26T12:00:00Z');
const admin = 'admin-1';

const SEEDED = [
  checklistItemRow({ id: 'identitas-fundraiser', label: 'KTP Fundraiser', position: 1 }),
  checklistItemRow({ id: 'rencana-anggaran', label: 'Rencana anggaran', position: 2 }),
  checklistItemRow({ id: 'bukti-masalah', label: 'Bukti masalah', position: 3 }),
];

describe('addChecklistItem', () => {
  it('appends an active item after the last one and audits its creation', async () => {
    const db = makeCampaignDb({ checklistItems: SEEDED });

    const item = await addChecklistItem(db.prisma as never, {
      actorId: admin,
      label: '  Surat keterangan RT  ',
      required: false,
      now: NOW,
    });

    expect(item).toMatchObject({ label: 'Surat keterangan RT', required: false, position: 4, active: true });
    expect(db.checklistItems).toHaveLength(4);
    expect(db.checklistAudits).toEqual([
      {
        id: expect.any(String),
        itemId: item.id,
        action: 'CREATED',
        before: null,
        after: { label: 'Surat keterangan RT', required: false, position: 4, active: true },
        actedById: admin,
        actedAt: NOW,
      },
    ]);
  });
});

describe('editChecklistItem', () => {
  it('rewords an item and makes it optional, auditing the item before and after', async () => {
    const db = makeCampaignDb({ checklistItems: SEEDED });

    const item = await editChecklistItem(db.prisma as never, {
      actorId: admin,
      itemId: 'rencana-anggaran',
      changes: { label: 'Rencana anggaran rinci', required: false },
      now: NOW,
    });

    expect(item).toEqual({ id: 'rencana-anggaran', label: 'Rencana anggaran rinci', required: false, position: 2, active: true });
    expect(db.checklistAudits).toEqual([
      {
        id: expect.any(String),
        itemId: 'rencana-anggaran',
        action: 'UPDATED',
        before: { label: 'Rencana anggaran', required: true, position: 2, active: true },
        after: { label: 'Rencana anggaran rinci', required: false, position: 2, active: true },
        actedById: admin,
        actedAt: NOW,
      },
    ]);
  });

  it('deactivates and reactivates an item, keeping the row, with one audit entry each', async () => {
    const db = makeCampaignDb({ checklistItems: SEEDED });

    await editChecklistItem(db.prisma as never, { actorId: admin, itemId: 'bukti-masalah', changes: { active: false }, now: NOW });
    expect(db.checklistItems.find((i) => i.id === 'bukti-masalah')).toMatchObject({ active: false });

    await editChecklistItem(db.prisma as never, { actorId: admin, itemId: 'bukti-masalah', changes: { active: true }, now: NOW });
    expect(db.checklistItems.find((i) => i.id === 'bukti-masalah')).toMatchObject({ active: true });
    expect(db.checklistItems).toHaveLength(3);
    expect(db.checklistAudits.map((a) => [a.before, a.after].map((s) => (s as { active: boolean }).active))).toEqual([
      [true, false],
      [false, true],
    ]);
  });

  it('writes no audit entry when nothing actually changes', async () => {
    const db = makeCampaignDb({ checklistItems: SEEDED });

    await editChecklistItem(db.prisma as never, { actorId: admin, itemId: 'bukti-masalah', changes: { label: 'Bukti masalah', required: true }, now: NOW });

    expect(db.checklistAudits).toEqual([]);
  });

  it('refuses an unknown item', async () => {
    const db = makeCampaignDb({ checklistItems: SEEDED });

    await expect(
      editChecklistItem(db.prisma as never, { actorId: admin, itemId: 'nope', changes: { active: false }, now: NOW }),
    ).rejects.toBeInstanceOf(ChecklistItemNotFoundError);
  });

  it.each([
    ['a blank label', { label: '   ' }],
    ['a non-boolean required', { required: 'ya' }],
    ['a non-boolean active', { active: 1 }],
    ['no change at all', {}],
  ])('refuses %s, writing nothing', async (_name, changes) => {
    const db = makeCampaignDb({ checklistItems: SEEDED });

    await expect(
      editChecklistItem(db.prisma as never, { actorId: admin, itemId: 'bukti-masalah', changes, now: NOW }),
    ).rejects.toBeInstanceOf(InvalidChecklistChangeError);
    expect(db.checklistItems).toEqual(SEEDED);
    expect(db.checklistAudits).toEqual([]);
  });
});

describe('adding and moving lock the whole checklist', () => {
  // Both compute positions from every item. A row lock would lock nothing on
  // an empty checklist, letting two Admins adding the first item both take
  // position 1, so the lock is on the table.
  it.each([
    ['adding', (prisma: never) => addChecklistItem(prisma, { actorId: admin, label: 'Baru', required: true })],
    ['moving', (prisma: never) => moveChecklistItem(prisma, { actorId: admin, itemId: 'bukti-masalah', direction: 'up' })],
  ])('%s takes the table lock', async (_name, command) => {
    const db = makeCampaignDb({ checklistItems: SEEDED });

    await command(db.prisma as never);

    expect(db.rowLocks).toEqual(['VerificationChecklistItem:*']);
  });
});

describe('moveChecklistItem', () => {
  it('swaps an item with its neighbour, auditing both position changes', async () => {
    const db = makeCampaignDb({ checklistItems: SEEDED });

    await moveChecklistItem(db.prisma as never, { actorId: admin, itemId: 'bukti-masalah', direction: 'up', now: NOW });

    expect((await listChecklistItems(db.prisma as never)).map((i) => i.id)).toEqual([
      'identitas-fundraiser',
      'bukti-masalah',
      'rencana-anggaran',
    ]);
    expect(db.checklistAudits.map((a) => ({ itemId: a.itemId, action: a.action, before: a.before, after: a.after }))).toEqual([
      {
        itemId: 'bukti-masalah',
        action: 'UPDATED',
        before: { label: 'Bukti masalah', required: true, position: 3, active: true },
        after: { label: 'Bukti masalah', required: true, position: 2, active: true },
      },
      {
        itemId: 'rencana-anggaran',
        action: 'UPDATED',
        before: { label: 'Rencana anggaran', required: true, position: 2, active: true },
        after: { label: 'Rencana anggaran', required: true, position: 3, active: true },
      },
    ]);
  });

  it('moves past an inactive neighbour, since the editor lists inactive items in place too', async () => {
    const db = makeCampaignDb({
      checklistItems: [
        checklistItemRow({ id: 'a', position: 1 }),
        checklistItemRow({ id: 'b', position: 2, active: false }),
      ],
    });

    await moveChecklistItem(db.prisma as never, { actorId: admin, itemId: 'a', direction: 'down', now: NOW });

    expect((await listChecklistItems(db.prisma as never)).map((i) => i.id)).toEqual(['b', 'a']);
  });

  it.each([
    ['the first item up', 'identitas-fundraiser', 'up'],
    ['the last item down', 'bukti-masalah', 'down'],
  ] as const)('leaves the order alone moving %s, writing no audit entry', async (_name, itemId, direction) => {
    const db = makeCampaignDb({ checklistItems: SEEDED });

    await moveChecklistItem(db.prisma as never, { actorId: admin, itemId, direction, now: NOW });

    expect(db.checklistItems).toEqual(SEEDED);
    expect(db.checklistAudits).toEqual([]);
  });

  it('refuses an unknown item and an unknown direction', async () => {
    const db = makeCampaignDb({ checklistItems: SEEDED });

    await expect(
      moveChecklistItem(db.prisma as never, { actorId: admin, itemId: 'nope', direction: 'up', now: NOW }),
    ).rejects.toBeInstanceOf(ChecklistItemNotFoundError);
    await expect(
      moveChecklistItem(db.prisma as never, { actorId: admin, itemId: 'bukti-masalah', direction: 'sideways', now: NOW }),
    ).rejects.toBeInstanceOf(InvalidChecklistChangeError);
  });
});

describe('existing Verification Requests keep their snapshot', () => {
  it('survives rewording, reordering, making optional, deactivating and adding, whatever the outcome of the request; only the next request sees the edits', async () => {
    const db = makeCampaignDb({
      campaigns: [
        campaignRow({ id: 'campaign-1', slug: 'satu', lifecycleStatus: 'DRAFT' }),
        campaignRow({ id: 'campaign-2', slug: 'dua', lifecycleStatus: 'DRAFT' }),
      ],
      checklistItems: SEEDED,
    });
    const fundraiser = { userId: 'creator-1', assignments: [] };
    await submitCampaign(db.prisma as never, { campaignId: 'campaign-1', actor: fundraiser, now: NOW });
    const snapshotAtSubmission = [
      { id: 'identitas-fundraiser', label: 'KTP Fundraiser', required: true, position: 1, ticked: false },
      { id: 'rencana-anggaran', label: 'Rencana anggaran', required: true, position: 2, ticked: false },
      { id: 'bukti-masalah', label: 'Bukti masalah', required: true, position: 3, ticked: false },
    ];
    expect(db.verificationRequests[0].checklist).toEqual(snapshotAtSubmission);
    // Requests in every other state, ticked by a Verifier, snapshotted from an older checklist.
    const decidedChecklist = [
      { id: 'rencana-anggaran', label: 'Rencana anggaran (lama)', required: true, position: 1, ticked: true },
      { id: 'bukti-masalah', label: 'Bukti masalah', required: false, position: 2, ticked: false },
    ];
    db.verificationRequests.push(
      verificationRequestRow({ id: 'rejected', campaignId: 'campaign-2', outcome: 'REJECTED', reason: 'Kurang RAB.', checklist: structuredClone(decidedChecklist) }),
      verificationRequestRow({ id: 'withdrawn', campaignId: 'campaign-2', outcome: 'WITHDRAWN', checklist: structuredClone(decidedChecklist) }),
    );
    const before = structuredClone(db.verificationRequests);

    const prisma = db.prisma as never;
    await editChecklistItem(prisma, { actorId: admin, itemId: 'rencana-anggaran', changes: { label: 'RAB rinci', required: false } });
    await editChecklistItem(prisma, { actorId: admin, itemId: 'identitas-fundraiser', changes: { active: false } });
    await moveChecklistItem(prisma, { actorId: admin, itemId: 'bukti-masalah', direction: 'up' });
    await addChecklistItem(prisma, { actorId: admin, label: 'Surat keterangan RT', required: true });

    expect(db.verificationRequests[0].checklist).toEqual(snapshotAtSubmission);
    expect(db.verificationRequests).toEqual(before);

    await submitCampaign(db.prisma as never, { campaignId: 'campaign-2', actor: fundraiser, now: NOW });
    expect(db.verificationRequests[3].checklist).toEqual([
      { id: 'bukti-masalah', label: 'Bukti masalah', required: true, position: 2, ticked: false },
      { id: 'rencana-anggaran', label: 'RAB rinci', required: false, position: 3, ticked: false },
      { id: expect.any(String), label: 'Surat keterangan RT', required: true, position: 4, ticked: false },
    ]);
  });
});
