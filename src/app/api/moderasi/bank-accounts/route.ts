import { NextResponse } from "next/server";
import { Assignment } from "@/generated/prisma/client";
import { withAssignmentCheck } from "@/lib/withAssignmentCheck";
import { prisma } from "@/lib/prisma";
import { readBankAccountNumber } from "@/lib/contact-fields";
import { maskBankAccountNumber } from "@/lib/bank-account-mask";
import { pendingBankAccountVerifications } from "@/lib/bank-account-verification";

/**
 * The Verifier's queue (flow step 3): every PENDING BankAccountVerificationRequest,
 * oldest first, with the account's owner, `bankCode`, `accountName` and
 * **masked** number (decision 6). The full number is decrypted only on the
 * server-rendered decide page (`/moderasi/rekening`), not through this JSON
 * route, so it never crosses the wire as an API response.
 */
export const GET = withAssignmentCheck(Assignment.VERIFIER, async () => {
  const requests = await pendingBankAccountVerifications(prisma);

  return NextResponse.json({
    requests: requests.map((request) => ({
      id: request.id,
      submittedAt: request.submittedAt,
      bankAccount: {
        id: request.bankAccount.id,
        bankCode: request.bankAccount.bankCode,
        accountName: request.bankAccount.accountName,
        ownerName: request.bankAccount.ownerName,
        maskedNumber: maskBankAccountNumber(readBankAccountNumber(request.bankAccount) ?? ""),
      },
    })),
  });
});
