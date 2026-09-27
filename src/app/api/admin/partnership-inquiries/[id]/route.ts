import { NextRequest, NextResponse } from "next/server";
import { Assignment } from "@/generated/prisma/client";
import { getServerSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { withAssignmentCheck } from "@/lib/withAssignmentCheck";
import {
  followUpPartnershipInquiry,
  partnershipInquiryFollowUpErrorToHttp,
} from "@/lib/partnership-inquiry-followup";

/**
 * PATCH /api/admin/partnership-inquiries/[id] (ticket 06): the one door the
 * partnership team moves a follow-up through, and the only thing the body may
 * say. `{ status }` names where the Inquiry goes; everything else in the body
 * is ignored rather than refused, so a client that sends the whole Inquiry back
 * cannot turn a follow-up into an edit of the company's own words -- an Admin
 * marks follow-up and writes nothing else about the conversation.
 *
 * The status is never a free field: the module takes only the one step forward
 * the Inquiry's own status offers, and records who moved it and when. It
 * answers 400 for a status the platform does not have, 404 for an Inquiry no
 * company submitted, and 409 for a move the Inquiry's status does not allow --
 * including one that lost a race with another admin's move, so the team sees
 * one history rather than two.
 */
export const PATCH = withAssignmentCheck(
  Assignment.ADMIN,
  async (
    req: NextRequest,
    context: { params: Promise<{ id: string }> },
  ): Promise<NextResponse> => {
    const { id } = await context.params;
    const parsed = await req.json().catch(() => undefined);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return NextResponse.json({ error: "Body permintaan harus berupa objek JSON." }, { status: 400 });
    }

    // withAssignmentCheck has already refused anyone without a session, so the
    // person is known here; the audit trail names them, never a guess.
    const session = await getServerSession();

    try {
      const result = await followUpPartnershipInquiry(prisma, {
        inquiryId: id,
        to: (parsed as { status?: unknown }).status,
        actorId: session!.user.id as string,
      });
      return NextResponse.json(result);
    } catch (error) {
      const refusal = partnershipInquiryFollowUpErrorToHttp(error);
      if (refusal) return NextResponse.json({ error: refusal.error }, { status: refusal.status });
      throw error;
    }
  },
);
