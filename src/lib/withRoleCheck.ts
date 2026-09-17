import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { Role } from "@/generated/prisma/client";
import { isAtLeast } from "@/lib/roles";

type RouteHandler = (
  req: NextRequest,
  context?: any
) => Promise<NextResponse>;

/**
 * Higher-order function that wraps a Next.js API route handler with role-based
 * authorization. Checks the user's session and role before allowing the handler
 * to execute.
 *
 * - Returns 401 if no session (unauthenticated)
 * - Returns 403 if role is insufficient
 * - Returns 500 on unexpected errors (never leaks 403 on system errors)
 * - Passes through to the handler if authorized
 */
export function withRoleCheck(
  minimumRole: Role,
  handler: RouteHandler
): RouteHandler {
  return async (req: NextRequest, context?: any) => {
    try {
      const session = await getServerSession();

      if (!session?.user) {
        return NextResponse.json(
          { error: "Unauthorized" },
          { status: 401 }
        );
      }

      const userRole = session.user.role ?? "DONOR";

      if (!isAtLeast(userRole as Role, minimumRole)) {
        return NextResponse.json(
          { error: "Forbidden" },
          { status: 403 }
        );
      }

      return await handler(req, context);
    } catch (error) {
      return NextResponse.json(
        { error: "Internal Server Error" },
        { status: 500 }
      );
    }
  };
}
