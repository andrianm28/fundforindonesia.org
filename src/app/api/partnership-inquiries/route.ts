import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  createPartnershipInquiry,
  partnershipInquiryErrorToHttp,
  type PartnershipInquiryCreateInput,
} from "@/lib/partnership-inquiries";

/**
 * POST /api/partnership-inquiries: a company submits a Partnership Inquiry
 * about one Program (ticket 05; CONTEXT.md, Partnership Inquiry). Open to the
 * public by design -- the company being discussed with is not a Donor and has
 * no account, and requiring one would only keep the CSR team out of the form.
 * The follow-up status is never read from the body: a company cannot mark its
 * own Inquiry as followed up, and the module fixes the first value.
 *
 * The module checks every field itself and refuses with 400, or with 404 for a
 * Program that does not exist. A notification that could not be sent does not
 * change the answer: the Inquiry is recorded either way (see
 * createPartnershipInquiry).
 */
export async function POST(req: NextRequest) {
  const parsed = await req.json().catch(() => undefined);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return NextResponse.json({ error: "Body permintaan harus berupa objek JSON." }, { status: 400 });
  }

  try {
    const inquiry = await createPartnershipInquiry(prisma, parsed as PartnershipInquiryCreateInput);
    return NextResponse.json({ inquiry }, { status: 201 });
  } catch (error) {
    const refusal = partnershipInquiryErrorToHttp(error);
    if (refusal) return NextResponse.json({ error: refusal.error }, { status: refusal.status });
    throw error;
  }
}
