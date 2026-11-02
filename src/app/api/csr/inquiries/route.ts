import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { partnershipInquiryErrorToHttp } from "@/lib/partnership-inquiries";
import { csrErrorToHttp, listCompanyInquiries, submitCompanyInquiry } from "@/lib/tim-csr";

/**
 * The Tim CSR member's Partnership Inquiries (ticket E9/01, tahap 2). Both
 * methods answer a literal 404 to anyone who is not a verified member of a
 * company, signed in or not; the company is always the caller's own, never a
 * value from the request.
 */
const NOT_FOUND = () => NextResponse.json({ error: "Not Found" }, { status: 404 });

export async function GET() {
  const session = await getServerSession();
  try {
    return NextResponse.json(await listCompanyInquiries(prisma, session?.user?.id));
  } catch (error) {
    if (csrErrorToHttp(error)?.status === 404) return NOT_FOUND();
    throw error;
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession();
  const parsed = await req.json().catch(() => undefined);
  const body = parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  try {
    // Only these three fields are read; a company id in the body is ignored.
    const inquiry = await submitCompanyInquiry(prisma, session?.user?.id, {
      programId: body?.programId,
      needs: body?.needs,
      contactPhone: body?.contactPhone,
    });
    return NextResponse.json({ inquiry: { id: inquiry.id, status: inquiry.status } }, { status: 201 });
  } catch (error) {
    if (csrErrorToHttp(error)?.status === 404) return NOT_FOUND();
    const refusal = partnershipInquiryErrorToHttp(error);
    if (refusal) return NextResponse.json({ error: refusal.error }, { status: refusal.status });
    throw error;
  }
}
