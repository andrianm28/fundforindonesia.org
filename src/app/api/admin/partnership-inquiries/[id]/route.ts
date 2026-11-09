import { NextRequest, NextResponse } from "next/server";
import { Assignment } from "@/generated/prisma/client";
import { getServerSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { withHiddenAssignmentCheck } from "@/lib/withAssignmentCheck";
import {
  getPartnershipInquiryDetail,
  partnershipInquiryFollowUpErrorToHttp,
  updatePartnershipInquiry,
} from "@/lib/partnership-inquiry-followup";

type Context = { params: Promise<{ id: string }> };

/**
 * GET /api/admin/partnership-inquiries/[id] (pks-pemenuhan/17): one Inquiry in
 * full for an Admin -- the contact, the company's address and NPWP read back
 * from their ciphertext (ADR 0012), the needs, budget range, period, PIC, the
 * proposal PDFs (ids; the bytes stay behind GET /api/documents/[id]) and the
 * whole history with each note. A person without the ADMIN assignment gets the
 * literal 404 every other Admin API gives, so the door does not confirm it is
 * there.
 */
export const GET = withHiddenAssignmentCheck(
  Assignment.ADMIN,
  async (_req: NextRequest, context: Context): Promise<NextResponse> => {
    const { id } = await context.params;
    try {
      return NextResponse.json({ inquiry: await getPartnershipInquiryDetail(prisma, id) });
    } catch (error) {
      const refusal = partnershipInquiryFollowUpErrorToHttp(error);
      if (refusal) return NextResponse.json({ error: refusal.error }, { status: refusal.status });
      throw error;
    }
  },
);

/**
 * PATCH /api/admin/partnership-inquiries/[id] (tickets 06 and
 * pks-pemenuhan/17): the one door the partnership team changes an Inquiry
 * through, and the only things the body may say: `{ status, picId, note }`.
 * Everything else in the body is ignored rather than refused, so a client that
 * sends the whole Inquiry back cannot turn a change of stage into an edit of
 * the company's own words -- an Admin works the pipeline and writes nothing
 * else about the conversation.
 *
 * The stage may be any of the eight, forward or back; leaving Selesai or Tidak
 * dilanjutkan needs a reason in `note`. `picId` must be a user holding ADMIN,
 * or null to clear. One request is one history entry with who, what and when.
 * It answers 400 for a stage the platform lacks, a PIC who is not an Admin or a
 * missing reason, 404 for an Inquiry no company submitted, and 409 for a
 * request that changes nothing -- including one that lost a race with another
 * admin's change, so the team sees one history rather than two.
 */
export const PATCH = withHiddenAssignmentCheck(
  Assignment.ADMIN,
  async (req: NextRequest, context: Context): Promise<NextResponse> => {
    const { id } = await context.params;
    const parsed = await req.json().catch(() => undefined);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return NextResponse.json({ error: "Body permintaan harus berupa objek JSON." }, { status: 400 });
    }
    const body = parsed as { status?: unknown; picId?: unknown; note?: unknown };

    // withHiddenAssignmentCheck has already refused anyone without a session, so the
    // person is known here; the audit trail names them, never a guess.
    const session = await getServerSession();

    try {
      const result = await updatePartnershipInquiry(prisma, {
        inquiryId: id,
        actorId: session!.user.id as string,
        status: body.status,
        picId: body.picId,
        note: body.note,
      });
      return NextResponse.json(result);
    } catch (error) {
      const refusal = partnershipInquiryFollowUpErrorToHttp(error);
      if (refusal) return NextResponse.json({ error: refusal.error }, { status: refusal.status });
      throw error;
    }
  },
);
