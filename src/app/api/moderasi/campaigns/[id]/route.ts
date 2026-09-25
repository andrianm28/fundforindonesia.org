import { withAssignmentCheck } from "@/lib/withAssignmentCheck";
import { Assignment } from "@/generated/prisma/client";
import { getServerSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { decideSubmission, lifecycleErrorToHttp } from "@/lib/campaign-lifecycle";
import { NextRequest, NextResponse } from "next/server";

/**
 * Verifier moderation: approve or reject a Submitted Campaign. A thin
 * adapter over the lifecycle module, which owns the transition, the
 * Verifier check, the status-change record and the Fundraiser's
 * notification. There is no `suspend`: a Verifier raises a Flag and an
 * Admin decides on Suspension (ADR 0005, FFI-07b), so `suspend` is refused
 * like any other unknown action.
 */
const DECISIONS = ["approve", "reject"] as const;
type Decision = (typeof DECISIONS)[number];

function isDecision(value: unknown): value is Decision {
  return DECISIONS.includes(value as Decision);
}

export const PATCH = withAssignmentCheck(Assignment.VERIFIER, async (req: NextRequest, context: any) => {
  const { id } = await context.params;
  const body = await req.json().catch(() => null);
  const action = body?.action;

  if (!isDecision(action)) {
    return NextResponse.json(
      { error: "Aksi tidak valid. Gunakan approve atau reject." },
      { status: 400 }
    );
  }

  // withAssignmentCheck has already turned a missing session into 401.
  const session = await getServerSession();
  const actor = {
    userId: session!.user.id,
    assignments: session!.user.assignments ?? [],
  };

  try {
    const result = await decideSubmission(prisma, { campaignId: id, actor, decision: action });
    return NextResponse.json(result);
  } catch (error) {
    const refusal = lifecycleErrorToHttp(error);
    if (refusal) return NextResponse.json(refusal.body, { status: refusal.status });
    throw error;
  }
});
