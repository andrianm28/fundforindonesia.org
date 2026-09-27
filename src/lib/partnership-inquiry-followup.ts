import type { PrismaClient } from "@/generated/prisma/client";
import {
  INQUIRY_STATUS_LABEL,
  PARTNERSHIP_INQUIRY_STATUSES,
  isInquiryStatus,
  nextInquiryStatus,
  type PartnershipInquiryStatusValue,
} from "./partnership-inquiry-status";
import type { SectorValue } from "./programs";

/**
 * The partnership team's follow-up queue (ticket csr-06; CONTEXT.md,
 * Partnership Inquiry). A company asks about a Program, the partnership team
 * works the Inquiry through, and every step it takes is recorded: who moved
 * it, from which status to which, and when. That log is the point. The status
 * on the Inquiry says where the conversation stands today; the log says who
 * took it there, which is what an Audit months later has to answer.
 *
 * WHY THIS IS NOT THE CAMPAIGN LIFECYCLE RUNNER. `campaign-lifecycle.ts` is
 * the only writer of a Campaign status, and its `runCommand` is deliberately
 * about a Campaign: it locks a Campaign row through the subject guard, judges
 * the Capacity judgement against a Fundraiser who owns the subject, records
 * the acting Capacity, runs the leave-Active side effects, and tells the
 * Fundraiser. A Partnership Inquiry has none of that. It has no owner, no
 * Fundraiser, no Capacity beyond the ADMIN assignment the route already
 * checked, no deadline to be effectively past, no Donation to stop accepting,
 * and no money of any kind -- a Program never takes money online (ADR 0002,
 * and program-money-isolation.test.ts, which fails if anything here grows a
 * relation to a Donation, Payment, Refund, Payout or LedgerEntry). Widening
 * the runner to cover it would put a CSR work queue inside the money
 * lifecycle's lock order and its notification machinery, for no gain.
 *
 * What this module DOES copy is the part that is about safety rather than
 * about Campaigns: the single predicated write, the append-only log in the
 * same transaction, and one typed refusal per way of saying no. The write is
 * predicated on the status the caller read (`updateMany` with
 * `WHERE id = ? AND status = ?`), so two people moving the same Inquiry at
 * once produce one move and one refusal rather than one overwrite -- the same
 * guarantee `campaign-lifecycle.ts` relies on that predicate for, reached here
 * without a row lock, because a queue nobody is competing to own does not need
 * one.
 *
 * Callers establish the ADMIN assignment (the routes do, through
 * withAssignmentCheck); these commands take the acting person's id, the way
 * ./partner-organisations.ts does.
 */

// ==================== Refusals ====================

export class PartnershipInquiryNotFoundError extends Error {
  constructor() {
    super("Partnership Inquiry tidak ditemukan.");
    this.name = "PartnershipInquiryNotFoundError";
  }
}

/** A status the platform does not have; `accepted` says which it does. */
export class InvalidInquiryStatusError extends Error {
  constructor(readonly refused: unknown, readonly accepted: readonly PartnershipInquiryStatusValue[]) {
    const named = typeof refused === "string" ? `"${refused}" ` : "";
    super(
      `Status tindak lanjut ${named}tidak dikenal. Yang tersedia: ${accepted.join(", ")}.`,
    );
    this.name = "InvalidInquiryStatusError";
  }
}

/**
 * The Inquiry is not at the status this move starts from: it is already DONE,
 * already where the caller wanted it, or behind the step asked for.
 */
export class InvalidInquiryTransitionError extends Error {
  constructor(readonly current: PartnershipInquiryStatusValue) {
    super(
      current === "DONE"
        ? `Partnership Inquiry ini sudah berstatus ${INQUIRY_STATUS_LABEL.DONE} dan tidak dapat ditindaklanjuti lagi.`
        : `Partnership Inquiry ini sudah berstatus ${INQUIRY_STATUS_LABEL[current]}. Langkah yang tersedia: ${INQUIRY_STATUS_LABEL[nextInquiryStatus(current) as PartnershipInquiryStatusValue]}.`,
    );
    this.name = "InvalidInquiryTransitionError";
  }
}

/**
 * Somebody else moved this Inquiry between the status the caller read and the
 * write that asked for it. Their move stands; this one is refused so the team
 * sees one history rather than two.
 */
export class ConcurrentInquiryStatusChangeError extends Error {
  constructor() {
    super("Partnership Inquiry ini baru saja ditindaklanjuti oleh orang lain. Muat ulang daftarnya.");
    this.name = "ConcurrentInquiryStatusChangeError";
  }
}

/** The HTTP answer for a refusal from this module, or null for anything else. */
export function partnershipInquiryFollowUpErrorToHttp(
  error: unknown,
): { status: number; error: string } | null {
  if (error instanceof PartnershipInquiryNotFoundError) {
    return { status: 404, error: error.message };
  }
  if (error instanceof InvalidInquiryStatusError) {
    return { status: 400, error: error.message };
  }
  if (error instanceof InvalidInquiryTransitionError || error instanceof ConcurrentInquiryStatusChangeError) {
    return { status: 409, error: error.message };
  }
  return null;
}

// ==================== The database, as far as this module reads it ====================

/**
 * Named field by field rather than as a Prisma model, for one reason: these
 * are the only columns the queue reads and the only ones the move writes, so
 * this is the promise about what a follow-up touches. `contactEmail` and
 * `contactPhone` are absent on purpose -- the queue is a list of who asked
 * about what, and a person's contact details belong on the Inquiry itself
 * (ADR 0012), not repeated in every panel that lists one.
 */
export type PartnershipInquirySummary = {
  id: string;
  companyName: string;
  contactName: string;
  status: PartnershipInquiryStatusValue;
  createdAt: Date;
  updatedAt: Date;
  program: { id: string; slug: string; title: string; sector: SectorValue };
  /** The step that put it where it is, or null while it has never been moved. */
  lastStatusChange: {
    fromStatus: PartnershipInquiryStatusValue;
    toStatus: PartnershipInquiryStatusValue;
    actedById: string;
    actedByName: string;
    actedAt: Date;
  } | null;
};

/** The Inquiry as a move leaves it; what PATCH answers with. */
export type PartnershipInquiryState = { id: string; status: PartnershipInquiryStatusValue };

export type PartnershipInquiryFollowUpResult = {
  inquiry: PartnershipInquiryState;
  change: {
    fromStatus: PartnershipInquiryStatusValue;
    toStatus: PartnershipInquiryStatusValue;
    actedById: string;
    actedAt: Date;
  };
};

type Where = Record<string, unknown>;

type InquiryDelegate = {
  findUnique(args: { where: Where; select?: Record<string, boolean> }): Promise<Record<string, unknown> | null>;
  findMany(args: {
    where?: Where;
    orderBy?: Record<string, "asc" | "desc">[];
    select?: Record<string, boolean>;
    include?: { program?: unknown };
  }): Promise<Record<string, unknown>[]>;
  updateMany(args: { where: Where; data: Record<string, unknown> }): Promise<{ count: number }>;
};

type ChangeDelegate = {
  create(args: { data: Record<string, unknown> }): Promise<Record<string, unknown>>;
  findMany(args: {
    where?: Where;
    orderBy?: Record<string, "asc" | "desc">[];
    select?: Record<string, boolean>;
    include?: { actedBy?: unknown };
  }): Promise<Record<string, unknown>[]>;
};

type InquiryDb = {
  partnershipInquiry: InquiryDelegate;
  partnershipInquiryStatusChange: ChangeDelegate;
};

/** Prisma's transaction client seen as the two delegates this module uses. */
function delegatesOf(client: unknown): InquiryDb {
  return client as InquiryDb;
}

const SUMMARY_SELECT = {
  id: true,
  companyName: true,
  contactName: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const;

const CHANGE_SELECT = {
  inquiryId: true,
  fromStatus: true,
  toStatus: true,
  actedById: true,
  actedAt: true,
} as const;

/** The Program columns the queue shows beside the company that asked. */
const PROGRAM_SELECT = { id: true, slug: true, title: true, sector: true } as const;

/** A listed Inquiry, and a step that moved it, as the two reads above return them. */
type InquirySummaryRow = Omit<PartnershipInquirySummary, "lastStatusChange">;

type ChangeRow = {
  inquiryId: string;
  fromStatus: PartnershipInquiryStatusValue;
  toStatus: PartnershipInquiryStatusValue;
  actedById: string;
  actedBy: { name: string };
  actedAt: Date;
};

// ==================== Commands ====================

/**
 * Moves one Inquiry's follow-up forward one step, in a transaction that
 * records the step beside the move.
 *
 * Forward only: `to` must be the one status `nextInquiryStatus` offers from
 * the status the Inquiry actually holds. A status it already holds, one behind
 * it, and one after DONE are all refused, and nothing is written when they
 * are -- a no-op recorded as a step would put a follow-up in the log that
 * nobody followed up.
 *
 * The write is predicated on the status just read. Under READ COMMITTED, two
 * people moving the same Inquiry at once both pass the check above, and the
 * loser's write matches no row: it is refused, and the log keeps one entry per
 * real step.
 */
export async function followUpPartnershipInquiry(
  prisma: PrismaClient,
  params: { inquiryId: string; to: unknown; actorId: string; now?: Date },
): Promise<PartnershipInquiryFollowUpResult> {
  if (!isInquiryStatus(params.to)) {
    throw new InvalidInquiryStatusError(params.to, PARTNERSHIP_INQUIRY_STATUSES);
  }
  const to = params.to;
  const now = params.now ?? new Date();

  return prisma.$transaction(async (tx) => {
    const db = delegatesOf(tx);
    const inquiry = await db.partnershipInquiry.findUnique({
      where: { id: params.inquiryId },
      select: { id: true, status: true },
    });
    if (!inquiry) throw new PartnershipInquiryNotFoundError();

    const from = inquiry.status as PartnershipInquiryStatusValue;
    if (nextInquiryStatus(from) !== to) throw new InvalidInquiryTransitionError(from);

    const written = await db.partnershipInquiry.updateMany({
      where: { id: inquiry.id, status: from },
      data: { status: to },
    });
    if (written.count === 0) throw new ConcurrentInquiryStatusChangeError();

    await db.partnershipInquiryStatusChange.create({
      data: { inquiryId: inquiry.id, fromStatus: from, toStatus: to, actedById: params.actorId, actedAt: now },
    });

    return {
      inquiry: { id: String(inquiry.id), status: to },
      change: { fromStatus: from, toStatus: to, actedById: params.actorId, actedAt: now },
    };
  });
}

/**
 * Every Inquiry the partnership team has been told about, newest first, with
 * the Program it is about and the step it was last moved by.
 *
 * One query each for the Inquiries and for the steps that moved them, rather
 * than a relation on every row: the second read takes the ids of the rows just
 * listed, so a queue of any size costs the same two round trips. The step
 * shown is the last one recorded, found by ordering the log newest first and
 * keeping the first entry per Inquiry -- an Inquiry nobody has moved has none,
 * and says so rather than showing a step that never happened.
 */
export async function listPartnershipInquiries(
  prisma: PrismaClient,
): Promise<PartnershipInquirySummary[]> {
  const db = delegatesOf(prisma);
  const rows = (await db.partnershipInquiry.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: SUMMARY_SELECT,
    include: { program: { select: PROGRAM_SELECT } },
  })) as InquirySummaryRow[];
  if (rows.length === 0) return [];

  const ids = rows.map((row) => String(row.id));
  const changes = (await db.partnershipInquiryStatusChange.findMany({
    where: { inquiryId: { in: ids } },
    orderBy: [{ actedAt: "desc" }, { id: "desc" }],
    select: CHANGE_SELECT,
    include: { actedBy: { select: { name: true } } },
  })) as ChangeRow[];

  // Ordered newest first, so the first entry per Inquiry is the one that put
  // it where it is now.
  const lastOf = new Map<string, ChangeRow>();
  for (const change of changes) {
    if (!lastOf.has(change.inquiryId)) lastOf.set(change.inquiryId, change);
  }

  return rows.map((row) => {
    const last = lastOf.get(String(row.id));
    return {
      id: String(row.id),
      companyName: row.companyName,
      contactName: row.contactName,
      status: row.status,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      program: row.program,
      lastStatusChange: last
        ? {
            fromStatus: last.fromStatus,
            toStatus: last.toStatus,
            actedById: last.actedById,
            actedByName: last.actedBy.name,
            actedAt: last.actedAt,
          }
        : null,
    };
  });
}
