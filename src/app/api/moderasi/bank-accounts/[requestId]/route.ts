import { NextRequest, NextResponse } from "next/server";
import { Assignment } from "@/generated/prisma/client";
import { withAssignmentCheck } from "@/lib/withAssignmentCheck";
import { getServerSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { decideBankAccountVerification, type BankAccountDecision } from "@/lib/bank-account-verification";
import { refusalResponse } from "@/lib/refusal-response";

/**
 * A Verifier decides a PENDING BankAccountVerificationRequest (flow step 4):
 * `{ decision, checkedBankCode, documentedAccountName, note, reason }`.
 * Approval requires both checked fields; a rejection requires `reason`. Both
 * are enforced in `decideBankAccountVerification`, not here.
 */
export const POST = withAssignmentCheck(
  Assignment.VERIFIER,
  async (req: NextRequest, context?: { params?: Promise<{ requestId: string }> }) => {
    const session = await getServerSession();
    const verifierId = session!.user.id as string;
    const params = (await context?.params) ?? { requestId: "" };

    const parsed = await req.json().catch(() => undefined);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return NextResponse.json({ error: "Body permintaan harus berupa objek JSON." }, { status: 400 });
    }
    const body = parsed as Record<string, unknown>;

    if (body.decision !== "approve" && body.decision !== "reject") {
      return NextResponse.json(
        { error: "decision harus 'approve' atau 'reject'.", code: "BANK_ACCOUNT_DECISION_INVALID" },
        { status: 422 }
      );
    }

    try {
      const request = await decideBankAccountVerification(prisma, {
        requestId: params.requestId,
        verifierId,
        decision: body.decision as BankAccountDecision,
        checkedBankCode: body.checkedBankCode,
        documentedAccountName: body.documentedAccountName,
        note: body.note,
        reason: body.reason,
      });
      return NextResponse.json({ request });
    } catch (error) {
      const refusal = refusalResponse(error);
      if (refusal) return refusal;
      throw error;
    }
  }
);
