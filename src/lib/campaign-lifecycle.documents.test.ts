import { describe, it, expect } from 'vitest';
import { ChecklistDocumentMissingError, decideVerificationRequest, domainErrorToHttp, submitCampaign } from './campaign-lifecycle';
import {
  campaignRow,
  checklistItemRow,
  documentRow,
  makeCampaignDb,
  verificationRequestRow,
} from '../../tests/support/in-memory-campaign-db';

/**
 * Ticket 64: a checklist item that needs a paper cannot be ticked until the
 * Fundraiser has uploaded one for it. The screen disables the box; this is
 * the server refusing the tick anyway, on either decision, so the tick always
 * means somebody looked at a document.
 */
const NOW = new Date('2026-10-29T10:00:00Z');
const verifier = { userId: 'verifier-1', assignments: ['VERIFIER' as const] };

const CHECKLIST = [
  { id: 'ktp', label: 'KTP Fundraiser', required: true, position: 1, ticked: false, requiresDocument: true },
  { id: 'bukan-duplikat', label: 'Bukan duplikat', required: true, position: 2, ticked: false, requiresDocument: false },
];

function seeded(overrides: Parameters<typeof makeCampaignDb>[0] = {}) {
  return makeCampaignDb({
    campaigns: [campaignRow()],
    verificationRequests: [verificationRequestRow({ id: 'open', checklist: CHECKLIST })],
    ...overrides,
  });
}

const decide = (db: ReturnType<typeof seeded>, decision: 'approve' | 'reject', ticked: string[]) =>
  decideVerificationRequest(db.prisma as never, {
    campaignId: 'campaign-1',
    requestId: 'open',
    actor: verifier,
    decision,
    ticked,
    reason: decision === 'reject' ? 'Dokumen kurang jelas.' : undefined,
    now: NOW,
  });

describe('ticking a document item (ticket 64)', () => {
  it('refuses to approve with a document item ticked and no document behind it, changing nothing', async () => {
    const db = seeded();

    const refusal = await decide(db, 'approve', ['ktp', 'bukan-duplikat']).catch((e) => e);

    expect(refusal).toBeInstanceOf(ChecklistDocumentMissingError);
    expect(refusal.labels).toEqual(['KTP Fundraiser']);
    expect(domainErrorToHttp(refusal)).toMatchObject({ status: 422, body: { code: 'CHECKLIST_DOCUMENT_MISSING' } });
    expect(db.campaign().lifecycleStatus).toBe('SUBMITTED');
    expect(db.verificationRequests[0].outcome).toBe('PENDING');
  });

  it('refuses the same tick on a rejection: a tick says the paper was looked at', async () => {
    const db = seeded();

    await expect(decide(db, 'reject', ['ktp'])).rejects.toBeInstanceOf(ChecklistDocumentMissingError);
    expect(db.verificationRequests[0].outcome).toBe('PENDING');
  });

  it('approves once the Campaign holds a document for the item', async () => {
    const db = seeded({ documents: [documentRow({ checklistItemId: 'ktp' })] });

    const result = await decide(db, 'approve', ['ktp', 'bukan-duplikat']);

    expect(result.campaign.lifecycleStatus).toBe('ACTIVE');
  });

  it("does not count another Campaign's document", async () => {
    const db = seeded({ documents: [documentRow({ campaignId: 'campaign-2', checklistItemId: 'ktp' })] });

    await expect(decide(db, 'approve', ['ktp', 'bukan-duplikat'])).rejects.toBeInstanceOf(ChecklistDocumentMissingError);
  });

  it('lets a rejection leave the document item unticked', async () => {
    const db = seeded();

    const result = await decide(db, 'reject', ['bukan-duplikat']);

    expect(result.campaign.lifecycleStatus).toBe('REJECTED');
  });

  it("judges a snapshot taken before ticket 64 by the item's current setting", async () => {
    const legacy = CHECKLIST.map((entry) => {
      const copy: Partial<(typeof CHECKLIST)[number]> = { ...entry };
      delete copy.requiresDocument;
      return copy;
    });
    const db = makeCampaignDb({
      campaigns: [campaignRow()],
      checklistItems: [checklistItemRow({ id: 'ktp', requiresDocument: true }), checklistItemRow({ id: 'bukan-duplikat' })],
      verificationRequests: [verificationRequestRow({ id: 'open', checklist: legacy })],
    });

    await expect(decide(db, 'approve', ['ktp', 'bukan-duplikat'])).rejects.toBeInstanceOf(ChecklistDocumentMissingError);
    await expect(decide(db, 'reject', ['bukan-duplikat'])).resolves.toBeTruthy();
  });

  it('snapshots whether each item needs a document at submission', async () => {
    const db = makeCampaignDb({
      campaigns: [campaignRow({ lifecycleStatus: 'DRAFT', deadline: new Date('2026-12-31T00:00:00Z') })],
      checklistItems: [checklistItemRow({ id: 'ktp', label: 'KTP', requiresDocument: true })],
    });

    await submitCampaign(db.prisma as never, { campaignId: 'campaign-1', actor: { userId: 'creator-1', assignments: [] }, now: NOW });

    expect(db.verificationRequests[0].checklist).toEqual([
      { id: 'ktp', label: 'KTP', required: true, position: 1, ticked: false, requiresDocument: true },
    ]);
  });
});
