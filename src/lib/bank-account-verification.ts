import { Prisma, VerificationOutcome } from "@/generated/prisma/client";
import type { BankAccount, BankAccountVerificationRequest, PrismaClient } from "@/generated/prisma/client";
import { sealBankAccountNumber } from "./contact-fields";
import {
  BankAccountAlreadyVerifiedError,
  BankAccountDecisionInvalidError,
  BankAccountNotDeletableError,
  BankAccountNotFoundError,
  BankAccountVerificationAlreadyPendingError,
  BankAccountVerificationNotPendingError,
  BankAccountVerificationRequestNotFoundError,
  InvalidBankAccountError,
  OwnBankAccountVerificationError,
} from "./bank-account-verification-errors";

/**
 * A person creates their own Bank Account, submits it to a Verifier, and may
 * withdraw or delete it; a Verifier decides a submission (ticket 16; ADR
 * 0018). Ownership is checked here, in every command, not only by the
 * route that calls it -- decision 5 is a rule about the row, and a rule that
 * lives only in a route or a React component is not a rule.
 *
 * `verifiedAt` on BankAccount is written only by `decideBankAccountVerification`
 * approving, through a conditional `updateMany` that throws on `count === 0`
 * (the same guard `closeRequest` in ./campaign-lifecycle.ts uses), and never
 * by submitting, withdrawing, or the seed. There is deliberately no `FOR
 * UPDATE` on BankAccount and no LedgerSubject entry for it: a bank account is
 * not a ledger subject, and the property test that pins row locks
 * (src/__tests__/properties/subject-lock-single-owner.test.ts) only covers
 * Campaign, VolunteerTrip, Batch and Registration.
 *
 * No uniqueness is promised on the account number and none is invented here
 * (see BankAccount's own schema comment): two accounts may share a number,
 * and the compensation is that a Payout is checked against the account
 * verified before it is approved (payouts.ts), unchanged by this module.
 */

type Tx = Prisma.TransactionClient;

const MAX_TEXT_LENGTH = 200;

function cleanText(raw: unknown, label: string, field: string, max = MAX_TEXT_LENGTH): string {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (text === "") throw new InvalidBankAccountError(`${label} wajib diisi.`, field);
  if (text.length > max) throw new InvalidBankAccountError(`${label} maksimal ${max} karakter.`, field);
  return text;
}

/** A required decision field (decision 2): 422, fixable by filling the form in, unlike a malformed create input. */
function cleanDecisionText(raw: unknown, label: string, field: string, max = MAX_TEXT_LENGTH): string {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (text === "") throw new BankAccountDecisionInvalidError(`${label} wajib diisi.`, field);
  if (text.length > max) throw new BankAccountDecisionInvalidError(`${label} maksimal ${max} karakter.`, field);
  return text;
}

/** `note` on an approval: optional, trimmed to null when blank. */
function optionalNote(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  const text = typeof raw === "string" ? raw.trim() : "";
  if (text === "") return null;
  if (text.length > 1000) {
    throw new InvalidBankAccountError("Catatan maksimal 1000 karakter.", "note");
  }
  return text;
}

/**
 * The owner's own account, or the 404 that also covers "not yours": a route
 * never tells a caller whose account an id belongs to.
 */
async function loadOwnedBankAccount(tx: Tx, accountId: string, ownerId: string): Promise<BankAccount> {
  const account = await tx.bankAccount.findUnique({ where: { id: accountId } });
  if (!account || account.ownerId !== ownerId) throw new BankAccountNotFoundError();
  return account;
}

// ==================== Owner's commands ====================

/**
 * A signed-in person adds their own Bank Account, born unverified (ADR
 * 0018). Any signed-in user may do this: `Assignment` holds only VERIFIER and
 * ADMIN, so ownership is the rule, not an assignment (ticket 16). The number
 * is sealed (./contact-fields.ts, ADR 0012) and never returned or logged in
 * plaintext.
 */
export async function createBankAccount(
  prisma: Pick<PrismaClient, "bankAccount">,
  params: { ownerId: string; bankCode: unknown; accountName: unknown; accountNumber: unknown }
): Promise<BankAccount> {
  const bankCode = cleanText(params.bankCode, "Kode bank", "bankCode", 50);
  const accountName = cleanText(params.accountName, "Nama pemilik rekening", "accountName");
  const accountNumber = cleanText(params.accountNumber, "Nomor rekening", "accountNumber", 64);
  return prisma.bankAccount.create({
    data: {
      ownerId: params.ownerId,
      bankCode,
      accountName,
      ...sealBankAccountNumber(accountNumber),
    },
  });
}

/**
 * Submits the account for a Verifier to check (flow step 2). Refused when it
 * already has a `verifiedAt` (decision 1's "checked once") or an existing
 * PENDING request; a REJECTED or WITHDRAWN account may be submitted again,
 * which opens a new row and keeps the old one, the same history rule a
 * resubmitted Campaign follows.
 */
export async function submitBankAccountVerification(
  prisma: PrismaClient,
  params: { accountId: string; ownerId: string; now?: Date }
): Promise<BankAccountVerificationRequest> {
  const now = params.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    const account = await loadOwnedBankAccount(tx, params.accountId, params.ownerId);
    if (account.verifiedAt !== null) throw new BankAccountAlreadyVerifiedError();
    const pending = await tx.bankAccountVerificationRequest.findFirst({
      where: { bankAccountId: account.id, outcome: VerificationOutcome.PENDING },
    });
    if (pending) throw new BankAccountVerificationAlreadyPendingError();
    const request = await tx.bankAccountVerificationRequest.create({
      data: { bankAccountId: account.id, submittedById: params.ownerId, submittedAt: now },
    });
    // The owner's own confirmation that their submission went through, the
    // same shape as the withdraw confirmation a Fundraiser gets for their own
    // action on a Campaign (campaign-lifecycle.ts): there is no per-Verifier
    // recipient to notify, since a Verifier reads the queue directly.
    await tx.notification.create({
      data: {
        type: "bank_account_verification",
        userId: params.ownerId,
        title: "Rekening Diajukan untuk Verifikasi",
        message: `Rekening ${account.bankCode} Anda telah diajukan untuk diverifikasi.`,
        link: "/akun/rekening",
      },
    });
    return request;
  });
}

/**
 * Withdraws the account's own PENDING request, if it has one (flow step 2).
 * Throws `BankAccountVerificationNotPendingError` when there is none to
 * withdraw -- covering both "never submitted" and "already decided", the
 * same conditional-write guard `closeRequest` uses.
 */
export async function withdrawBankAccountVerification(
  prisma: PrismaClient,
  params: { accountId: string; ownerId: string; now?: Date }
): Promise<BankAccountVerificationRequest> {
  const now = params.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    const account = await loadOwnedBankAccount(tx, params.accountId, params.ownerId);
    const pending = await tx.bankAccountVerificationRequest.findFirst({
      where: { bankAccountId: account.id, outcome: VerificationOutcome.PENDING },
    });
    if (!pending) throw new BankAccountVerificationNotPendingError();
    const written = await tx.bankAccountVerificationRequest.updateMany({
      where: { id: pending.id, outcome: VerificationOutcome.PENDING },
      data: { outcome: VerificationOutcome.WITHDRAWN, decidedById: params.ownerId, decidedAt: now },
    });
    if (written.count === 0) throw new BankAccountVerificationNotPendingError();
    return { ...pending, outcome: VerificationOutcome.WITHDRAWN, decidedById: params.ownerId, decidedAt: now };
  });
}

/**
 * Deletes the account (decision 5). Refused unless `verifiedAt` is null AND
 * it has no BankAccountVerificationRequest row of any outcome -- both halves
 * checked in one read here, and the count is never filtered by outcome:
 * REJECTED and WITHDRAWN block the delete exactly as PENDING does. There is
 * no edit path anywhere: a wrong number is fixed by deleting and re-adding.
 */
export async function deleteBankAccount(
  prisma: PrismaClient,
  params: { accountId: string; ownerId: string }
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const account = await loadOwnedBankAccount(tx, params.accountId, params.ownerId);
    const requestCount = await tx.bankAccountVerificationRequest.count({
      where: { bankAccountId: account.id },
    });
    if (account.verifiedAt !== null || requestCount > 0) {
      throw new BankAccountNotDeletableError();
    }
    await tx.bankAccount.delete({ where: { id: account.id } });
  });
}

// ==================== Verifier's decision ====================

export type BankAccountDecision = "approve" | "reject";

/**
 * A Verifier decides a PENDING request (flow step 4; decision 2, 5, 6).
 * Approval requires `checkedBankCode` and `documentedAccountName` (what was
 * read off the document) and writes `verifiedAt` on the account through a
 * conditional `updateMany` (`where: { verifiedAt: null }`), throwing when
 * `count === 0` -- approval is the only writer of `verifiedAt`, and this
 * guard is what keeps that true under a race. A rejection requires a reason;
 * the schema has one free-text column, `note`, not two, so a rejection's
 * required reason is written there instead of into a column this table does
 * not have (a decision this ticket had to make, not specified by the spec's
 * own schema section). A Verifier may never decide their own account (ADR
 * 0018), checked here rather than left to the UI.
 */
export async function decideBankAccountVerification(
  prisma: PrismaClient,
  params: {
    requestId: string;
    verifierId: string;
    decision: BankAccountDecision;
    checkedBankCode?: unknown;
    documentedAccountName?: unknown;
    note?: unknown;
    reason?: unknown;
    now?: Date;
  }
): Promise<BankAccountVerificationRequest> {
  const now = params.now ?? new Date();

  return prisma.$transaction(async (tx) => {
    const request = await tx.bankAccountVerificationRequest.findUnique({ where: { id: params.requestId } });
    if (!request) throw new BankAccountVerificationRequestNotFoundError();
    const account = await tx.bankAccount.findUnique({ where: { id: request.bankAccountId } });
    if (!account) throw new BankAccountNotFoundError();
    // Same shape as requireNotOwnerAsAdmin/OwnSubjectConflictError for a
    // Campaign or Volunteer Trip (./capacity.ts), put in the command rather
    // than the route, as ADR 0018 requires.
    if (account.ownerId === params.verifierId) throw new OwnBankAccountVerificationError();

    const data: {
      outcome: VerificationOutcome;
      checkedBankCode: string | null;
      documentedAccountName: string | null;
      note: string | null;
      decidedById: string;
      decidedAt: Date;
    } =
      params.decision === "approve"
        ? {
            outcome: VerificationOutcome.APPROVED,
            checkedBankCode: cleanDecisionText(params.checkedBankCode, "Kode bank pada dokumen", "checkedBankCode", 50),
            documentedAccountName: cleanDecisionText(
              params.documentedAccountName,
              "Nama pada dokumen",
              "documentedAccountName"
            ),
            note: optionalNote(params.note),
            decidedById: params.verifierId,
            decidedAt: now,
          }
        : {
            outcome: VerificationOutcome.REJECTED,
            checkedBankCode: null,
            documentedAccountName: null,
            note: cleanRejectionReason(params.reason),
            decidedById: params.verifierId,
            decidedAt: now,
          };

    const closed = await tx.bankAccountVerificationRequest.updateMany({
      where: { id: request.id, outcome: VerificationOutcome.PENDING },
      data,
    });
    if (closed.count === 0) throw new BankAccountVerificationNotPendingError();

    if (params.decision === "approve") {
      // The only writer of verifiedAt, ever (ADR 0018): not the submit path,
      // not an Admin route, not the seed. Conditional so a race with another
      // approval of the same account throws instead of overwriting.
      const verified = await tx.bankAccount.updateMany({
        where: { id: account.id, verifiedAt: null },
        data: { verifiedAt: now },
      });
      if (verified.count === 0) throw new BankAccountAlreadyVerifiedError();
    }

    await tx.notification.create({
      data: {
        type: "bank_account_verification",
        userId: account.ownerId,
        title: params.decision === "approve" ? "Rekening Disetujui" : "Rekening Ditolak",
        message:
          params.decision === "approve"
            ? `Rekening ${account.bankCode} Anda telah disetujui Verifier.`
            : `Rekening ${account.bankCode} Anda ditolak Verifier. Alasan: ${data.note}`,
        link: "/akun/rekening",
      },
    });

    return { ...request, ...data };
  });
}

/** A rejection's required reason (decision 2), written into the request's `note` column. */
function cleanRejectionReason(raw: unknown): string {
  return cleanDecisionText(raw, "Alasan penolakan", "reason", 1000);
}
