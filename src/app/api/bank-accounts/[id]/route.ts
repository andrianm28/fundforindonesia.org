import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { bankAccountRoute } from "@/lib/bank-account-route";
import { deleteBankAccount } from "@/lib/bank-account-verification";

/**
 * Deletes the signed-in person's own Bank Account (decision 5). Refused
 * unless it has no `verifiedAt` and no verification request row of any
 * outcome -- checked in `deleteBankAccount`, not here.
 */
export const DELETE = bankAccountRoute(
  async ({ actorId, params }) => {
    await deleteBankAccount(prisma, { accountId: params.id, ownerId: actorId });
    return new NextResponse(null, { status: 204 });
  },
  { readsBody: false }
);

/**
 * Decision 5: an account may never be edited, not even by its owner, not
 * even by an Admin. There is no edit path anywhere in this module -- a wrong
 * number is fixed by deleting and re-adding. PATCH and PUT answer 405
 * rather than being left unexported, so the refusal is a statement a test
 * can pin, not a route Next.js happens not to have.
 */
const EDIT_NOT_SUPPORTED_BODY = {
  error:
    "Bank Account tidak dapat diubah. Nomor rekening adalah tujuan Payout yang sudah tercatat; hapus dan tambahkan ulang jika salah ketik.",
  code: "BANK_ACCOUNT_EDIT_NOT_SUPPORTED",
};

export async function PATCH() {
  return NextResponse.json(EDIT_NOT_SUPPORTED_BODY, { status: 405 });
}

export async function PUT() {
  return NextResponse.json(EDIT_NOT_SUPPORTED_BODY, { status: 405 });
}
