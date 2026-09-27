import { NextRequest, NextResponse } from "next/server";
import { Assignment } from "@/generated/prisma/client";
import { getServerSession } from "@/lib/auth";
import { withAssignmentCheck } from "@/lib/withAssignmentCheck";
import { checklistErrorToHttp } from "@/lib/verification-checklist";

/**
 * Wraps an Admin checklist-editor handler (verification-request 04): only an
 * ADMIN assignment holder gets through (401 or 403 otherwise), the handler
 * receives the acting Admin's id, the route params, the query string and the
 * parsed JSON body (400 if it is not JSON), and the checklist module's
 * refusals become 400 or 404 with their Indonesian message.
 */
export function checklistRoute(
  handler: (input: { actorId: string; params: Record<string, string>; query: URLSearchParams; body: Record<string, unknown> }) => Promise<NextResponse>,
  options: { readsBody: boolean } = { readsBody: true }
) {
  return withAssignmentCheck(Assignment.ADMIN, async (req: NextRequest, context?: { params?: Promise<Record<string, string>> }) => {
    const session = await getServerSession();
    const actorId = session!.user.id as string;
    const params = (await context?.params) ?? {};
    const query = req.nextUrl.searchParams;

    let body: Record<string, unknown> = {};
    if (options.readsBody) {
      const parsed = await req.json().catch(() => undefined);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        return NextResponse.json({ error: "Body permintaan harus berupa objek JSON." }, { status: 400 });
      }
      body = parsed as Record<string, unknown>;
    }

    try {
      return await handler({ actorId, params, query, body });
    } catch (error) {
      const refusal = checklistErrorToHttp(error);
      if (refusal) return NextResponse.json({ error: refusal.error }, { status: refusal.status });
      throw error;
    }
  });
}
