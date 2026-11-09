import type { PartnershipInquiry, PrismaClient, Program } from "@/generated/prisma/client";
import {
  sealInquiryCompanyAddress,
  sealInquiryCompanyNpwp,
  sealInquiryContactEmail,
  sealInquiryContactPhone,
} from "./contact-fields";
import { MailerNotConfiguredError, sendReportingFailure, type Mailer } from "./mail";
import { partnershipInquiryConfirmationEmail, partnershipInquiryEmail } from "./mail/partnership-inquiry";
import { publicUrl } from "./public-url";
import { assertInquiryProposalAcceptable, DocumentRefusedError, uploadInquiryProposal } from "./documents";

/**
 * Partnership Inquiries (ticket csr-05; CONTEXT.md, Partnership Inquiry): a
 * company asks to discuss a collaboration on one Program, and the partnership
 * team is told about it. An Inquiry is not a Program and moves no money -- the
 * Program it points at takes none online (ADR 0002) -- so nothing here reaches
 * Donation, Payment, Refund, Payout, or the ledger.
 *
 * The notification goes out through the existing Mailer seam and no second
 * one: the same seam every Receipt, reminder, and Verification Request
 * decision already uses.
 */

/** The env var naming where Partnership Inquiry notifications go. */
export const PARTNERSHIP_TEAM_EMAIL_ENV = 'PARTNERSHIP_TEAM_EMAIL';

// The follow-up vocabulary lives in its own leaf module, which the Admin
// queue can import without dragging the Mailer (and nodemailer) into a browser
// bundle. Re-exported here so this seam still says what it always said.
export {
  PARTNERSHIP_INQUIRY_STATUSES,
  INITIAL_INQUIRY_STATUS,
  type PartnershipInquiryStatusValue,
} from './partnership-inquiry-status';

import { INITIAL_INQUIRY_STATUS, isBudgetRange, type PartnershipBudgetRangeValue } from './partnership-inquiry-status';

export class PartnershipInquiryProgramNotFoundError extends Error {
  constructor() {
    super('Program yang ditanyakan tidak ditemukan.');
    this.name = 'PartnershipInquiryProgramNotFoundError';
  }
}

export class InvalidPartnershipInquiryInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidPartnershipInquiryInputError';
  }
}

/** The HTTP answer for a refusal from this module, or null for anything else. */
export function partnershipInquiryErrorToHttp(error: unknown): { status: number; error: string } | null {
  if (error instanceof PartnershipInquiryProgramNotFoundError) {
    return { status: 404, error: error.message };
  }
  if (error instanceof InvalidPartnershipInquiryInputError) {
    return { status: 400, error: error.message };
  }
  // Only the "storage not configured" refusal escapes the create path; a bad
  // file is turned into a 400 above it.
  if (error instanceof DocumentRefusedError) {
    return { status: error.status, error: error.message };
  }
  return null;
}

const MAX_ID_LENGTH = 100;
const MAX_NAME_LENGTH = 200;
const MAX_EMAIL_LENGTH = 254;
const MAX_PHONE_LENGTH = 50;
const MAX_NEEDS_LENGTH = 5000;
const MAX_ADDRESS_LENGTH = 500;

/** A calendar month as "YYYY-MM", the shape of an <input type="month">. */
const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** An optional budget range: one of the platform's ranges, never a free figure. */
function cleanBudgetRange(value: unknown): PartnershipBudgetRangeValue | null {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) return null;
  if (!isBudgetRange(value)) throw new InvalidPartnershipInquiryInputError('Kisaran anggaran tidak dikenal.');
  return value;
}

/** The planned period: both months or neither, and the end not before the start. */
function cleanPeriod(start: unknown, end: unknown): { periodStart: string | null; periodEnd: string | null } {
  const blank = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
  if (blank(start) && blank(end)) return { periodStart: null, periodEnd: null };
  if (blank(start) || blank(end)) {
    throw new InvalidPartnershipInquiryInputError('Periode harus berisi bulan mulai dan bulan selesai.');
  }
  if (typeof start !== 'string' || typeof end !== 'string' || !MONTH.test(start.trim()) || !MONTH.test(end.trim())) {
    throw new InvalidPartnershipInquiryInputError('Periode harus berupa bulan dengan format TTTT-BB.');
  }
  const periodStart = start.trim();
  const periodEnd = end.trim();
  if (periodEnd < periodStart) {
    throw new InvalidPartnershipInquiryInputError('Bulan selesai tidak boleh sebelum bulan mulai.');
  }
  return { periodStart, periodEnd };
}

/** An optional NPWP, kept as its digits: 15 (old format) or 16 (NIK-based) of them. */
function cleanNpwp(value: unknown): string | null {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) return null;
  if (typeof value !== 'string') throw new InvalidPartnershipInquiryInputError('NPWP harus berupa teks.');
  const digits = value.replace(/[.\-\s]/g, '');
  if (!/^\d{15,16}$/.test(digits)) {
    throw new InvalidPartnershipInquiryInputError('NPWP harus terdiri dari 15 atau 16 digit.');
  }
  return digits;
}

/**
 * Deliberately loose, and answering one question only: is there a single `@`
 * and a dot after it. It guards what a company typed -- will the partnership
 * team be able to hit reply -- and where the notification is configured, not
 * whether a mailbox exists. The real addresses are the owner's to supply.
 */
function isEmailLike(value: string): boolean {
  return /^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$/.test(value);
}

function cleanText(
  value: unknown,
  { field, max, required, nullable = false }: { field: string; max: number; required: boolean; nullable?: boolean },
): string | null | undefined {
  if (value === undefined) {
    if (required) throw new InvalidPartnershipInquiryInputError(`${field} wajib diisi.`);
    return undefined;
  }
  if (value === null || (typeof value === 'string' && value.trim() === '')) {
    if (nullable) return null;
    throw new InvalidPartnershipInquiryInputError(`${field} wajib diisi.`);
  }
  if (typeof value !== 'string') throw new InvalidPartnershipInquiryInputError(`${field} harus berupa teks.`);
  const trimmed = value.trim();
  if (trimmed.length > max) {
    throw new InvalidPartnershipInquiryInputError(`${field} paling panjang ${max} karakter.`);
  }
  return trimmed;
}

function cleanProgramId(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new InvalidPartnershipInquiryInputError('Program yang ditanyakan wajib diisi.');
  }
  const id = value.trim();
  if (id.length > MAX_ID_LENGTH) {
    throw new InvalidPartnershipInquiryInputError('Program yang ditanyakan tidak valid.');
  }
  return id;
}

function cleanContactEmail(value: unknown): string {
  const email = cleanText(value, { field: 'Email narahubung', max: MAX_EMAIL_LENGTH, required: true }) as string;
  if (!isEmailLike(email)) throw new InvalidPartnershipInquiryInputError('Email narahubung tidak valid.');
  return email;
}

export type PartnershipInquiryCreateInput = {
  programId: unknown;
  companyName: unknown;
  contactName: unknown;
  contactEmail: unknown;
  contactPhone?: unknown;
  needs: unknown;
  /** pks-pemenuhan/17, all optional: budget range, period, address and NPWP. */
  budgetRange?: unknown;
  periodStart?: unknown;
  periodEnd?: unknown;
  companyAddress?: unknown;
  companyNpwp?: unknown;
};

type CleanedInquiry = {
  programId: string;
  companyName: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string | null;
  needs: string;
  budgetRange: PartnershipBudgetRangeValue | null;
  periodStart: string | null;
  periodEnd: string | null;
  companyAddress: string | null;
  companyNpwp: string | null;
};

/** The Program fields the notification quotes; nothing else about it is read. */
type InquiryProgram = Pick<Program, "id" | "title" | "sector">;

type InquiryDelegate = {
  create(args: { data: Record<string, unknown> }): Promise<PartnershipInquiry>;
};

type Db = PrismaClient & {
  program: { findUnique(args: { where: Record<string, unknown> }): Promise<InquiryProgram | null> };
  partnershipInquiry: InquiryDelegate;
};

function delegatesOf(prisma: PrismaClient): Db {
  return prisma as unknown as Db;
}

/**
 * Where Partnership Inquiry notifications go, or null when there is nowhere to
 * send them. The address is configuration with no default, the way MAIL_FROM is
 * (src/lib/mail): the real one is the owner's to supply, and the mock Mailer
 * used in development and tests delivers nothing anyway.
 *
 * Loud in production, quiet in development: a platform that has no address
 * configured must not pretend a notification went out, and a developer running
 * the platform locally should not have to configure one to submit a form.
 */
export function partnershipTeamRecipient(): string | null {
  const value = process.env[PARTNERSHIP_TEAM_EMAIL_ENV];
  if (!value || value.trim() === '') {
    if (process.env.NODE_ENV === 'production') {
      throw new MailerNotConfiguredError(`${PARTNERSHIP_TEAM_EMAIL_ENV} is not set`);
    }
    return null;
  }
  const address = value.trim();
  if (!isEmailLike(address)) {
    throw new MailerNotConfiguredError(`${PARTNERSHIP_TEAM_EMAIL_ENV} is not an email address`);
  }
  return address;
}

/**
 * Creates a Partnership Inquiry against an existing Program and tells the
 * partnership team about it.
 *
 * The notification is best-effort by design, like every other mail this
 * platform sends: the Inquiry is the fact being reported, and a company that
 * asked to discuss a collaboration has asked whether or not our provider is
 * having a good day. So a refused or unconfigured send is logged as one JSON
 * line naming the Inquiry, and the Inquiry stands. A duplicate submission is
 * the one outcome worth more than a lost notification, and 201 tells the
 * company their Inquiry is in.
 *
 * `mailer` is the platform's configured Mailer unless a test passes its own.
 */
export async function createPartnershipInquiry(
  prisma: PrismaClient,
  input: PartnershipInquiryCreateInput,
  mailer?: Mailer,
  /**
   * Runs once the input is valid and the Program exists, immediately before
   * the write. A route uses it for limits that should count only submissions
   * that would otherwise be recorded (csr-06b); throwing from it refuses.
   */
  beforeWrite?: () => Promise<void>,
  /**
   * Set only by a verified Tim CSR member's own code path (src/lib/tim-csr.ts),
   * never from a request body: the public form's input type has no such field
   * and `input` is not read for it.
   */
  options?: {
    companyId?: string;
    /**
     * The proposal PDF (pks-pemenuhan/17). Checked before anything is written;
     * stored as a private Document of the Inquiry once it exists.
     */
    proposal?: { bytes: Uint8Array; declaredType: string; size: number };
    /** The Tim CSR member's user id; absent for the public form, which has no account. */
    uploadedById?: string;
  },
): Promise<PartnershipInquiry & { proposalStored: boolean }> {
  const db = delegatesOf(prisma);
  const programId = cleanProgramId(input.programId);
  const cleaned: CleanedInquiry = {
    programId,
    companyName: cleanText(input.companyName, { field: 'Nama perusahaan', max: MAX_NAME_LENGTH, required: true }) as string,
    contactName: cleanText(input.contactName, { field: 'Nama narahubung', max: MAX_NAME_LENGTH, required: true }) as string,
    contactEmail: cleanContactEmail(input.contactEmail),
    contactPhone:
      (cleanText(input.contactPhone, {
        field: 'Telepon',
        max: MAX_PHONE_LENGTH,
        required: false,
        nullable: true,
      }) as string | null | undefined) ?? null,
    needs: cleanText(input.needs, { field: 'Kebutuhan yang disampaikan', max: MAX_NEEDS_LENGTH, required: true }) as string,
    budgetRange: cleanBudgetRange(input.budgetRange),
    ...cleanPeriod(input.periodStart, input.periodEnd),
    companyAddress:
      (cleanText(input.companyAddress, {
        field: 'Alamat perusahaan',
        max: MAX_ADDRESS_LENGTH,
        required: false,
        nullable: true,
      }) as string | null | undefined) ?? null,
    companyNpwp: cleanNpwp(input.companyNpwp),
  };

  const program = await db.program.findUnique({ where: { id: programId } });
  if (!program) throw new PartnershipInquiryProgramNotFoundError();
  if (options?.proposal) {
    try {
      assertInquiryProposalAcceptable(options.proposal);
    } catch (error) {
      // A file that is not an acceptable PDF is a mistake in the form: 400.
      // A store that is not configured is ours: it stays the 503 it is.
      if (error instanceof DocumentRefusedError && error.status !== 503) {
        throw new InvalidPartnershipInquiryInputError(error.message);
      }
      throw error;
    }
  }
  await beforeWrite?.();

  // The contact details are sealed here, and the plaintext is not part of the
  // write at all: the columns are gone (ADR 0012, contract step). The email
  // below is built from the same cleaned value, so the notification names the
  // address the company typed.
  const inquiry = await db.partnershipInquiry.create({
    data: {
      programId: cleaned.programId,
      companyName: cleaned.companyName,
      contactName: cleaned.contactName,
      needs: cleaned.needs,
      status: INITIAL_INQUIRY_STATUS,
      budgetRange: cleaned.budgetRange,
      periodStart: cleaned.periodStart,
      periodEnd: cleaned.periodEnd,
      ...sealInquiryCompanyAddress(cleaned.companyAddress),
      ...sealInquiryCompanyNpwp(cleaned.companyNpwp),
      ...(options?.companyId ? { companyId: options.companyId } : {}),
      ...sealInquiryContactEmail(cleaned.contactEmail),
      ...sealInquiryContactPhone(cleaned.contactPhone),
    },
  });
  const inquiryId = String(inquiry.id);

  // The Inquiry stands whether or not the attachment does: a company that asked
  // to discuss a collaboration has asked, and a retry would file it twice.
  let proposalStored = false;
  if (options?.proposal) {
    try {
      await uploadInquiryProposal(prisma, {
        inquiryId,
        uploadedById: options.uploadedById ?? null,
        file: options.proposal,
      });
      proposalStored = true;
    } catch (error) {
      console.error(
        JSON.stringify({
          event: 'partnership_inquiry_proposal_not_stored',
          inquiryId,
          error: error instanceof Error ? error.name : 'UnknownError',
        }),
      );
    }
  }

  await notifyPartnershipTeam(cleaned, program, inquiryId, mailer);

  // The company's own confirmation (ticket E9/01, tahap 1), sent whether or
  // not the team's address is configured: it goes to the address the
  // company typed, through the same best-effort send.
  await sendReportingFailure(
    partnershipInquiryConfirmationEmail({
      to: cleaned.contactEmail,
      companyName: cleaned.companyName,
      contactName: cleaned.contactName,
      programTitle: program.title,
    }),
    { mail: 'partnership_inquiry_confirmation', inquiryId },
    mailer,
  );
  return { ...inquiry, proposalStored };
}

async function notifyPartnershipTeam(
  cleaned: CleanedInquiry,
  program: { title: string; sector: string },
  inquiryId: string,
  mailer?: Mailer,
): Promise<void> {
  let recipient: string | null;
  try {
    recipient = partnershipTeamRecipient();
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'mail_not_configured',
        mail: 'partnership_inquiry',
        inquiryId,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return;
  }
  if (recipient === null) return;

  await sendReportingFailure(
    partnershipInquiryEmail({
      to: recipient,
      companyName: cleaned.companyName,
      contactName: cleaned.contactName,
      contactEmail: cleaned.contactEmail,
      contactPhone: cleaned.contactPhone,
      programTitle: program.title,
      programSector: program.sector,
      needs: cleaned.needs,
      inquiryUrl: publicUrl(`/admin/partnership-inquiries/${encodeURIComponent(inquiryId)}`),
    }),
    // The report names the Inquiry, never the recipient's address, so the log
    // line stays safe to keep and to read aloud in an incident.
    { mail: 'partnership_inquiry', inquiryId },
    mailer,
  );
}
