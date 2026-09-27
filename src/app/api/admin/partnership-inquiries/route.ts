import { NextResponse } from "next/server";
import { Assignment } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { withAssignmentCheck } from "@/lib/withAssignmentCheck";
import { listPartnershipInquiries } from "@/lib/partnership-inquiry-followup";

/**
 * GET /api/admin/partnership-inquiries (ticket 06): the partnership team's
 * queue -- every Inquiry, with the Program it is about, the company that
 * asked, and how far the follow-up has got.
 *
 * Admin-only, like every other route under /api/admin: an Inquiry names a
 * company and the person at it, and a queue of those is nobody else's to read
 * (ADR 0005 -- authority comes from the ADMIN assignment, never from the Role
 * hierarchy). There is no public equivalent and no program-scoped one: the
 * public side of a CSR Program is `GET /api/programs`, which never names a
 * company.
 *
 * The queue is every Inquiry, in the order they arrived, newest first; it does
 * not page. The partnership team is a handful of people working one list, and
 * a follow-up status nobody can see is not a follow-up. An empty queue answers
 * an empty list, not a refusal: no company has enquired yet is a fact about the
 * portfolio, not an error.
 */
export const GET = withAssignmentCheck(Assignment.ADMIN, async (): Promise<NextResponse> => {
  const inquiries = await listPartnershipInquiries(prisma);
  return NextResponse.json({ inquiries });
});
