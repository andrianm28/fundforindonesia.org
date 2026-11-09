import type { PrismaClient } from "@/generated/prisma/client";
import {
  readInquiryCompanyAddress,
  readInquiryCompanyNpwp,
  readInquiryContactEmail,
  readInquiryContactPhone,
} from "./contact-fields";
import {
  INQUIRY_STATUS_LABEL,
  PARTNERSHIP_INQUIRY_STATUSES,
  inquiryTransitionNeedsReason,
  isInquiryStatus,
  type PartnershipBudgetRangeValue,
  type PartnershipInquiryStatusValue,
} from "./partnership-inquiry-status";
import type { SectorValue } from "./programs";

/**
 * The partnership team's pipeline (tickets csr-06 and pks-pemenuhan/17;
 * CONTEXT.md, Partnership Inquiry). A company asks about a Program, the
 * partnership team works the Inquiry through eight stages, assigns one Admin as
 * its PIC, and writes a note with each change. Every change is recorded: who
 * made it, what moved, the note, and when. That log is the point. The status on
 * the Inquiry says where the conversation stands today; the log says who took
 * it there and why, which is what an Audit months later has to answer.
 *
 * WHY THIS IS NOT THE CAMPAIGN LIFECYCLE RUNNER. `campaign-lifecycle.ts` is
 * the only writer of a Campaign status, and its `runCommand` is deliberately
 * about a Campaign: it locks a Campaign row through the subject guard, judges
 * the Capacity judgement against a Fundraiser who owns the subject, runs the
 * leave-Active side effects, and tells the Fundraiser. A Partnership Inquiry
 * has none of that. It has no owner, no Fundraiser, no deadline, no Donation to
 * stop accepting, and no money of any kind -- a Program never takes money
 * online (ADR 0002, and program-money-isolation.test.ts, which fails if
 * anything here grows a relation to a Donation, Payment, Refund, Payout or
 * LedgerEntry). Widening the runner to cover it would put a CSR work queue
 * inside the money lifecycle's lock order, for no gain.
 *
 * What this module DOES copy is the part that is about safety rather than
 * about Campaigns: the single predicated write, the append-only log in the
 * same transaction, and one typed refusal per way of saying no. The write is
 * predicated on the status and PIC the caller read (`updateMany` with
 * `WHERE id = ? AND status = ? AND picId = ?`), so two people
 * changing the same Inquiry at once produce one change and one refusal rather
 * than one overwrite.
 *
 * THE RULE ON MOVING (owner, PKS Pasal 3.6): free in either direction, except
 * that leaving Selesai (DONE) or Tidak dilanjutkan (DROPPED) needs a reason,
 * written in the note. A PIC must hold the ADMIN assignment (ADR 0005).
 *
 * Callers establish the ADMIN assignment (the routes do, through
 * withHiddenAssignmentCheck); these commands take the acting person's id, the
 * way ./partner-organisations.ts does.
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
    super(`Status ${named}tidak dikenal. Yang tersedia: ${accepted.join(", ")}.`);
    this.name = "InvalidInquiryStatusError";
  }
}

/** Leaving Selesai or Tidak dilanjutkan, with no reason written. */
export class InquiryReasonRequiredError extends Error {
  constructor(readonly current: PartnershipInquiryStatusValue) {
    super(
      `Partnership Inquiry ini berstatus ${INQUIRY_STATUS_LABEL[current]}. Tuliskan alasan di catatan untuk memindahkannya ke tahap lain.`,
    );
    this.name = "InquiryReasonRequiredError";
  }
}

/** The PIC is not a person who holds the ADMIN assignment. */
export class InvalidInquiryPicError extends Error {
  constructor() {
    super("PIC harus berupa pengguna Admin.");
    this.name = "InvalidInquiryPicError";
  }
}

export const MAX_INQUIRY_NOTE_LENGTH = 1000;

export class InvalidInquiryNoteError extends Error {
  constructor() {
    super(`Catatan harus berupa teks, paling panjang ${MAX_INQUIRY_NOTE_LENGTH} karakter.`);
    this.name = "InvalidInquiryNoteError";
  }
}

/** The request would change neither the stage nor the PIC. */
export class NothingToChangeError extends Error {
  constructor() {
    super("Tidak ada perubahan: tahap dan PIC sudah sama seperti yang diminta.");
    this.name = "NothingToChangeError";
  }
}

/**
 * Somebody else changed this Inquiry between what the caller read and the
 * write that asked for the change. Their change stands; this one is refused so
 * the team sees one history rather than two.
 */
export class ConcurrentInquiryStatusChangeError extends Error {
  constructor() {
    super("Partnership Inquiry ini baru saja diubah oleh orang lain. Muat ulang daftarnya.");
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
  if (
    error instanceof InvalidInquiryStatusError ||
    error instanceof InquiryReasonRequiredError ||
    error instanceof InvalidInquiryPicError ||
    error instanceof InvalidInquiryNoteError
  ) {
    return { status: 400, error: error.message };
  }
  if (error instanceof NothingToChangeError || error instanceof ConcurrentInquiryStatusChangeError) {
    return { status: 409, error: error.message };
  }
  return null;
}

// ==================== The database, as far as this module reads it ====================

type Person = { id: string; name: string };

type ProgramSummary = { id: string; slug: string; title: string; sector: SectorValue };

/**
 * Named field by field rather than as a Prisma model, for one reason: these
 * are the only columns the pipeline lists, so this is the promise about what a
 * list shows. The contact, address and NPWP are absent on purpose -- the
 * pipeline says who asked about what, and a person's or a company's details
 * belong on the Inquiry's own detail (ADR 0012), not repeated in every card.
 */
export type PartnershipInquirySummary = {
  id: string;
  companyName: string;
  contactName: string;
  status: PartnershipInquiryStatusValue;
  budgetRange: PartnershipBudgetRangeValue | null;
  periodStart: string | null;
  periodEnd: string | null;
  hasProposal: boolean;
  pic: Person | null;
  createdAt: Date;
  updatedAt: Date;
  program: ProgramSummary;
  /** The step that put it at its stage, or null while it has never changed stage. */
  lastStatusChange: {
    fromStatus: PartnershipInquiryStatusValue;
    toStatus: PartnershipInquiryStatusValue;
    actedById: string;
    actedByName: string;
    actedAt: Date;
  } | null;
};

export type PartnershipInquiryHistoryEntry = {
  id: string;
  fromStatus: PartnershipInquiryStatusValue;
  toStatus: PartnershipInquiryStatusValue;
  actedById: string;
  actedByName: string;
  actedAt: Date;
  note: string | null;
  picChanged: boolean;
  picFromName: string | null;
  picToName: string | null;
};

export type PartnershipInquiryDetail = {
  id: string;
  companyName: string;
  contactName: string;
  contactEmail: string | null;
  contactPhone: string | null;
  companyAddress: string | null;
  companyNpwp: string | null;
  needs: string;
  status: PartnershipInquiryStatusValue;
  budgetRange: PartnershipBudgetRangeValue | null;
  periodStart: string | null;
  periodEnd: string | null;
  createdAt: Date;
  program: ProgramSummary;
  pic: Person | null;
  proposals: Array<{ id: string; label: string; contentType: string; sizeBytes: number; uploadedAt: Date }>;
  /** Oldest first. */
  history: PartnershipInquiryHistoryEntry[];
};

export type PartnershipInquiryUpdateResult = {
  inquiry: { id: string; status: PartnershipInquiryStatusValue; picId: string | null };
  change: {
    fromStatus: PartnershipInquiryStatusValue;
    toStatus: PartnershipInquiryStatusValue;
    actedById: string;
    actedAt: Date;
    note: string | null;
    picChanged: boolean;
    picFromId: string | null;
    picToId: string | null;
  };
};

type Where = Record<string, unknown>;
type Row = Record<string, unknown>;
type Args = { where?: Where; orderBy?: Record<string, "asc" | "desc">[]; select?: Row };

/** The delegates this module uses; the cast is the one place Prisma's types are narrowed. */
type InquiryDb = {
  partnershipInquiry: {
    findUnique(args: { where: Where; select?: Row }): Promise<Row | null>;
    findMany(args: Args): Promise<Row[]>;
    updateMany(args: { where: Where; data: Row }): Promise<{ count: number }>;
  };
  partnershipInquiryStatusChange: {
    create(args: { data: Row }): Promise<Row>;
    findMany(args: Args): Promise<Row[]>;
  };
  userAssignment: {
    findUnique(args: { where: Where }): Promise<Row | null>;
    findMany(args: { where: Where; select?: Row }): Promise<Row[]>;
  };
  document: { findMany(args: Args): Promise<Row[]> };
};

function delegatesOf(client: unknown): InquiryDb {
  return client as InquiryDb;
}

const NAME = { select: { id: true, name: true } } as const;
const PROGRAM = { select: { id: true, slug: true, title: true, sector: true } } as const;

const SUMMARY_SELECT = {
  id: true,
  companyName: true,
  contactName: true,
  status: true,
  budgetRange: true,
  periodStart: true,
  periodEnd: true,
  createdAt: true,
  updatedAt: true,
  program: PROGRAM,
  pic: NAME,
} as const;

// ==================== Commands ====================

type UpdateParams = {
  inquiryId: string;
  actorId: string;
  /** The stage to move to; absent leaves it where it is. */
  status?: unknown;
  /** The PIC's user id; `null` clears it; absent leaves it as it is. */
  picId?: unknown;
  /** The follow-up note; the reason when leaving Selesai or Tidak dilanjutkan. */
  note?: unknown;
  now?: Date;
};

function cleanNote(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.trim().length > MAX_INQUIRY_NOTE_LENGTH) throw new InvalidInquiryNoteError();
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Changes one Inquiry's stage and/or PIC, in a transaction that records the
 * change beside it, with the note.
 *
 * A request that would change neither is refused and writes nothing -- a no-op
 * recorded as a step would put an event in the log that never happened. One
 * request is one history entry, however many of the two things it changes.
 *
 * The write is predicated on the stage and PIC just read. Under READ COMMITTED,
 * two people changing the same Inquiry at once both pass the checks above, and
 * the loser's write matches no row: it is refused, and the log keeps one entry
 * per real change.
 */
export async function updatePartnershipInquiry(
  prisma: PrismaClient,
  params: UpdateParams,
): Promise<PartnershipInquiryUpdateResult> {
  if (params.status !== undefined && !isInquiryStatus(params.status)) {
    throw new InvalidInquiryStatusError(params.status, PARTNERSHIP_INQUIRY_STATUSES);
  }
  const wantedStatus = params.status as PartnershipInquiryStatusValue | undefined;
  if (params.picId !== undefined && params.picId !== null && typeof params.picId !== "string") {
    throw new InvalidInquiryPicError();
  }
  const wantedPic = params.picId as string | null | undefined;
  const note = cleanNote(params.note);
  const now = params.now ?? new Date();

  return prisma.$transaction(async (tx) => {
    const db = delegatesOf(tx);
    const inquiry = await db.partnershipInquiry.findUnique({
      where: { id: params.inquiryId },
      select: { id: true, status: true, picId: true },
    });
    if (!inquiry) throw new PartnershipInquiryNotFoundError();

    const from = inquiry.status as PartnershipInquiryStatusValue;
    const currentPic = (inquiry.picId as string | null) ?? null;
    const to = wantedStatus ?? from;
    const statusChanged = to !== from;
    const picChanged = wantedPic !== undefined && wantedPic !== currentPic;
    if (!statusChanged && !picChanged) throw new NothingToChangeError();

    if (statusChanged && inquiryTransitionNeedsReason(from, to) && note === null) {
      throw new InquiryReasonRequiredError(from);
    }
    if (picChanged && wantedPic !== null) {
      const admin = await db.userAssignment.findUnique({
        where: { userId_assignment: { userId: wantedPic, assignment: "ADMIN" } },
      });
      if (!admin) throw new InvalidInquiryPicError();
    }

    const newPic = picChanged ? (wantedPic as string | null) : currentPic;
    const written = await db.partnershipInquiry.updateMany({
      where: { id: inquiry.id, status: from, picId: currentPic },
      data: { status: to, picId: newPic },
    });
    if (written.count === 0) throw new ConcurrentInquiryStatusChangeError();

    const change = {
      fromStatus: from,
      toStatus: to,
      actedById: params.actorId,
      actedAt: now,
      note,
      picChanged,
      picFromId: picChanged ? currentPic : null,
      picToId: picChanged ? newPic : null,
    };
    await db.partnershipInquiryStatusChange.create({ data: { inquiryId: inquiry.id, ...change } });

    return { inquiry: { id: String(inquiry.id), status: to, picId: newPic }, change };
  });
}

// ==================== Reads ====================

/**
 * Every Inquiry the partnership team has been told about, newest first, with
 * the Program it is about, its PIC, and the step that last moved its stage.
 *
 * One query each for the Inquiries, their history and their proposals, rather
 * than a relation on every row: the later reads take the ids of the rows just
 * listed, so a pipeline of any size costs the same three round trips. The step
 * shown is the last one that changed the stage, found by ordering the log
 * newest first and keeping the first stage-changing entry per Inquiry -- a
 * PIC-only entry does not hide it, and an Inquiry nobody has moved says so
 * rather than showing a step that never happened.
 */
export async function listPartnershipInquiries(
  prisma: PrismaClient,
): Promise<PartnershipInquirySummary[]> {
  const db = delegatesOf(prisma);
  const rows = await db.partnershipInquiry.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: SUMMARY_SELECT,
  });
  if (rows.length === 0) return [];

  const ids = rows.map((row) => String(row.id));
  const [changes, proposals] = await Promise.all([
    db.partnershipInquiryStatusChange.findMany({
      where: { inquiryId: { in: ids } },
      orderBy: [{ actedAt: "desc" }, { id: "desc" }],
      select: {
        inquiryId: true,
        fromStatus: true,
        toStatus: true,
        actedById: true,
        actedAt: true,
        actedBy: NAME,
      },
    }),
    db.document.findMany({ where: { partnershipInquiryId: { in: ids } }, select: { partnershipInquiryId: true } }),
  ]);

  const lastOf = new Map<string, Row>();
  for (const change of changes) {
    if (change.fromStatus === change.toStatus) continue;
    const key = String(change.inquiryId);
    if (!lastOf.has(key)) lastOf.set(key, change);
  }
  const withProposal = new Set(proposals.map((p) => String(p.partnershipInquiryId)));

  return rows.map((row) => {
    const last = lastOf.get(String(row.id));
    return {
      id: String(row.id),
      companyName: row.companyName as string,
      contactName: row.contactName as string,
      status: row.status as PartnershipInquiryStatusValue,
      budgetRange: (row.budgetRange as PartnershipBudgetRangeValue | null) ?? null,
      periodStart: (row.periodStart as string | null) ?? null,
      periodEnd: (row.periodEnd as string | null) ?? null,
      hasProposal: withProposal.has(String(row.id)),
      pic: (row.pic as Person | null) ?? null,
      createdAt: row.createdAt as Date,
      updatedAt: row.updatedAt as Date,
      program: row.program as ProgramSummary,
      lastStatusChange: last
        ? {
            fromStatus: last.fromStatus as PartnershipInquiryStatusValue,
            toStatus: last.toStatus as PartnershipInquiryStatusValue,
            actedById: String(last.actedById),
            actedByName: (last.actedBy as Person).name,
            actedAt: last.actedAt as Date,
          }
        : null,
    };
  });
}

/**
 * One Inquiry in full, for an Admin: the contact, address and NPWP read back
 * from their ciphertext (ADR 0012 -- an Admin with panel access can read what a
 * stolen dump cannot), the company's own words, the PIC, the proposal PDFs (ids
 * only; the bytes are behind the document ACL) and the whole history.
 *
 * An Inquiry the retention job anonymised has no contact to read, so its
 * contact fields come back null rather than failing.
 */
export async function getPartnershipInquiryDetail(
  prisma: PrismaClient,
  inquiryId: string,
): Promise<PartnershipInquiryDetail> {
  const db = delegatesOf(prisma);
  const row = await db.partnershipInquiry.findUnique({
    where: { id: inquiryId },
    select: {
      ...SUMMARY_SELECT,
      needs: true,
      contactEmailCiphertext: true,
      contactEmailKeyId: true,
      contactPhoneCiphertext: true,
      contactPhoneKeyId: true,
      companyAddressCiphertext: true,
      companyAddressKeyId: true,
      companyNpwpCiphertext: true,
      companyNpwpKeyId: true,
      contactAnonymisedAt: true,
    },
  });
  if (!row) throw new PartnershipInquiryNotFoundError();

  const [changes, documents] = await Promise.all([
    db.partnershipInquiryStatusChange.findMany({
      where: { inquiryId },
      orderBy: [{ actedAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        fromStatus: true,
        toStatus: true,
        actedById: true,
        actedAt: true,
        note: true,
        picChanged: true,
        actedBy: NAME,
        picFrom: NAME,
        picTo: NAME,
      },
    }),
    db.document.findMany({
      where: { partnershipInquiryId: inquiryId },
      orderBy: [{ uploadedAt: "asc" }],
      select: { id: true, label: true, contentType: true, sizeBytes: true, uploadedAt: true },
    }),
  ]);

  const anonymised = row.contactAnonymisedAt != null;
  return {
    id: String(row.id),
    companyName: row.companyName as string,
    contactName: row.contactName as string,
    contactEmail: anonymised ? null : readInquiryContactEmail(row as never),
    contactPhone: anonymised ? null : readInquiryContactPhone(row as never),
    companyAddress: readInquiryCompanyAddress(row as never),
    companyNpwp: readInquiryCompanyNpwp(row as never),
    needs: row.needs as string,
    status: row.status as PartnershipInquiryStatusValue,
    budgetRange: (row.budgetRange as PartnershipBudgetRangeValue | null) ?? null,
    periodStart: (row.periodStart as string | null) ?? null,
    periodEnd: (row.periodEnd as string | null) ?? null,
    createdAt: row.createdAt as Date,
    program: row.program as ProgramSummary,
    pic: (row.pic as Person | null) ?? null,
    proposals: documents as PartnershipInquiryDetail["proposals"],
    history: changes.map((c) => ({
      id: String(c.id),
      fromStatus: c.fromStatus as PartnershipInquiryStatusValue,
      toStatus: c.toStatus as PartnershipInquiryStatusValue,
      actedById: String(c.actedById),
      actedByName: (c.actedBy as Person).name,
      actedAt: c.actedAt as Date,
      note: (c.note as string | null) ?? null,
      picChanged: Boolean(c.picChanged),
      picFromName: (c.picFrom as Person | null)?.name ?? null,
      picToName: (c.picTo as Person | null)?.name ?? null,
    })),
  };
}

/** The people who may be named PIC: users holding the ADMIN assignment, by name. */
export async function listPartnershipPicCandidates(prisma: PrismaClient): Promise<Person[]> {
  const rows = await delegatesOf(prisma).userAssignment.findMany({
    where: { assignment: "ADMIN" },
    select: { user: NAME },
  });
  return rows
    .map((row) => row.user as Person)
    .sort((a, b) => a.name.localeCompare(b.name, "id"));
}
