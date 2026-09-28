import { NextResponse } from "next/server";
import { Assignment } from "@/generated/prisma/client";
import { withAssignmentCheck } from "@/lib/withAssignmentCheck";
import { getServerSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { readBankAccountNumber, SELECT_BANK_ACCOUNT_NUMBER } from "@/lib/contact-fields";
import { maskBankAccountNumber } from "@/lib/bank-account-mask";

/**
 * The Verifier's queue (flow step 3): every PENDING BankAccountVerificationRequest,
 * oldest first, with the account's owner, `bankCode`, `accountName` and
 * **masked** number (decision 6). The full number is decrypted only on the
 * server-rendered decide page (`/moderasi/rekening`), not through this JSON
 * route, so it never crosses the wire as an API response.
 */
export const GET = withAssignmentCheck(Assignment.VERIFIER, async () => {
  await getServerSession();
  const requests = await prisma.bankAccountVerificationRequest.findMany({
    where: { outcome: "PENDING" },
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

  return NextResponse.json({
    requests: requests.map((request) => ({
      id: request.id,
      submittedAt: request.submittedAt,
      bankAccount: {
        id: request.bankAccount.id,
        bankCode: request.bankAccount.bankCode,
        accountName: request.bankAccount.accountName,
        ownerName: request.bankAccount.owner.name,
        maskedNumber: maskBankAccountNumber(readBankAccountNumber(request.bankAccount) ?? ""),
      },
    })),
  });
});
