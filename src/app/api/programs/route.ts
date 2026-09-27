import { NextRequest, NextResponse } from "next/server";
import { Assignment } from "@/generated/prisma/client";
import { withAssignmentCheck } from "@/lib/withAssignmentCheck";
import { prisma } from "@/lib/prisma";
import { createProgram, programErrorToHttp, type ProgramCreateInput } from "@/lib/programs";

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
