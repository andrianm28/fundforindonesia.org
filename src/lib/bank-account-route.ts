import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { refusalResponse } from "@/lib/refusal-response";

/**
 * Wraps an owner's own Bank Account handler (ticket 16): any signed-in
 * person may reach it (401 if not signed in), unlike `partnerOrganisationRoute`,
 * which gates on the VERIFIER assignment -- ownership is the rule here, not
 * an assignment, the same as `POST /api/campaigns` (ADR 0018; `Assignment`
 * holds only VERIFIER and ADMIN, no FUNDRAISER). The handler receives the
 * acting person's id, the route params and the parsed JSON body (400 if a
 * body it reads is not a JSON object); typed refusals answer through
 * `refusalResponse`.
 */
export function bankAccountRoute(
  handler: (input: {
    actorId: string;
    params: Record<string, string>;
    body: Record<string, unknown>;
  }) => Promise<NextResponse>,
  options: { readsBody: boolean } = { readsBody: true }
) {
  return async (req: NextRequest, context?: { params?: Promise<Record<string, string>> }) => {
    const session = await getServerSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const actorId = session.user.id as string;
    const params = (await context?.params) ?? {};

    let body: Record<string, unknown> = {};
    if (options.readsBody) {
      const parsed = await req.json().catch(() => undefined);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        return NextResponse.json({ error: "Body permintaan harus berupa objek JSON." }, { status: 400 });
      }
      body = parsed as Record<string, unknown>;
    }

    try {
      return await handler({ actorId, params, body });
    } catch (error) {
      const refusal = refusalResponse(error);
      if (refusal) return refusal;
      throw error;
    }
  };
}
