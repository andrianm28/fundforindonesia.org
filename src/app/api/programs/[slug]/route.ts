import { NextRequest, NextResponse } from "next/server";
import { Assignment } from "@/generated/prisma/client";
import { withAssignmentCheck } from "@/lib/withAssignmentCheck";
import { prisma } from "@/lib/prisma";
import { ProgramNotFoundError, programErrorToHttp, readProgram, updateProgram } from "@/lib/programs";

/**
 * /api/programs/[slug]. The segment is a slug, as it is for a Campaign: it is
 * the one identifier a public link can carry, and the portfolio links to it.
 *
 * GET is the public Program detail (ticket csr-04; PRD FFI-09) and is open to
 * anyone: a Program is a catalog entry with no lifecycle, so there is nothing
 * about it to keep private. Its answer is the module's -- every field a CSR
 * team reads, and no money field at all, because a Program never receives
 * money online (ADR 0002).
 *
 * PATCH is the Admin edit (ticket csr-01): the slug is resolved to the row's
 * id and the module's own refusals become 400, or 404 for a slug no Program
 * has. ADMIN-only (401 without a session, 403 without the assignment).
 */
export async function GET(_req: NextRequest, context: { params: Promise<Record<string, string>> }) {
  const params = (await context?.params) ?? {};

  try {
    const program = await readProgram(prisma, params.slug);
    const response = NextResponse.json({ program });

    // Every visitor gets the same answer, so this one may be shared; see the
    // collection route for the same reasoning.
    response.headers.set("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
    return response;
  } catch (error) {
    const refusal = programErrorToHttp(error);
    if (refusal) return NextResponse.json({ error: refusal.error }, { status: refusal.status });
    throw error;
  }
}

export const PATCH = withAssignmentCheck(
  Assignment.ADMIN,
  async (req: NextRequest, context?: { params?: Promise<Record<string, string>> }) => {
    const params = (await context?.params) ?? {};
    const parsed = await req.json().catch(() => undefined);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return NextResponse.json({ error: "Body permintaan harus berupa objek JSON." }, { status: 400 });
    }

    try {
      // The module edits by id and refuses for an unknown one, so the slug is
      // resolved here; a slug no Program has is the same 404 either way.
      const current = await prisma.program.findUnique({ where: { slug: params.slug }, select: { id: true } });
      if (!current) throw new ProgramNotFoundError();

      const program = await updateProgram(
        prisma,
        { programId: current.id, changes: parsed as Record<string, unknown> },
      );
      return NextResponse.json({ program });
    } catch (error) {
      const refusal = programErrorToHttp(error);
      if (refusal) return NextResponse.json({ error: refusal.error }, { status: refusal.status });
      throw error;
    }
  },
);
