import { describe, it, expect } from 'vitest';

/**
 * The pipeline seam (tickets 06 and pks-pemenuhan/17): a member of the
 * partnership team moves one Partnership Inquiry between the eight stages,
 * assigns its PIC (an Admin), and writes a follow-up note, and every such
 * change leaves one row saying who made it, what changed and when. The
 * database is an in-memory stand-in; the tests assert on the rows left behind
 * and the answers returned, never on which Prisma methods ran.
 *
 * What this file also pins is the shape of the movement itself: free in either
 * direction, except that leaving Selesai or Tidak dilanjutkan needs a reason;
 * a PIC must hold ADMIN; and a change that changes nothing is refused rather
 * than recorded.
 */
import {
  updatePartnershipInquiry,
  listPartnershipInquiries,
  getPartnershipInquiryDetail,
  listPartnershipPicCandidates,
  partnershipInquiryFollowUpErrorToHttp,
  InquiryReasonRequiredError,
  InvalidInquiryNoteError,
  InvalidInquiryPicError,
  InvalidInquiryStatusError,
  NothingToChangeError,
  PartnershipInquiryNotFoundError,
  ConcurrentInquiryStatusChangeError,
} from './partnership-inquiry-followup';
import {
  inquiryChangeRow,
  inquiryRow,
  makeInquiryDb,
  programOfInquiry,
  proposalRow,
  userRow,
} from '../../tests/support/in-memory-inquiry-db';

const ACTOR = 'admin-1';
const NOW = new Date('2026-11-09T09:00:00Z');
const USERS = [userRow(), userRow({ id: 'admin-2', name: 'Bagas Kemitraan' }), userRow({ id: 'fundraiser-1', name: 'Siti Penggalang' })];
const ADMINS = ['admin-1', 'admin-2'];

function update(db: unknown, change: { status?: unknown; picId?: unknown; note?: unknown }, now: Date = NOW) {
  return updatePartnershipInquiry(db as never, { inquiryId: 'inquiry-1', actorId: ACTOR, now, ...change });
}

describe('updatePartnershipInquiry: stages', () => {
  it('moves an Inquiry to any stage, not just the next, and records who did it and when', async () => {
    const { prisma, inquiries, changes } = makeInquiryDb({ inquiries: [inquiryRow()], users: USERS, adminIds: ADMINS });

    const result = await update(prisma, { status: 'APPROVED' });

    expect(inquiries[0].status).toBe('APPROVED');
    expect(changes).toEqual([
      expect.objectContaining({
        inquiryId: 'inquiry-1',
        fromStatus: 'NEW',
        toStatus: 'APPROVED',
        actedById: ACTOR,
        actedAt: NOW,
        note: null,
        picChanged: false,
      }),
    ]);
    expect(result.inquiry).toEqual({ id: 'inquiry-1', status: 'APPROVED', picId: null });
  });

  it('lets an Inquiry go back a stage without a reason', async () => {
    const { prisma, inquiries } = makeInquiryDb({ inquiries: [inquiryRow({ status: 'NEGOTIATION' })], users: USERS });

    await update(prisma, { status: 'PROPOSAL' });

    expect(inquiries[0].status).toBe('PROPOSAL');
  });

  it('keeps the follow-up note with the change it explains', async () => {
    const { prisma, changes } = makeInquiryDb({ inquiries: [inquiryRow()], users: USERS });

    await update(prisma, { status: 'CONTACTED', note: '  Sudah ditelepon, minta kirim proposal.  ' });

    expect(changes[0].note).toBe('Sudah ditelepon, minta kirim proposal.');
  });

  it.each(['DONE', 'DROPPED'] as const)('needs a reason to leave %s, and records nothing without one', async (closed) => {
    const { prisma, inquiries, changes } = makeInquiryDb({ inquiries: [inquiryRow({ status: closed })], users: USERS });

    await expect(update(prisma, { status: 'NEGOTIATION' })).rejects.toBeInstanceOf(InquiryReasonRequiredError);
    await expect(update(prisma, { status: 'NEGOTIATION', note: '   ' })).rejects.toBeInstanceOf(InquiryReasonRequiredError);

    expect(inquiries[0].status).toBe(closed);
    expect(changes).toEqual([]);
  });

  it('reopens a closed Inquiry when a reason is given, and the reason is in the history', async () => {
    const { prisma, inquiries, changes } = makeInquiryDb({ inquiries: [inquiryRow({ status: 'DROPPED' })], users: USERS });

    await update(prisma, { status: 'NEW', note: 'Perusahaan menghubungi kembali dengan anggaran baru.' });

    expect(inquiries[0].status).toBe('NEW');
    expect(changes[0]).toEqual(
      expect.objectContaining({ fromStatus: 'DROPPED', toStatus: 'NEW', note: 'Perusahaan menghubungi kembali dengan anggaran baru.' }),
    );
  });

  it('refuses a status the platform does not know, including the three old codes', async () => {
    const { prisma, inquiries, changes } = makeInquiryDb({ inquiries: [inquiryRow()], users: USERS });

    for (const status of ['ARCHIVED', 'NOT_YET_FOLLOWED_UP', 'IN_PROGRESS', 42, null]) {
      await expect(update(prisma, { status })).rejects.toBeInstanceOf(InvalidInquiryStatusError);
    }
    expect(inquiries[0].status).toBe('NEW');
    expect(changes).toEqual([]);
  });

  it('refuses a change that changes nothing, rather than recording a no-op', async () => {
    const { prisma, changes } = makeInquiryDb({ inquiries: [inquiryRow()], users: USERS });

    await expect(update(prisma, { status: 'NEW', note: 'tidak ada yang berubah' })).rejects.toBeInstanceOf(NothingToChangeError);
    await expect(update(prisma, { note: 'catatan saja' })).rejects.toBeInstanceOf(NothingToChangeError);
    expect(changes).toEqual([]);
  });

  it('refuses a note that is not text or is too long', async () => {
    const { prisma, changes } = makeInquiryDb({ inquiries: [inquiryRow()], users: USERS });

    await expect(update(prisma, { status: 'CONTACTED', note: 42 })).rejects.toBeInstanceOf(InvalidInquiryNoteError);
    await expect(update(prisma, { status: 'CONTACTED', note: 'x'.repeat(1001) })).rejects.toBeInstanceOf(InvalidInquiryNoteError);
    expect(changes).toEqual([]);
  });

  it('refuses an Inquiry no company ever submitted', async () => {
    const { prisma, changes } = makeInquiryDb({ users: USERS });

    await expect(update(prisma, { status: 'CONTACTED' })).rejects.toBeInstanceOf(PartnershipInquiryNotFoundError);
    expect(changes).toEqual([]);
  });

  it('lets exactly one of two people changing the same Inquiry at once win', async () => {
    // The second admin's move has already committed when the first one writes.
    const { prisma, inquiries, changes } = makeInquiryDb({
      inquiries: [inquiryRow()],
      users: USERS,
      onBeforeStatusWrite: () => {
        inquiries[0].status = 'CONTACTED';
      },
    });

    await expect(update(prisma, { status: 'PROPOSAL' })).rejects.toBeInstanceOf(ConcurrentInquiryStatusChangeError);

    expect(inquiries[0].status).toBe('CONTACTED');
    expect(changes).toEqual([]);
  });
});

describe('updatePartnershipInquiry: PIC', () => {
  it('assigns an Admin as PIC and records who was assigned, from whom, with the note', async () => {
    const { prisma, inquiries, changes } = makeInquiryDb({ inquiries: [inquiryRow()], users: USERS, adminIds: ADMINS });

    await update(prisma, { picId: 'admin-2', note: 'Bagas yang pegang karena sektor kesehatan.' });

    expect(inquiries[0].picId).toBe('admin-2');
    expect(inquiries[0].status).toBe('NEW');
    expect(changes).toEqual([
      expect.objectContaining({
        fromStatus: 'NEW',
        toStatus: 'NEW',
        actedById: ACTOR,
        picChanged: true,
        picFromId: null,
        picToId: 'admin-2',
        note: 'Bagas yang pegang karena sektor kesehatan.',
      }),
    ]);
  });

  it('refuses a PIC who is not an Admin, and writes nothing', async () => {
    const { prisma, inquiries, changes } = makeInquiryDb({ inquiries: [inquiryRow()], users: USERS, adminIds: ADMINS });

    await expect(update(prisma, { picId: 'fundraiser-1' })).rejects.toBeInstanceOf(InvalidInquiryPicError);
    await expect(update(prisma, { picId: 'nobody' })).rejects.toBeInstanceOf(InvalidInquiryPicError);
    await expect(update(prisma, { picId: 7 })).rejects.toBeInstanceOf(InvalidInquiryPicError);

    expect(inquiries[0].picId).toBeNull();
    expect(changes).toEqual([]);
  });

  it('clears the PIC with null, recording who it was taken from', async () => {
    const { prisma, inquiries, changes } = makeInquiryDb({
      inquiries: [inquiryRow({ picId: 'admin-2' })],
      users: USERS,
      adminIds: ADMINS,
    });

    await update(prisma, { picId: null });

    expect(inquiries[0].picId).toBeNull();
    expect(changes[0]).toEqual(expect.objectContaining({ picChanged: true, picFromId: 'admin-2', picToId: null }));
  });

  it('records a stage move and a PIC change made together as one history entry', async () => {
    const { prisma, changes } = makeInquiryDb({ inquiries: [inquiryRow()], users: USERS, adminIds: ADMINS });

    await update(prisma, { status: 'CONTACTED', picId: 'admin-1', note: 'Saya ambil.' });

    expect(changes).toHaveLength(1);
    expect(changes[0]).toEqual(
      expect.objectContaining({ fromStatus: 'NEW', toStatus: 'CONTACTED', picChanged: true, picToId: 'admin-1', note: 'Saya ambil.' }),
    );
  });

  it('does not count assigning the PIC who is already assigned as a change', async () => {
    const { prisma, changes } = makeInquiryDb({ inquiries: [inquiryRow({ picId: 'admin-2' })], users: USERS, adminIds: ADMINS });

    await expect(update(prisma, { picId: 'admin-2' })).rejects.toBeInstanceOf(NothingToChangeError);
    expect(changes).toEqual([]);
  });
});

describe('listPartnershipInquiries', () => {
  const three = makeInquiryDb({
    inquiries: [
      inquiryRow({ id: 'inquiry-1', companyName: 'PT Sinar Abadi', createdAt: new Date('2026-09-20T00:00:00Z') }),
      inquiryRow({
        id: 'inquiry-2',
        companyName: 'PT Bumi Hijau',
        contactName: 'Dimas Prakoso',
        status: 'DONE',
        picId: 'admin-2',
        budgetRange: 'OVER_1B',
        periodStart: '2027-01',
        periodEnd: '2027-12',
        createdAt: new Date('2026-09-25T00:00:00Z'),
      }),
      inquiryRow({ id: 'inquiry-3', companyName: 'CV Cahaya Muda', createdAt: new Date('2026-09-22T00:00:00Z') }),
    ],
    changes: [
      inquiryChangeRow({
        id: 'change-1',
        inquiryId: 'inquiry-2',
        fromStatus: 'ONGOING',
        toStatus: 'DONE',
        actedById: 'admin-2',
        actedAt: new Date('2026-09-26T00:00:00Z'),
      }),
      // A later PIC-only entry must not hide the stage move before it.
      inquiryChangeRow({
        id: 'change-2',
        inquiryId: 'inquiry-2',
        fromStatus: 'DONE',
        toStatus: 'DONE',
        actedById: 'admin-1',
        actedAt: new Date('2026-09-27T00:00:00Z'),
        picChanged: true,
        picToId: 'admin-2',
      }),
    ],
    documents: [proposalRow({ id: 'doc-1', partnershipInquiryId: 'inquiry-2' })],
    users: USERS,
    adminIds: ADMINS,
  });

  it('shows every Inquiry, newest first, with its Program, company, stage and PIC', async () => {
    const inquiries = await listPartnershipInquiries(three.prisma as never);

    expect(inquiries.map((row) => [row.id, row.companyName, row.status])).toEqual([
      ['inquiry-2', 'PT Bumi Hijau', 'DONE'],
      ['inquiry-3', 'CV Cahaya Muda', 'NEW'],
      ['inquiry-1', 'PT Sinar Abadi', 'NEW'],
    ]);
    expect(inquiries[0].program).toEqual(programOfInquiry());
    expect(inquiries[0].pic).toEqual({ id: 'admin-2', name: 'Bagas Kemitraan' });
    expect(inquiries[1].pic).toBeNull();
  });

  it('shows the budget range, the period and whether a proposal is attached', async () => {
    const [done, , plain] = await listPartnershipInquiries(three.prisma as never);

    expect(done).toEqual(
      expect.objectContaining({ budgetRange: 'OVER_1B', periodStart: '2027-01', periodEnd: '2027-12', hasProposal: true }),
    );
    expect(plain).toEqual(expect.objectContaining({ budgetRange: null, hasProposal: false }));
  });

  it('shows who moved an Inquiry between stages last, and nothing for one never moved', async () => {
    const inquiries = await listPartnershipInquiries(three.prisma as never);

    expect(inquiries[0].lastStatusChange).toEqual(
      expect.objectContaining({ fromStatus: 'ONGOING', toStatus: 'DONE', actedByName: 'Bagas Kemitraan' }),
    );
    expect(inquiries[1].lastStatusChange).toBeNull();
  });

  it('never hands out the contact details, address or NPWP', async () => {
    const inquiries = await listPartnershipInquiries(three.prisma as never);

    expect(JSON.stringify(inquiries)).not.toMatch(/Ciphertext|rina@|0812|\+62/);
  });

  it('shows an empty queue rather than failing when no company has enquired', async () => {
    const empty = makeInquiryDb();

    expect(await listPartnershipInquiries(empty.prisma as never)).toEqual([]);
  });
});

describe('getPartnershipInquiryDetail', () => {
  // A run of zeros is nobody's NPWP.
  const NPWP = '0'.repeat(16);
  const db = makeInquiryDb({
    inquiries: [
      inquiryRow({
        picId: 'admin-2',
        budgetRange: 'FROM_250M_TO_1B',
        periodStart: '2027-02',
        periodEnd: '2027-08',
        companyAddress: 'Jl. Contoh Nomor 1, Kota Contoh',
        companyNpwp: NPWP,
        contactEmail: 'rina@sinarabadi.test',
      }),
    ],
    changes: [
      inquiryChangeRow({ id: 'c1', toStatus: 'CONTACTED', note: 'Ditelepon.', actedAt: new Date('2026-09-28T00:00:00Z') }),
      inquiryChangeRow({
        id: 'c2',
        fromStatus: 'CONTACTED',
        toStatus: 'CONTACTED',
        actedById: 'admin-2',
        actedAt: new Date('2026-09-29T00:00:00Z'),
        picChanged: true,
        picToId: 'admin-2',
        note: 'Dialihkan ke Bagas.',
      }),
    ],
    documents: [proposalRow()],
    users: USERS,
    adminIds: ADMINS,
  });

  it('reads the sealed fields back for an Admin, with the history and the proposal', async () => {
    const detail = await getPartnershipInquiryDetail(db.prisma as never, 'inquiry-1');

    expect(detail).toEqual(
      expect.objectContaining({
        contactEmail: 'rina@sinarabadi.test',
        contactPhone: '+62 812 3456 7890',
        companyAddress: 'Jl. Contoh Nomor 1, Kota Contoh',
        companyNpwp: NPWP,
        budgetRange: 'FROM_250M_TO_1B',
        periodStart: '2027-02',
        periodEnd: '2027-08',
        pic: { id: 'admin-2', name: 'Bagas Kemitraan' },
      }),
    );
    expect(detail.proposals).toEqual([expect.objectContaining({ id: 'doc-1', label: 'Proposal kolaborasi' })]);
    expect(detail.history.map((h) => [h.actedByName, h.toStatus, h.note, h.picToName])).toEqual([
      ['Dewi Partnership', 'CONTACTED', 'Ditelepon.', null],
      ['Bagas Kemitraan', 'CONTACTED', 'Dialihkan ke Bagas.', 'Bagas Kemitraan'],
    ]);
  });

  it('refuses an Inquiry that does not exist', async () => {
    await expect(getPartnershipInquiryDetail(db.prisma as never, 'nope')).rejects.toBeInstanceOf(PartnershipInquiryNotFoundError);
  });
});

describe('listPartnershipPicCandidates', () => {
  it('offers the Admin users only', async () => {
    const { prisma } = makeInquiryDb({ users: USERS, adminIds: ['admin-2'] });

    expect(await listPartnershipPicCandidates(prisma as never)).toEqual([{ id: 'admin-2', name: 'Bagas Kemitraan' }]);
  });
});

describe('partnershipInquiryFollowUpErrorToHttp', () => {
  it('answers a refusal with its status, and nothing at all for a failure', () => {
    expect(partnershipInquiryFollowUpErrorToHttp(new PartnershipInquiryNotFoundError())).toEqual({
      status: 404,
      error: expect.stringContaining('tidak ditemukan'),
    });
    expect(partnershipInquiryFollowUpErrorToHttp(new InvalidInquiryStatusError('IN_PROGRESS', ['DONE']))).toEqual({
      status: 400,
      error: expect.stringContaining('IN_PROGRESS'),
    });
    expect(partnershipInquiryFollowUpErrorToHttp(new InquiryReasonRequiredError('DONE'))).toEqual({
      status: 400,
      error: expect.stringContaining('alasan'),
    });
    expect(partnershipInquiryFollowUpErrorToHttp(new InvalidInquiryPicError())).toEqual({ status: 400, error: expect.stringContaining('Admin') });
    expect(partnershipInquiryFollowUpErrorToHttp(new InvalidInquiryNoteError())).toEqual({ status: 400, error: expect.any(String) });
    expect(partnershipInquiryFollowUpErrorToHttp(new NothingToChangeError())).toEqual({ status: 409, error: expect.any(String) });
    expect(partnershipInquiryFollowUpErrorToHttp(new ConcurrentInquiryStatusChangeError())).toEqual({
      status: 409,
      error: expect.any(String),
    });
    expect(partnershipInquiryFollowUpErrorToHttp(new Error('boom'))).toBeNull();
  });
});
