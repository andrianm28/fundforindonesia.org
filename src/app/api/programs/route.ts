import { NextRequest, NextResponse } from "next/server";
import { Assignment } from "@/generated/prisma/client";
import { withAssignmentCheck } from "@/lib/withAssignmentCheck";
import { prisma } from "@/lib/prisma";
import { createProgram, listProgramPortfolio, programErrorToHttp, type ProgramCreateInput } from "@/lib/programs";

/**
 * GET /api/programs: the public CSR portfolio (ticket csr-04; PRD FFI-09),
 * every Program grouped by the four fixed Sectors, optionally narrowed to one
 * with `?sector=`. Open to anyone -- the catalog is public, and a Program
 * takes no money online (ADR 0002), so there is nothing here to gate.
 *
 * The answer is the module's, not this route's: the grouping, the fixed
 * Sector order, and the fields a card may carry are all decided in
 * src/lib/programs.ts, which is also where an unknown Sector becomes 400.
 */
export async function GET(req: NextRequest) {
  const sector = new URL(req.url).searchParams.get("sector") ?? undefined;

  try {
    const portfolio = await listProgramPortfolio(prisma, { sector });
    const response = NextResponse.json(portfolio);

    // The same shared cache the Campaign list uses: a Program edit is a
    // catalog edit an Admin makes rarely, and every visitor gets the same one.
    response.headers.set("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
    return response;
  } catch (error) {
    const refusal = programErrorToHttp(error);
    if (refusal) return NextResponse.json({ error: refusal.error }, { status: refusal.status });
    throw error;
  }
}

/**
 * POST /api/programs: an Admin creates a CSR Program (ticket csr-01). The
 * body carries every field src/lib/programs.ts knows; the module's refusals
 * become 400 with their Indonesian message. Anything else is ADMIN-only
 * (401 without a session, 403 without the assignment).
 */
export const POST = withAssignmentCheck(Assignment.ADMIN, async (req: NextRequest) => {
  const parsed = await req.json().catch(() => undefined);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return NextResponse.json({ error: "Body permintaan harus berupa objek JSON." }, { status: 400 });
  }

  try {
    // The module checks every field itself and refuses with 400, so the body
    // only has to be known to be a JSON object here (as in platform-fee).
    const program = await createProgram(prisma, parsed as ProgramCreateInput);
    return NextResponse.json({ program }, { status: 201 });
  } catch (error) {
    const refusal = programErrorToHttp(error);
    if (refusal) return NextResponse.json({ error: refusal.error }, { status: refusal.status });
    throw error;
  }
});
