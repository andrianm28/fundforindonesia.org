import { NextRequest, NextResponse } from "next/server";
import { Assignment } from "@/generated/prisma/client";
import { withAssignmentCheck } from "@/lib/withAssignmentCheck";
import { prisma } from "@/lib/prisma";
import { updateProgram, programErrorToHttp } from "@/lib/programs";

/**
 * PATCH /api/programs/[id]: an Admin edits a CSR Program (ticket csr-01).
 * Every field is optional, but at least one change is required; the module's
 * refusals become 400 (or 404 for an unknown id) with their Indonesian
 * message. ADMIN-only, like the collection route.
 */
export const PATCH = withAssignmentCheck(
  Assignment.ADMIN,
  async (req: NextRequest, context?: { params?: Promise<Record<string, string>> }) => {
    const params = (await context?.params) ?? {};
    const parsed = await req.json().catch(() => undefined);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return NextResponse.json({ error: "Body permintaan harus berupa objek JSON." }, { status: 400 });
    }

    try {
      const program = await updateProgram(
        prisma,
        { programId: params.id, changes: parsed as Record<string, unknown> },
      );
      return NextResponse.json({ program });
    } catch (error) {
      const refusal = programErrorToHttp(error);
      if (refusal) return NextResponse.json({ error: refusal.error }, { status: refusal.status });
      throw error;
    }
  },
);
