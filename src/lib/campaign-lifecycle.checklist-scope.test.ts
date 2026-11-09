import { describe, it, expect } from 'vitest';
import {
  decideVerificationRequest,
  raiseAmountReviewVerificationRequest,
  requestCampaignChange,
  submitCampaign,
} from './campaign-lifecycle';
import {
  campaignRow,
  checklistItemRow,
  makeCampaignDb,
} from '../../tests/support/in-memory-campaign-db';

/**
 * Which checklist items a Verification Request snapshots (PKS pemenuhan 08):
 * the five items about the Fundraiser's own papers are SUBMISSION-only, so a
 * live Campaign approved before they existed can still have its CHANGE or
 * AMOUNT_REVIEW approved, and an item scoped to an individual or an
 * organisation reaches only that Fundraiser. Run against the in-memory Prisma
 * stand-in, with rows shaped like the migration's seed.
 */
const NOW = new Date('2026-11-12T10:00:00Z');
const DEADLINE = new Date('2027-03-31T00:00:00Z');
const verifier = { userId: 'verifier-1', assignments: ['VERIFIER' as const] };
const individual = { userId: 'creator-1', assignments: [] };
const organisation = { userId: 'partner-fundraiser-1', assignments: [] };

const SEEDED = [
  checklistItemRow({ id: 'rencana-anggaran', label: 'Rencana anggaran', position: 1 }),
  ...[
    ['foto-diri-memegang-ktp', 'Foto diri memegang KTP', true, 'INDIVIDUAL'],
    ['bukti-alamat', 'Bukti alamat penggalang dana', true, null],
    ['bukti-hubungan-penerima-manfaat', 'Bukti hubungan dengan penerima manfaat', true, null],
    ['surat-kuasa-lembaga', 'Surat kuasa (lembaga, bila diperlukan)', false, 'ORGANISATION'],
    ['dokumen-pendukung-program', 'Dokumen pendukung program', true, null],
  ].map(([id, label, required, applicant], i) =>
    checklistItemRow({
      id: id as string,
      label: label as string,
      required: required as boolean,
      position: 2 + i,
      requiresDocument: true,
      requestKinds: ['SUBMISSION'],
      applicant: applicant as 'INDIVIDUAL' | 'ORGANISATION' | null,
    }),
  ),
];

const ids = (checklist: unknown) => (checklist as { id: string }[]).map((entry) => entry.id);

describe('a new SUBMISSION snapshots the items for its Fundraiser', () => {
  it('gives an individual the KTP photo and the general papers, not the surat kuasa', async () => {
    const db = makeCampaignDb({
      campaigns: [campaignRow({ lifecycleStatus: 'DRAFT', deadline: DEADLINE })],
      checklistItems: SEEDED,
    });

    await submitCampaign(db.prisma as never, { campaignId: 'campaign-1', actor: individual, now: NOW });

    expect(ids(db.verificationRequests[0].checklist)).toEqual([
      'rencana-anggaran',
      'foto-diri-memegang-ktp',
      'bukti-alamat',
      'bukti-hubungan-penerima-manfaat',
      'dokumen-pendukung-program',
    ]);
  });

  it("gives an organisation's account the surat kuasa and the general papers, not the KTP photo", async () => {
    const db = makeCampaignDb({
      campaigns: [campaignRow({ lifecycleStatus: 'DRAFT', deadline: DEADLINE, creatorId: 'partner-fundraiser-1' })],
      checklistItems: SEEDED,
    });

    await submitCampaign(db.prisma as never, { campaignId: 'campaign-1', actor: organisation, now: NOW });

    expect(ids(db.verificationRequests[0].checklist)).toEqual([
      'rencana-anggaran',
      'bukti-alamat',
      'bukti-hubungan-penerima-manfaat',
      'surat-kuasa-lembaga',
      'dokumen-pendukung-program',
    ]);
  });
});

describe('a live Campaign after the migration', () => {
  it('can still have a CHANGE request approved: it snapshots none of the five new items', async () => {
    const db = makeCampaignDb({
      campaigns: [campaignRow({ lifecycleStatus: 'ACTIVE', deadline: DEADLINE, targetAmount: 50_000_000 })],
      checklistItems: SEEDED,
    });

    const { verificationRequest } = await requestCampaignChange(db.prisma as never, {
      campaignId: 'campaign-1',
      actor: individual,
      changes: { targetAmount: 100_000_000 },
      now: NOW,
    });
    expect(ids(db.verificationRequests[0].checklist)).toEqual(['rencana-anggaran']);

    await decideVerificationRequest(db.prisma as never, {
      campaignId: 'campaign-1',
      requestId: verificationRequest.id,
      actor: verifier,
      decision: 'approve',
      ticked: ['rencana-anggaran'],
      now: NOW,
      mailer: { name: 'test', send: async () => undefined },
    });

    expect(db.verificationRequests[0]).toMatchObject({ outcome: 'APPROVED' });
    expect(db.campaign()).toMatchObject({ targetAmount: 100_000_000 });
  });

  it('snapshots none of the five new items on an AMOUNT_REVIEW either', async () => {
    const db = makeCampaignDb({
      campaigns: [campaignRow({ lifecycleStatus: 'ACTIVE', deadline: DEADLINE })],
      checklistItems: SEEDED,
    });

    const raised = await (
      db.prisma as unknown as { $transaction: <T>(cb: (tx: unknown) => Promise<T>) => Promise<T> }
    ).$transaction((tx) =>
      raiseAmountReviewVerificationRequest(tx as never, {
        campaignId: 'campaign-1',
        cumulativeGross: 120_000_000,
        threshold: 100_000_000,
        now: NOW,
      }),
    );

    expect(ids(raised?.checklist)).toEqual(['rencana-anggaran']);
  });
});
