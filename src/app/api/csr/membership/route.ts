import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { csrErrorToHttp, joinCompany } from "@/lib/tim-csr";

/**
 * POST /api/csr/membership: a signed-in person joins the company of their own
 * email domain, creating it (with `companyName`) when it does not exist yet
 * (ticket E9/01, tahap 2). The domain is never read from the body. Not an
 * Assignment: nothing here touches roles. 201 when the company was created,
 * 200 otherwise.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => undefined);
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Body permintaan harus berupa objek JSON." }, { status: 400 });
  }

  try {
    const { created, ...membership } = await joinCompany(prisma, session.user.id, {
      companyName: (body as Record<string, unknown>).companyName,
    });
    return NextResponse.json({ membership }, { status: created ? 201 : 200 });
  } catch (error) {
    const refusal = csrErrorToHttp(error);
    if (refusal) return NextResponse.json({ error: refusal.error }, { status: refusal.status });
    throw error;
  }
}
