import type { Payout, Prisma, PrismaClient, UsageReport } from '@/generated/prisma/client';
import { lockAndLoad, requireNotOwnerAsAdmin } from '@/lib/subject-guard';
import { PayoutNotFoundError } from '@/lib/money/errors';
import type { LedgerSubject } from '@/lib/money/ledger';
import {
  UsageReportAlreadyDisputedError,
  UsageReportAlreadyExistsError,
  UsageReportInvalidError,
  UsageReportNotFoundError,
  UsageReportPayoutNotCompletedError,
} from './usage-report-errors';

/**
 * A Fundraiser's account of how one Payout's money was used (ticket 22; PRD
 * FFI-07a; CONTEXT.md, Usage Report), and the gate it puts on the next Payout
 * on the same Campaign.
 *
 * SCOPED TO CAMPAIGN, NOT VOLUNTEER TRIP. CONTEXT.md's Usage Report entry
 * names its public home by name -- "tampil publik di halaman Campaign" -- and
 * nothing in the PRD or CONTEXT.md describes an equivalent for a Volunteer
 * Trip's Payout (Trip Fee, ADR 0014: a Trip is not a Campaign and does not
 * take a Kind). `campaignBlockingUsageReport` below is therefore never asked
 * of a Trip subject, and `requestPayout` (@/lib/money/payouts.ts) only calls
 * it for `subject.type === 'campaign'`.
 */

export interface UsageReportLineItem {
  label: string;
  amount: number;
}

/**
 * Every line item has a non-blank label and a positive whole-rupiah amount,
 * and the items sum to exactly the Payout's own amount -- "rincian per pos
 * yang jumlahnya sama dengan nominal Payout" (PRD FFI-07a). Not "at most":
 * a report that accounts for less than the Payout, or more, is not a
 * complete account of where that Payout's money went.
 */
function validateLineItems(lineItems: unknown, payoutAmount: number): asserts lineItems is UsageReportLineItem[] {
  if (!Array.isArray(lineItems) || lineItems.length === 0) {
    throw new UsageReportInvalidError('Rincian pemakaian dana harus punya minimal satu pos.');
  }
  let total = 0;
  for (const item of lineItems) {
    const label = (item as { label?: unknown } | null)?.label;
    const amount = (item as { amount?: unknown } | null)?.amount;
    if (typeof label !== 'string' || label.trim() === '') {
      throw new UsageReportInvalidError('Setiap pos rincian harus punya nama.');
    }
    if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) {
      throw new UsageReportInvalidError(`Nominal pos "${label}" harus bilangan bulat lebih dari 0.`);
    }
    total += amount;
  }
  if (total !== payoutAmount) {
    throw new UsageReportInvalidError(
      `Total rincian (${total}) harus sama persis dengan nominal Payout (${payoutAmount}).`,
    );
  }
}

export interface SubmitUsageReportParams {
  payoutId: string;
  submittedById: string;
  narrative: string;
  lineItems: UsageReportLineItem[];
  beneficiaryCount: number;
  photos: string[];
}

/**
 * A Fundraiser submits a Usage Report for one of their own Payouts. Public
 * the moment it is sent -- "tampil publik ... sejak dikirim, tanpa menunggu
 * tinjauan" -- so there is no draft or review state here to create.
 *
 * Ownership (only this Payout's own requester may report on it) is the
 * caller's responsibility, asked the same way every other Payout action asks
 * it: the route judges the Capacity question before ever reaching here. What
 * this function owns is the Payout's own status, the one-report-per-Payout
 * rule, and the shape and arithmetic of the report.
 *
 * `prisma.$transaction` wraps the whole read-then-write so a second
 * submission racing in cannot both pass the `usageReport` check: the schema's
 * own `UsageReport.payoutId @unique` is the backstop if it ever did, and
 * would surface as a Prisma unique-constraint error rather than this typed
 * one -- acceptable because that only happens if two requests interleave
 * inside the same transaction's read/write gap, which Postgres's default
 * isolation does not allow for a row this function itself just read.
 */
export async function submitUsageReport(
  prisma: PrismaClient,
  params: SubmitUsageReportParams,
): Promise<UsageReport> {
  const { payoutId, submittedById, narrative, lineItems, beneficiaryCount, photos } = params;

  // Judged before the transaction opens: none of these can become good by
  // reading the database, so nothing is read or written for a request that
  // is malformed regardless of which Payout it names.
  if (typeof narrative !== 'string' || narrative.trim() === '') {
    throw new UsageReportInvalidError('Narasi pemakaian dana harus diisi.');
  }
  if (!Array.isArray(photos) || photos.length === 0 || photos.some((p) => typeof p !== 'string' || p.trim() === '')) {
    throw new UsageReportInvalidError('Minimal satu foto bukti harus dilampirkan.');
  }
  // The route's z.string().url() accepts any URL scheme, including
  // `javascript:` and `data:` -- neither is a photo anyone can host as public
  // evidence, and a `javascript:` one would run when a public visitor clicks
  // it. Enforced here, not only in the route, so the rule holds for every
  // caller of this function, not just the one route that happens to validate
  // it today.
  if (photos.some((p) => !/^https?:\/\//i.test(p.trim()))) {
    throw new UsageReportInvalidError('Setiap foto bukti harus berupa URL http atau https.');
  }
  if (typeof beneficiaryCount !== 'number' || !Number.isInteger(beneficiaryCount) || beneficiaryCount < 1) {
    throw new UsageReportInvalidError('Jumlah penerima manfaat harus bilangan bulat minimal 1.');
  }

  return prisma.$transaction(async (tx) => {
    const payout = await tx.payout.findUnique({ where: { id: payoutId }, include: { usageReport: true } });
    if (!payout) {
      throw new PayoutNotFoundError(payoutId);
    }
    // Only a COMPLETED Payout's money has actually moved; DRAFT and APPROVED
    // have nothing yet to report on (CONTEXT.md, Usage Report: "Laporan
    // Fundraiser tentang pemakaian dana sebuah Payout").
    if (payout.status !== 'COMPLETED') {
      throw new UsageReportPayoutNotCompletedError();
    }
    // The schema's own payoutId unique constraint says the same thing; this
    // is the typed refusal a route can answer before that constraint is ever
    // reached.
    if (payout.usageReport) {
      throw new UsageReportAlreadyExistsError();
    }

    validateLineItems(lineItems, payout.amount);

    return tx.usageReport.create({
      data: {
        payoutId,
        narrative: narrative.trim(),
        lineItems: lineItems.map((item) => ({ label: item.label.trim(), amount: item.amount })),
        beneficiaryCount,
        photos,
        submittedById,
      },
    });
  });
}

export interface DisputeUsageReportParams {
  usageReportId: string;
  disputedById: string;
  reason: string;
}

/**
 * An Admin marks a Usage Report "dipertanyakan" (PRD FFI-07a), with a reason
 * that is public beside it. There is no code path that lifts a dispute once
 * set: nothing in the spec describes one, so a report that has been disputed
 * stays disputed, and so does the gate it puts on the Campaign's next Payout
 * (campaignBlockingUsageReport, below).
 *
 * NOT THE CAMPAIGN'S OWN FUNDRAISER, the same Admin rule every other money
 * action on a subject enforces (CONTEXT.md, Admin; requireNotOwnerAsAdmin):
 * judged under the subject's own row lock, taken here the same way
 * approvePayout and completePayout take it, even though nothing about the
 * subject's balance is read or written -- the ownership check needs the
 * locked, current owner, not a stale one.
 */
export async function disputeUsageReport(
  prisma: PrismaClient,
  params: DisputeUsageReportParams,
): Promise<UsageReport> {
  const { usageReportId, disputedById, reason } = params;

  if (typeof reason !== 'string' || reason.trim() === '') {
    throw new UsageReportInvalidError('Alasan dipertanyakan harus diisi.');
  }

  return prisma.$transaction(async (tx) => {
    const report = await tx.usageReport.findUnique({
      where: { id: usageReportId },
      include: { payout: { select: { campaignId: true, volunteerTripId: true } } },
    });
    if (!report) {
      throw new UsageReportNotFoundError();
    }
    if (report.disputedAt) {
      throw new UsageReportAlreadyDisputedError();
    }

    const subject: LedgerSubject = report.payout.campaignId
      ? { type: 'campaign', campaignId: report.payout.campaignId }
      : { type: 'trip', tripId: report.payout.volunteerTripId! };
    const state = await lockAndLoad(tx, subject, new Date());
    if (state) requireNotOwnerAsAdmin(state, disputedById);

    return tx.usageReport.update({
      where: { id: usageReportId },
      data: {
        disputedAt: new Date(),
        disputedReason: reason.trim(),
        disputedById,
      },
    });
  });
}

/**
 * The Campaign's oldest COMPLETED Payout whose Usage Report is missing, or
 * was marked disputed by an Admin -- either blocks the next Payout from being
 * requested (CONTEXT.md, Usage Report; PRD FFI-07: "Usage Report wajib pada
 * setiap Payout Completed sebelum Payout berikutnya"; FFI-07a: a dispute
 * "memblokir Payout berikutnya"). Null when nothing blocks.
 *
 * Read in the caller's own transaction, under the SAME Campaign row lock the
 * caller already holds (requestPayout takes it via lockAndLoad before this is
 * ever called) -- this function issues no lock of its own, so its answer is
 * only as current as the lock protecting it.
 */
export async function campaignBlockingUsageReport(
  tx: Prisma.TransactionClient,
  campaignId: string,
): Promise<Payout | null> {
  return tx.payout.findFirst({
    where: {
      campaignId,
      status: 'COMPLETED',
      OR: [{ usageReport: null }, { usageReport: { disputedAt: { not: null } } }],
    },
    orderBy: { completedAt: 'asc' },
  });
}
