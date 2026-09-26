import { NextRequest, NextResponse } from "next/server";
import { Assignment } from "@/generated/prisma/client";
import { getServerSession } from "@/lib/auth";
import { withAssignmentCheck } from "@/lib/withAssignmentCheck";
import { domainErrorToHttp } from "@/lib/domain-errors";

/**
 * Wraps a Verifier's Partner Organisation register handler (prd-compliance
 * 10): only a VERIFIER assignment holder gets through (401 or 403
 * otherwise); the handler receives the acting Verifier's id, the route
 * params and the parsed JSON body (400 if a body it reads is not a JSON
 * object); typed refusals answer through `domainErrorToHttp`.
 */
export function partnerOrganisationRoute(
  handler: (input: {
    actorId: string;
    params: Record<string, string>;
    body: Record<string, unknown>;
  }) => Promise<NextResponse>,
  options: { readsBody: boolean } = { readsBody: true }
) {
  return withAssignmentCheck(
    Assignment.VERIFIER,
    async (req: NextRequest, context?: { params?: Promise<Record<string, string>> }) => {
      const session = await getServerSession();
      const actorId = session!.user.id as string;
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
        const refusal = domainErrorToHttp(error);
        if (refusal) return NextResponse.json(refusal.body, { status: refusal.status });
        throw error;
      }
    }
  );
}
