import { NextRequest, NextResponse } from "next/server";
import { Assignment } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { zakatSwitchedOn } from "@/lib/operations";
import { withHiddenAssignmentCheck } from "@/lib/withAssignmentCheck";

type RouteHandler = (req: NextRequest, context?: any) => Promise<NextResponse>;

/**
 * An Admin-only API of the zakat module (PKS pemenuhan 19, ADR 0028). While
 * the module is OFF, which is the default, it answers a literal 404 to
 * everyone, signed in or not, Admin included: the module does not exist. Only
 * then is the Admin check made (a signed-out visitor 401, a non-Admin the same
 * 404 as every Admin API, ticket 90).
 */
export function zakatAdminRoute(handler: RouteHandler): RouteHandler {
  const guarded = withHiddenAssignmentCheck(Assignment.ADMIN, handler);
  return async (req, context) => {
    if (!(await zakatSwitchedOn(prisma))) {
      return NextResponse.json({ error: "Not Found" }, { status: 404 });
    }
    return guarded(req, context);
  };
}
