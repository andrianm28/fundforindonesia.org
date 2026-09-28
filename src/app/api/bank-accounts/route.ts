import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { bankAccountRoute } from "@/lib/bank-account-route";
import { createBankAccount } from "@/lib/bank-account-verification";
import { readBankAccountNumber, SELECT_BANK_ACCOUNT_NUMBER } from "@/lib/contact-fields";
import { maskBankAccountNumber } from "@/lib/bank-account-mask";

/**
 * The signed-in person's own Bank Accounts (ticket 16, flow step 2b): the
 * masked number (decision 6 -- the full number is never sent here), whether
 * it may still be submitted or deleted, and its current request, if any, so
 * the page can offer submit, withdraw or delete without a second round trip.
 */
export const GET = bankAccountRoute(
  async ({ actorId }) => {
    const accounts = await prisma.bankAccount.findMany({
      where: { ownerId: actorId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        bankCode: true,
        accountName: true,
        verifiedAt: true,
        createdAt: true,
        ...SELECT_BANK_ACCOUNT_NUMBER,
      },
    });
    const requests = await prisma.bankAccountVerificationRequest.findMany({
      where: { bankAccountId: { in: accounts.map((a) => a.id) } },
      orderBy: { submittedAt: "desc" },
    });

    return NextResponse.json({
      accounts: accounts.map((account) => {
        const ownRequests = requests.filter((r) => r.bankAccountId === account.id);
        const pending = ownRequests.find((r) => r.outcome === "PENDING");
        const latest = ownRequests[0] ?? null;
        return {
          id: account.id,
          bankCode: account.bankCode,
          accountName: account.accountName,
          maskedNumber: maskBankAccountNumber(readBankAccountNumber(account) ?? ""),
          verifiedAt: account.verifiedAt,
          createdAt: account.createdAt,
          // Decision 5: the button is shown only for an account with no
          // verifiedAt and no request row of any outcome. The service layer
          // refuses regardless, so this is a display hint, not the rule.
          deletable: account.verifiedAt === null && ownRequests.length === 0,
          pendingRequestId: pending?.id ?? null,
          latestOutcome: latest?.outcome ?? null,
        };
      }),
    });
  },
  { readsBody: false }
);

/**
 * The owner adds their own Bank Account (flow step 1): `{ bankCode,
 * accountName, accountNumber }`. Any signed-in user may do this. The number
 * is sealed (ADR 0012) and never returned in plaintext.
 */
export const POST = bankAccountRoute(async ({ actorId, body }) => {
  const account = await createBankAccount(prisma, {
    ownerId: actorId,
    bankCode: body.bankCode,
    accountName: body.accountName,
    accountNumber: body.accountNumber,
  });
  return NextResponse.json(
    {
      account: {
        id: account.id,
        bankCode: account.bankCode,
        accountName: account.accountName,
        verifiedAt: account.verifiedAt,
        createdAt: account.createdAt,
      },
    },
    { status: 201 }
  );
});
