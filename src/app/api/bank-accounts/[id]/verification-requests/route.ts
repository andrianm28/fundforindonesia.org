import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { bankAccountRoute } from "@/lib/bank-account-route";
import { submitBankAccountVerification, withdrawBankAccountVerification } from "@/lib/bank-account-verification";

/**
 * Submits the signed-in person's own Bank Account to a Verifier (flow step
 * 2). Refused when it already has a `verifiedAt` or an existing PENDING
 * request.
 */
export const POST = bankAccountRoute(
  async ({ actorId, params }) => {
    const request = await submitBankAccountVerification(prisma, { accountId: params.id, ownerId: actorId });
    return NextResponse.json({ request }, { status: 201 });
  },
  { readsBody: false }
);

/**
 * Withdraws the account's own PENDING request, if it has one. No
 * `requestId` in the path or body: an account has at most one PENDING
 * request at a time, so there is only ever one to withdraw.
 */
export const DELETE = bankAccountRoute(
  async ({ actorId, params }) => {
    const request = await withdrawBankAccountVerification(prisma, { accountId: params.id, ownerId: actorId });
    return NextResponse.json({ request });
  },
  { readsBody: false }
);
