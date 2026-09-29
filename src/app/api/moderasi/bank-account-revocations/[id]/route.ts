import { NextRequest, NextResponse } from "next/server";
import { Assignment } from "@/generated/prisma/client";
import { withAssignmentCheck } from "@/lib/withAssignmentCheck";
import { getServerSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { reinstateBankAccountVerification, revokeBankAccountVerification } from "@/lib/bank-account-verification";
import { refusalResponse } from "@/lib/refusal-response";

/**
 * A Verifier revokes or reinstates a Bank Account's verification (ticket
 * 11; owner decision 2026-09-28): `{ action: "revoke" | "reinstate", reason }`.
 * `[id]` is the BankAccount's own id, not a verification request's -- a
 * revoke or reinstate is not a decision on a PENDING
 * BankAccountVerificationRequest, so it does not share the `[requestId]`
 * route above. Every rule (not the owner, not the same Verifier who
 * verified/revoked it, the account's current state) is enforced in
 * `src/lib/bank-account-verification.ts`, not here.
 */
export const POST = withAssignmentCheck(
  Assignment.VERIFIER,
  async (req: NextRequest, context?: { params?: Promise<{ id: string }> }) => {
    const session = await getServerSession();
    const verifierId = session!.user.id as string;
    const params = (await context?.params) ?? { id: "" };

    const parsed = await req.json().catch(() => undefined);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return NextResponse.json({ error: "Body permintaan harus berupa objek JSON." }, { status: 400 });
    }
    const body = parsed as Record<string, unknown>;

    if (body.action !== "revoke" && body.action !== "reinstate") {
      return NextResponse.json(
        { error: "action harus 'revoke' atau 'reinstate'.", code: "BANK_ACCOUNT_DECISION_INVALID" },
        { status: 422 }
      );
    }

    try {
      const revocation =
        body.action === "revoke"
          ? await revokeBankAccountVerification(prisma, {
              accountId: params.id,
              verifierId,
              reason: body.reason,
            })
          : await reinstateBankAccountVerification(prisma, {
              accountId: params.id,
              verifierId,
              reason: body.reason,
            });
      return NextResponse.json({ revocation });
    } catch (error) {
      const refusal = refusalResponse(error);
      if (refusal) return refusal;
      throw error;
    }
  }
);
