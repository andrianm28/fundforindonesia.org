import { describe, it, expect } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import * as bankAccountVerification from "./bank-account-verification";
import {
  createBankAccount,
  decideBankAccountVerification,
  deleteBankAccount,
  submitBankAccountVerification,
  withdrawBankAccountVerification,
} from "./bank-account-verification";
import {
  BankAccountAlreadyVerifiedError,
  BankAccountNotDeletableError,
  BankAccountNotFoundError,
  BankAccountVerificationAlreadyPendingError,
  BankAccountVerificationNotPendingError,
  BankAccountVerificationRequestNotFoundError,
  BankAccountDecisionInvalidError,
  InvalidBankAccountError,
  OwnBankAccountVerificationError,
} from "./bank-account-verification-errors";
import { readBankAccountNumber } from "./contact-fields";
import { bankAccountRow, bankAccountVerificationRequestRow, makeCampaignDb, userRow } from "../../tests/support/in-memory-campaign-db";

/**
 * A person creates their own Bank Account, submits it to a Verifier, and may
 * withdraw or delete it; a Verifier decides a submission (ticket 16; ADR
 * 0018). The three tests decision 5 requires -- delete succeeds with no
 * request row, delete is refused with a REJECTED row as well as a PENDING
 * one, and edit is unreachable -- are marked below.
 */
const NOW = new Date("2026-09-28T10:00:00Z");
const USERS = [userRow({ id: "owner-1", name: "Siti Fundraiser" }), userRow({ id: "verifier-1", name: "Verifier" })];

function db(seed: Parameters<typeof makeCampaignDb>[0] = {}) {
  return makeCampaignDb({ bankAccounts: [], bankAccountVerificationRequests: [], users: USERS, ...seed });
}

describe("createBankAccount", () => {
  it("creates the account unverified, sealing the number and never storing it in plaintext", async () => {
    const store = db();

    const account = await createBankAccount(store.prisma as never, {
      ownerId: "owner-1",
      bankCode: "bca",
      accountName: "Siti Fundraiser",
      accountNumber: "9988776655",
    });

    expect(account.verifiedAt).toBeNull();
    expect(account.ownerId).toBe("owner-1");
    expect((account as unknown as Record<string, unknown>).accountNumber).toBeUndefined();
    expect(readBankAccountNumber(account)).toBe("9988776655");
  });

  it("refuses a blank field", async () => {
    const store = db();
    await expect(
      createBankAccount(store.prisma as never, { ownerId: "owner-1", bankCode: "", accountName: "Siti", accountNumber: "123" })
    ).rejects.toBeInstanceOf(InvalidBankAccountError);
  });
});

describe("submitBankAccountVerification", () => {
  it("opens a PENDING request and notifies the owner", async () => {
    const store = db({ bankAccounts: [bankAccountRow()] });

    const request = await submitBankAccountVerification(store.prisma as never, {
      accountId: "bank-account-1",
      ownerId: "owner-1",
      now: NOW,
    });

    expect(request.outcome).toBe("PENDING");
    expect(request.bankAccountId).toBe("bank-account-1");
    expect(store.notifications).toEqual([expect.objectContaining({ userId: "owner-1" })]);
  });

  it("refuses another account's owner", async () => {
    const store = db({ bankAccounts: [bankAccountRow()] });
    await expect(
      submitBankAccountVerification(store.prisma as never, { accountId: "bank-account-1", ownerId: "someone-else", now: NOW })
    ).rejects.toBeInstanceOf(BankAccountNotFoundError);
  });

  it("refuses an already-verified account (decision 1: checked once)", async () => {
    const store = db({ bankAccounts: [bankAccountRow({ verifiedAt: NOW })] });
    await expect(
      submitBankAccountVerification(store.prisma as never, { accountId: "bank-account-1", ownerId: "owner-1", now: NOW })
    ).rejects.toBeInstanceOf(BankAccountAlreadyVerifiedError);
  });

  it("refuses a second submission while one is already PENDING", async () => {
    const store = db({
      bankAccounts: [bankAccountRow()],
      bankAccountVerificationRequests: [bankAccountVerificationRequestRow()],
    });
    await expect(
      submitBankAccountVerification(store.prisma as never, { accountId: "bank-account-1", ownerId: "owner-1", now: NOW })
    ).rejects.toBeInstanceOf(BankAccountVerificationAlreadyPendingError);
  });

  it("refuses the loser of two racing submissions, whose create hits the one-PENDING index", async () => {
    const store = db({ bankAccounts: [bankAccountRow()] });
    // Both submissions passed the PENDING check; the database keeps the first.
    const transaction = store.prisma.$transaction;
    store.prisma.$transaction = (callback) =>
      transaction((tx) => {
        (tx as { bankAccountVerificationRequest: { create: () => Promise<never> } }).bankAccountVerificationRequest.create =
          async () => {
            throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
              code: "P2002",
              clientVersion: "test",
            });
          };
        return callback(tx);
      });
    await expect(
      submitBankAccountVerification(store.prisma as never, { accountId: "bank-account-1", ownerId: "owner-1", now: NOW })
    ).rejects.toBeInstanceOf(BankAccountVerificationAlreadyPendingError);
    expect(store.notifications).toEqual([]);
  });

  it("allows resubmission after a REJECTED request, keeping the old row", async () => {
    const store = db({
      bankAccounts: [bankAccountRow()],
      bankAccountVerificationRequests: [bankAccountVerificationRequestRow({ outcome: "REJECTED" })],
    });

    const request = await submitBankAccountVerification(store.prisma as never, {
      accountId: "bank-account-1",
      ownerId: "owner-1",
      now: NOW,
    });

    expect(request.outcome).toBe("PENDING");
    expect(store.bankAccountVerificationRequests).toHaveLength(2);
  });
});

describe("withdrawBankAccountVerification", () => {
  it("withdraws the account's own PENDING request", async () => {
    const store = db({
      bankAccounts: [bankAccountRow()],
      bankAccountVerificationRequests: [bankAccountVerificationRequestRow()],
    });

    const withdrawn = await withdrawBankAccountVerification(store.prisma as never, {
      accountId: "bank-account-1",
      ownerId: "owner-1",
      now: NOW,
    });

    expect(withdrawn.outcome).toBe("WITHDRAWN");
    expect(store.bankAccountVerificationRequests[0]).toMatchObject({ outcome: "WITHDRAWN", decidedById: "owner-1" });
  });

  it("refuses when there is nothing PENDING to withdraw", async () => {
    const store = db({ bankAccounts: [bankAccountRow()] });
    await expect(
      withdrawBankAccountVerification(store.prisma as never, { accountId: "bank-account-1", ownerId: "owner-1", now: NOW })
    ).rejects.toBeInstanceOf(BankAccountVerificationNotPendingError);
  });
});

describe("deleteBankAccount (decision 5's proof)", () => {
  it("succeeds when verifiedAt is null and there is no request row", async () => {
    const store = db({ bankAccounts: [bankAccountRow()] });

    await deleteBankAccount(store.prisma as never, { accountId: "bank-account-1", ownerId: "owner-1" });

    expect(store.bankAccounts).toHaveLength(0);
  });

  it("is refused when a PENDING request row exists", async () => {
    const store = db({
      bankAccounts: [bankAccountRow()],
      bankAccountVerificationRequests: [bankAccountVerificationRequestRow({ outcome: "PENDING" })],
    });
    await expect(
      deleteBankAccount(store.prisma as never, { accountId: "bank-account-1", ownerId: "owner-1" })
    ).rejects.toBeInstanceOf(BankAccountNotDeletableError);
    expect(store.bankAccounts).toHaveLength(1);
  });

  it("is refused when a REJECTED request row exists -- not only a PENDING one", async () => {
    const store = db({
      bankAccounts: [bankAccountRow()],
      bankAccountVerificationRequests: [bankAccountVerificationRequestRow({ outcome: "REJECTED" })],
    });
    await expect(
      deleteBankAccount(store.prisma as never, { accountId: "bank-account-1", ownerId: "owner-1" })
    ).rejects.toBeInstanceOf(BankAccountNotDeletableError);
    expect(store.bankAccounts).toHaveLength(1);
  });

  it("is refused when the account is already verified", async () => {
    const store = db({ bankAccounts: [bankAccountRow({ verifiedAt: NOW })] });
    await expect(
      deleteBankAccount(store.prisma as never, { accountId: "bank-account-1", ownerId: "owner-1" })
    ).rejects.toBeInstanceOf(BankAccountNotDeletableError);
  });

  it("refuses another account's owner, the same as a missing account", async () => {
    const store = db({ bankAccounts: [bankAccountRow()] });
    await expect(
      deleteBankAccount(store.prisma as never, { accountId: "bank-account-1", ownerId: "someone-else" })
    ).rejects.toBeInstanceOf(BankAccountNotFoundError);
    expect(store.bankAccounts).toHaveLength(1);
  });
});

describe("edit (decision 5's third proof: there is no edit path at all)", () => {
  it("this module exports no command that updates or edits a BankAccount's fields", () => {
    const commandNames = Object.keys(bankAccountVerification);
    expect(commandNames.some((name) => /update|edit/i.test(name))).toBe(false);
  });
});

describe("decideBankAccountVerification", () => {
  function seed() {
    return db({
      bankAccounts: [bankAccountRow()],
      bankAccountVerificationRequests: [bankAccountVerificationRequestRow()],
    });
  }

  it("approves, writing verifiedAt on the account exactly once and notifying the owner", async () => {
    const store = seed();

    const decided = await decideBankAccountVerification(store.prisma as never, {
      requestId: "bank-account-verification-1",
      verifierId: "verifier-1",
      decision: "approve",
      checkedBankCode: "bca",
      documentedAccountName: "Siti Fundraiser",
      note: "Sesuai buku tabungan.",
      now: NOW,
    });

    expect(decided.outcome).toBe("APPROVED");
    expect(store.bankAccount("bank-account-1").verifiedAt).toEqual(NOW);
    expect(store.notifications).toEqual([expect.objectContaining({ userId: "owner-1", title: "Rekening Disetujui" })]);
  });

  it("rejects, requiring a reason and never touching verifiedAt", async () => {
    const store = seed();

    const decided = await decideBankAccountVerification(store.prisma as never, {
      requestId: "bank-account-verification-1",
      verifierId: "verifier-1",
      decision: "reject",
      reason: "Nama tidak sesuai dokumen.",
      now: NOW,
    });

    expect(decided.outcome).toBe("REJECTED");
    expect(decided.checkedBankCode).toBeNull();
    expect(decided.documentedAccountName).toBeNull();
    expect(store.bankAccount("bank-account-1").verifiedAt).toBeNull();
  });

  it("refuses approval missing checkedBankCode or documentedAccountName", async () => {
    const store = seed();
    await expect(
      decideBankAccountVerification(store.prisma as never, {
        requestId: "bank-account-verification-1",
        verifierId: "verifier-1",
        decision: "approve",
        checkedBankCode: "bca",
        now: NOW,
      })
    ).rejects.toBeInstanceOf(BankAccountDecisionInvalidError);
  });

  it("refuses a rejection with no reason", async () => {
    const store = seed();
    await expect(
      decideBankAccountVerification(store.prisma as never, {
        requestId: "bank-account-verification-1",
        verifierId: "verifier-1",
        decision: "reject",
        now: NOW,
      })
    ).rejects.toBeInstanceOf(BankAccountDecisionInvalidError);
  });

  it("refuses a Verifier deciding their own account (ADR 0018)", async () => {
    const store = db({
      bankAccounts: [bankAccountRow({ ownerId: "verifier-1" })],
      bankAccountVerificationRequests: [bankAccountVerificationRequestRow({ submittedById: "verifier-1" })],
    });
    await expect(
      decideBankAccountVerification(store.prisma as never, {
        requestId: "bank-account-verification-1",
        verifierId: "verifier-1",
        decision: "approve",
        checkedBankCode: "bca",
        documentedAccountName: "Siti Fundraiser",
        now: NOW,
      })
    ).rejects.toBeInstanceOf(OwnBankAccountVerificationError);
  });

  it("refuses a request that is no longer PENDING", async () => {
    const store = db({
      bankAccounts: [bankAccountRow()],
      bankAccountVerificationRequests: [bankAccountVerificationRequestRow({ outcome: "WITHDRAWN" })],
    });
    await expect(
      decideBankAccountVerification(store.prisma as never, {
        requestId: "bank-account-verification-1",
        verifierId: "verifier-1",
        decision: "approve",
        checkedBankCode: "bca",
        documentedAccountName: "Siti Fundraiser",
        now: NOW,
      })
    ).rejects.toBeInstanceOf(BankAccountVerificationNotPendingError);
  });

  it("throws when the request does not exist", async () => {
    const store = db({ bankAccounts: [bankAccountRow()] });
    await expect(
      decideBankAccountVerification(store.prisma as never, {
        requestId: "no-such-request",
        verifierId: "verifier-1",
        decision: "approve",
        checkedBankCode: "bca",
        documentedAccountName: "Siti Fundraiser",
        now: NOW,
      })
    ).rejects.toBeInstanceOf(BankAccountVerificationRequestNotFoundError);
  });
});
