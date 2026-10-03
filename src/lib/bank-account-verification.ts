import { BankAccountRevocationAction, Prisma, VerificationOutcome } from "@/generated/prisma/client";
import type {
  BankAccount,
  BankAccountRevocation,
  BankAccountVerificationRequest,
  PrismaClient,
} from "@/generated/prisma/client";
import { sealBankAccountNumber, SELECT_BANK_ACCOUNT_NUMBER } from "./contact-fields";
import {
  BankAccountAlreadyVerifiedError,
  BankAccountDecisionInvalidError,
  BankAccountNotDeletableError,
  BankAccountNotFoundError,
  BankAccountNotReinstatableError,
  BankAccountNotRevocableError,
  BankAccountVerificationAlreadyPendingError,
  BankAccountVerificationNotPendingError,
  BankAccountVerificationRequestNotFoundError,
  InvalidBankAccountError,
  OwnBankAccountVerificationError,
  ReinstaterWasRevokerError,
  RevokerWasApproverError,
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
 *
 * Notification is in-app only, on submit and on decision. No email:
 * `decideVerificationRequest` (campaign-lifecycle.ts) emails through a
 * template built around `/campaign/[slug]`, and there is no bank-account
 * template. Inventing one is not this ticket's work, so this is a stated
 * choice, not an oversight.
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
    // The findFirst above is the friendly refusal; the partial unique index
    // "BankAccountVerificationRequest_bankAccountId_pending_key" is the rule.
    // Two submissions racing past the check both reach this create, and the
    // index keeps the first: the loser's P2002 is the same refusal.
    const request = await tx.bankAccountVerificationRequest
      .create({ data: { bankAccountId: account.id, submittedById: params.ownerId, submittedAt: now } })
      .catch((error: unknown) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          throw new BankAccountVerificationAlreadyPendingError();
        }
        throw error;
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

// ==================== The Verifier's queue (flow step 3) ====================

/** One row of the Verifier queue: the request, its account, and the account's ciphertext (never decrypted here). */
export type PendingBankAccountVerification = {
  id: string;
  submittedAt: Date;
  bankAccount: {
    id: string;
    bankCode: string;
    accountName: string;
    ownerId: string;
    ownerName: string;
    accountNumberCiphertext: string;
    accountNumberKeyId: string;
  };
};

/**
 * Every PENDING BankAccountVerificationRequest, oldest first (flow step 3).
 * Shared by `GET /api/moderasi/bank-accounts` (which masks the number) and
 * `/moderasi/rekening` (which additionally decrypts the full number,
 * server-rendered, for the decide panel -- decision 6) so the two do not
 * each hand-roll the same query and include shape.
 */
export async function pendingBankAccountVerifications(
  prisma: Pick<PrismaClient, "bankAccountVerificationRequest">
): Promise<PendingBankAccountVerification[]> {
  const requests = await prisma.bankAccountVerificationRequest.findMany({
    where: { outcome: VerificationOutcome.PENDING },
    orderBy: { submittedAt: "asc" },
    include: {
      bankAccount: {
        select: {
          id: true,
          bankCode: true,
          accountName: true,
          ownerId: true,
          owner: { select: { name: true } },
          ...SELECT_BANK_ACCOUNT_NUMBER,
        },
      },
    },
  });
  return requests.map((request) => ({
    id: request.id,
    submittedAt: request.submittedAt,
    bankAccount: {
      id: request.bankAccount.id,
      bankCode: request.bankAccount.bankCode,
      accountName: request.bankAccount.accountName,
      ownerId: request.bankAccount.ownerId,
      ownerName: request.bankAccount.owner.name,
      accountNumberCiphertext: request.bankAccount.accountNumberCiphertext,
      accountNumberKeyId: request.bankAccount.accountNumberKeyId,
    },
  }));
}

// ==================== Revocation (ticket 11; owner decision 2026-09-28) ====================

/**
 * The account's own revoke/reinstate history, latest first: `null` when the
 * account has never been touched. Its `.action` is what says whether the
 * account is currently revoked (REVOKED) or was restored after being
 * revoked (REINSTATED) -- `BankAccount.verifiedAt` itself already says
 * whether the account is eligible right now; this is only the "why" and
 * "who" of the last time that changed.
 */
async function latestRevocation(tx: Tx, bankAccountId: string): Promise<BankAccountRevocation | null> {
  return tx.bankAccountRevocation.findFirst({
    where: { bankAccountId },
    orderBy: { createdAt: "desc" },
  });
}

/** A revoke or reinstate's required reason: 422, fixable by filling the form in, the same shape as a rejection's. */
function cleanRevocationReason(raw: unknown): string {
  return cleanDecisionText(raw, "Alasan", "reason", 1000);
}

/**
 * A Verifier revokes a verified Bank Account's eligibility, with a reason
 * (ticket 11; owner decision (b) on top of ADR 0018): clears `verifiedAt`
 * and writes a REVOKED row. Refused when the account has no `verifiedAt` to
 * clear (`BankAccountNotRevocableError`, covering both "never verified" and
 * "already revoked"), when the acting Verifier is the account's owner
 * (`OwnBankAccountVerificationError`, same rule as deciding), and when the
 * acting Verifier is the one who most recently approved this account's
 * verification (`RevokerWasApproverError`) -- symmetric with ticket 16's "a
 * Verifier tak menilai rekeningnya sendiri", applied to the person who
 * already vouched for it once.
 *
 * Revoking is a separate action from Suspension: nothing here touches a
 * Campaign, a Flag, or the ledger. Payouts already completed are untouched
 * by design -- this function never reads or writes Payout. An unpaid Payout
 * pointed at this account is stopped the next time it is checked, through
 * `payouts.ts`'s existing `BankAccountNotEligibleError` path (requestPayout,
 * approvePayout and completePayout all re-read `verifiedAt` fresh from the
 * row); nothing here needs to change for that to hold.
 */
export async function revokeBankAccountVerification(
  prisma: PrismaClient,
  params: { accountId: string; verifierId: string; reason: unknown; now?: Date }
): Promise<BankAccountRevocation> {
  const now = params.now ?? new Date();
  const reason = cleanRevocationReason(params.reason);

  return prisma.$transaction(async (tx) => {
    const account = await tx.bankAccount.findUnique({ where: { id: params.accountId } });
    if (!account) throw new BankAccountNotFoundError();
    if (account.ownerId === params.verifierId) throw new OwnBankAccountVerificationError();

    // The Verifier who most recently approved this account, if any -- never
    // the one allowed to revoke it themselves.
    const approval = await tx.bankAccountVerificationRequest.findFirst({
      where: { bankAccountId: account.id, outcome: VerificationOutcome.APPROVED },
      orderBy: { decidedAt: "desc" },
    });
    if (approval?.decidedById === params.verifierId) throw new RevokerWasApproverError();

    // Conditional write, the same guard as decideBankAccountVerification's
    // own approval: throws under a race with a concurrent revoke of the
    // same account, and refuses outright when there was nothing to clear.
    const cleared = await tx.bankAccount.updateMany({
      where: { id: account.id, verifiedAt: { not: null } },
      data: { verifiedAt: null },
    });
    if (cleared.count === 0) throw new BankAccountNotRevocableError();

    const revocation = await tx.bankAccountRevocation.create({
      data: {
        bankAccountId: account.id,
        action: BankAccountRevocationAction.REVOKED,
        reason,
        actorId: params.verifierId,
        createdAt: now,
      },
    });

    await tx.notification.create({
      data: {
        type: "bank_account_verification",
        userId: account.ownerId,
        title: "Verifikasi Rekening Dicabut",
        message: `Verifikasi rekening ${account.bankCode} Anda dicabut oleh Verifier. Alasan: ${reason}`,
        link: "/akun/rekening",
      },
    });

    return revocation;
  });
}

/**
 * A different Verifier than the one who revoked it reinstates a Bank
 * Account's eligibility, with a reason (ticket 11; owner decision (b)):
 * sets `verifiedAt` again and writes a REINSTATED row. Refused when the
 * account's latest revoke/reinstate row is not a REVOKED one
 * (`BankAccountNotReinstatableError`, covering both "never revoked" and
 * "already reinstated"), when the acting Verifier is the account's owner
 * (`OwnBankAccountVerificationError`), and when the acting Verifier is the
 * one who wrote that REVOKED row (`ReinstaterWasRevokerError`).
 *
 * Reinstating does not create a new BankAccountVerificationRequest: it is
 * the reversal of a revoke, not a fresh submission through the Verifier's
 * usual queue, so `checkedBankCode` and `documentedAccountName` are not
 * asked again here.
 */
export async function reinstateBankAccountVerification(
  prisma: PrismaClient,
  params: { accountId: string; verifierId: string; reason: unknown; now?: Date }
): Promise<BankAccountRevocation> {
  const now = params.now ?? new Date();
  const reason = cleanRevocationReason(params.reason);

  return prisma.$transaction(async (tx) => {
    const account = await tx.bankAccount.findUnique({ where: { id: params.accountId } });
    if (!account) throw new BankAccountNotFoundError();
    if (account.ownerId === params.verifierId) throw new OwnBankAccountVerificationError();

    const latest = await latestRevocation(tx, account.id);
    if (!latest || latest.action !== BankAccountRevocationAction.REVOKED) {
      throw new BankAccountNotReinstatableError();
    }
    if (latest.actorId === params.verifierId) throw new ReinstaterWasRevokerError();

    // Conditional write, mirroring revoke's own guard: a race with a second
    // reinstatement (or a fresh approval landing concurrently) throws
    // instead of overwriting, reusing BankAccountAlreadyVerifiedError since
    // that is exactly the state it finds.
    const restored = await tx.bankAccount.updateMany({
      where: { id: account.id, verifiedAt: null },
      data: { verifiedAt: now },
    });
    if (restored.count === 0) throw new BankAccountAlreadyVerifiedError();

    const revocation = await tx.bankAccountRevocation.create({
      data: {
        bankAccountId: account.id,
        action: BankAccountRevocationAction.REINSTATED,
        reason,
        actorId: params.verifierId,
        createdAt: now,
      },
    });

    await tx.notification.create({
      data: {
        type: "bank_account_verification",
        userId: account.ownerId,
        title: "Verifikasi Rekening Dipulihkan",
        message: `Verifikasi rekening ${account.bankCode} Anda dipulihkan oleh Verifier. Alasan: ${reason}`,
        link: "/akun/rekening",
      },
    });

    return revocation;
  });
}

/** One row of the Verifier's revoke/reinstate lists: the account and its owner, ciphertext included (never decrypted here). */
export type RevocableBankAccount = {
  id: string;
  bankCode: string;
  accountName: string;
  ownerId: string;
  ownerName: string;
  verifiedAt: Date | null;
  accountNumberCiphertext: string;
  accountNumberKeyId: string;
};

const REVOCABLE_SELECT = {
  id: true,
  bankCode: true,
  accountName: true,
  ownerId: true,
  owner: { select: { name: true } },
  verifiedAt: true,
  ...SELECT_BANK_ACCOUNT_NUMBER,
} as const;

function toRevocableBankAccount(account: {
  id: string;
  bankCode: string;
  accountName: string;
  ownerId: string;
  owner: { name: string };
  verifiedAt: Date | null;
  accountNumberCiphertext: string;
  accountNumberKeyId: string;
}): RevocableBankAccount {
  return {
    id: account.id,
    bankCode: account.bankCode,
    accountName: account.accountName,
    ownerId: account.ownerId,
    ownerName: account.owner.name,
    verifiedAt: account.verifiedAt,
    accountNumberCiphertext: account.accountNumberCiphertext,
    accountNumberKeyId: account.accountNumberKeyId,
  };
}

/**
 * Every currently-verified Bank Account, most recently verified first: the
 * Verifier's "revoke" list on `/moderasi/rekening`. `verifiedAt` is the
 * single source of "eligible right now" (ADR 0018); this reads it directly
 * rather than joining BankAccountRevocation's history.
 */
export async function verifiedBankAccounts(
  prisma: Pick<PrismaClient, "bankAccount">
): Promise<RevocableBankAccount[]> {
  const accounts = await prisma.bankAccount.findMany({
    where: { verifiedAt: { not: null } },
    orderBy: { verifiedAt: "desc" },
    select: REVOCABLE_SELECT,
  });
  return accounts.map(toRevocableBankAccount);
}

/**
 * Every Bank Account whose latest revoke/reinstate row is REVOKED, most
 * recently revoked first: the Verifier's "reinstate" list. Computed in
 * application code, not a join, because "latest row per account" is not a
 * `WHERE` clause Prisma's query API expresses directly, and this table is
 * small (one row per revoke or reinstate, ever).
 */
export async function revokedBankAccounts(
  prisma: Pick<PrismaClient, "bankAccount" | "bankAccountRevocation">
): Promise<RevocableBankAccount[]> {
  const revocations = await prisma.bankAccountRevocation.findMany({
    orderBy: { createdAt: "desc" },
    select: { bankAccountId: true, action: true, createdAt: true },
  });
  const latestByAccount = new Map<string, BankAccountRevocationAction>();
  for (const row of revocations) {
    if (!latestByAccount.has(row.bankAccountId)) latestByAccount.set(row.bankAccountId, row.action);
  }
  const revokedIds = [...latestByAccount.entries()]
    .filter(([, action]) => action === BankAccountRevocationAction.REVOKED)
    .map(([id]) => id);
  if (revokedIds.length === 0) return [];

  const accounts = await prisma.bankAccount.findMany({
    where: { id: { in: revokedIds } },
    select: REVOCABLE_SELECT,
  });
  const order = new Map(revokedIds.map((id, index) => [id, index]));
  return accounts
    .map(toRevocableBankAccount)
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}
