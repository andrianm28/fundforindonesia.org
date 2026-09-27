import { describe, it, expect } from 'vitest';

/**
 * The follow-up seam (ticket 06): a member of the partnership team moves one
 * Partnership Inquiry's follow-up status forward, and every move leaves a row
 * saying who made it, from which status, to which, and when. The database is
 * an in-memory stand-in; the tests assert on the rows left behind and the
 * answers returned, never on which Prisma methods ran.
 *
 * What this file also pins is the shape of the movement itself: forward only,
 * one step at a time, never backward onto a status already held, and never
 * onto an Inquiry nobody can name. A follow-up is a work queue for the
 * partnership team, not a Campaign status, so it has no money, no Fundraiser
 * and no effective status -- see the module's own comment, and
 * program-money-isolation.test.ts for the schema side of that.
 */
import {
  followUpPartnershipInquiry,
  listPartnershipInquiries,
  partnershipInquiryFollowUpErrorToHttp,
  InvalidInquiryStatusError,
  InvalidInquiryTransitionError,
  PartnershipInquiryNotFoundError,
  ConcurrentInquiryStatusChangeError,
} from './partnership-inquiry-followup';
import { INQUIRY_STATUS_LABEL, nextInquiryStatus } from './partnership-inquiry-status';
import {
  inquiryChangeRow,
  inquiryRow,
  makeInquiryDb,
  programOfInquiry,
  userRow,
} from '../../tests/support/in-memory-inquiry-db';

const ACTOR = 'admin-1';
const NOW = new Date('2026-09-28T09:00:00Z');

function followUp(db: unknown, to: unknown, now: Date = NOW) {
  return followUpPartnershipInquiry(db as never, {
    inquiryId: 'inquiry-1',
    to,
    actorId: ACTOR,
    now,
  });
}

describe('followUpPartnershipInquiry', () => {
  it('moves an Inquiry forward one step and records who did it and when', async () => {
    const { prisma, inquiries, changes } = makeInquiryDb({ inquiries: [inquiryRow()] });

    const result = await followUp(prisma, 'IN_PROGRESS');

    expect(inquiries[0].status).toBe('IN_PROGRESS');
    expect(changes).toEqual([
      {
        id: 'change-1',
        inquiryId: 'inquiry-1',
        fromStatus: 'NOT_YET_FOLLOWED_UP',
        toStatus: 'IN_PROGRESS',
        actedById: ACTOR,
        actedAt: NOW,
      },
    ]);
    expect(result.inquiry.status).toBe('IN_PROGRESS');
    expect(result.change).toEqual(
      expect.objectContaining({ fromStatus: 'NOT_YET_FOLLOWED_UP', toStatus: 'IN_PROGRESS', actedById: ACTOR }),
    );
  });

  it('takes an Inquiry being followed up to done', async () => {
    const { prisma, inquiries, changes } = makeInquiryDb({
      inquiries: [inquiryRow({ status: 'IN_PROGRESS' })],
      changes: [inquiryChangeRow({ fromStatus: 'NOT_YET_FOLLOWED_UP', toStatus: 'IN_PROGRESS' })],
    });

    await followUp(prisma, 'DONE');

    expect(inquiries[0].status).toBe('DONE');
    // The second move is recorded beside the first, never over it.
    expect(changes).toHaveLength(2);
    expect(changes[1]).toEqual(
      expect.objectContaining({ fromStatus: 'IN_PROGRESS', toStatus: 'DONE', actedById: ACTOR }),
    );
  });

  it('never moves an Inquiry backward, and records nothing when it refuses', async () => {
    const { prisma, inquiries, changes } = makeInquiryDb({
      inquiries: [inquiryRow({ status: 'IN_PROGRESS' })],
    });

    await expect(followUp(prisma, 'NOT_YET_FOLLOWED_UP')).rejects.toBeInstanceOf(InvalidInquiryTransitionError);

    expect(inquiries[0].status).toBe('IN_PROGRESS');
    expect(changes).toEqual([]);
  });

  it('treats done as final', async () => {
    const { prisma, inquiries, changes } = makeInquiryDb({ inquiries: [inquiryRow({ status: 'DONE' })] });

    await expect(followUp(prisma, 'IN_PROGRESS')).rejects.toBeInstanceOf(InvalidInquiryTransitionError);

    expect(inquiries[0].status).toBe('DONE');
    expect(changes).toEqual([]);
  });

  it('refuses a status the Inquiry already holds, rather than recording a no-op', async () => {
    const { prisma, changes } = makeInquiryDb({ inquiries: [inquiryRow()] });

    await expect(followUp(prisma, 'NOT_YET_FOLLOWED_UP')).rejects.toBeInstanceOf(InvalidInquiryTransitionError);

    expect(changes).toEqual([]);
  });

  it('refuses a status the platform does not know', async () => {
    const { prisma, inquiries, changes } = makeInquiryDb({ inquiries: [inquiryRow()] });

    await expect(followUp(prisma, 'ARCHIVED')).rejects.toBeInstanceOf(InvalidInquiryStatusError);
    await expect(followUp(prisma, undefined)).rejects.toBeInstanceOf(InvalidInquiryStatusError);
    await expect(followUp(prisma, 42)).rejects.toBeInstanceOf(InvalidInquiryStatusError);

    expect(inquiries[0].status).toBe('NOT_YET_FOLLOWED_UP');
    expect(changes).toEqual([]);
  });

  it('refuses an Inquiry no company ever submitted', async () => {
    const { prisma, changes } = makeInquiryDb();

    await expect(
      followUpPartnershipInquiry(prisma as never, {
        inquiryId: 'inquiry-404',
        to: 'IN_PROGRESS',
        actorId: ACTOR,
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(PartnershipInquiryNotFoundError);

    expect(changes).toEqual([]);
  });

  it('lets exactly one of two people moving the same Inquiry at once win', async () => {
    // The second admin's move has already committed when the first one writes.
    const { prisma, inquiries, changes } = makeInquiryDb({
      inquiries: [inquiryRow()],
      onBeforeStatusWrite: () => {
        inquiries[0].status = 'IN_PROGRESS';
      },
    });

    await expect(followUp(prisma, 'IN_PROGRESS')).rejects.toBeInstanceOf(ConcurrentInquiryStatusChangeError);

    expect(inquiries[0].status).toBe('IN_PROGRESS');
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
        createdAt: new Date('2026-09-25T00:00:00Z'),
      }),
      inquiryRow({ id: 'inquiry-3', companyName: 'CV Cahaya Muda', createdAt: new Date('2026-09-22T00:00:00Z') }),
    ],
    changes: [
      inquiryChangeRow({
        id: 'change-1',
        inquiryId: 'inquiry-2',
        fromStatus: 'IN_PROGRESS',
        toStatus: 'DONE',
        actedById: 'admin-2',
        actedAt: new Date('2026-09-26T00:00:00Z'),
      }),
    ],
    users: [userRow(), userRow({ id: 'admin-2', name: 'Bagas Kemitraan' })],
  });

  it('shows every Inquiry, newest first, with its Program, company and status', async () => {
    const inquiries = await listPartnershipInquiries(three.prisma as never);

    expect(inquiries.map((row) => [row.id, row.companyName, row.status])).toEqual([
      ['inquiry-2', 'PT Bumi Hijau', 'DONE'],
      ['inquiry-3', 'CV Cahaya Muda', 'NOT_YET_FOLLOWED_UP'],
      ['inquiry-1', 'PT Sinar Abadi', 'NOT_YET_FOLLOWED_UP'],
    ]);
    expect(inquiries[0].program).toEqual(programOfInquiry());
  });

  it('shows who moved an Inquiry last and when, and nothing for one never moved', async () => {
    const inquiries = await listPartnershipInquiries(three.prisma as never);

    expect(inquiries[0].lastStatusChange).toEqual(
      expect.objectContaining({ fromStatus: 'IN_PROGRESS', toStatus: 'DONE', actedByName: 'Bagas Kemitraan' }),
    );
    expect(inquiries[1].lastStatusChange).toBeNull();
  });

  it('shows an empty queue rather than failing when no company has enquired', async () => {
    const empty = makeInquiryDb();

    expect(await listPartnershipInquiries(empty.prisma as never)).toEqual([]);
  });
});

describe('nextInquiryStatus', () => {
  it('offers the one step forward, and nothing from done', () => {
    expect(nextInquiryStatus('NOT_YET_FOLLOWED_UP')).toBe('IN_PROGRESS');
    expect(nextInquiryStatus('IN_PROGRESS')).toBe('DONE');
    expect(nextInquiryStatus('DONE')).toBeNull();
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
    expect(partnershipInquiryFollowUpErrorToHttp(new InvalidInquiryTransitionError('DONE'))).toEqual({
      status: 409,
      error: expect.stringContaining(INQUIRY_STATUS_LABEL.DONE),
    });
    expect(partnershipInquiryFollowUpErrorToHttp(new ConcurrentInquiryStatusChangeError())).toEqual({
      status: 409,
      error: expect.any(String),
    });
    expect(partnershipInquiryFollowUpErrorToHttp(new Error('boom'))).toBeNull();
  });
});
