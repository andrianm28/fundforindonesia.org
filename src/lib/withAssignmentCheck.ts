import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { Assignment } from "@/generated/prisma/client";

type RouteHandler = (
  req: NextRequest,
  context?: any
) => Promise<NextResponse>;

/**
 * True if the given assignments include the required one. Treats a
 * missing list as no assignments -- deny by default, never assume.
 */
export function hasAssignment(
  assignments: Assignment[] | undefined,
  required: Assignment
): boolean {
  return (assignments ?? []).includes(required);
}

/**
 * Higher-order function that wraps a Next.js API route handler with
 * assignment-based authorization (ADR 0005): Verifier and Admin are
 * independent assignments, not ranks, so this checks for the ONE specific
 * assignment a route requires rather than a minimum rank. A person who
 * holds both assignments passes both checks; a person who holds only one
 * cannot use the other's routes by virtue of outranking it, which is
 * exactly what the Role hierarchy used to allow.
 *
 * - Returns 401 if no session (unauthenticated)
 * - Returns 403 if the required assignment is missing
 * - Returns 500 on unexpected errors (never leaks 403 on system errors)
 * - Passes through to the handler if authorized
 */
export function withAssignmentCheck(
  requiredAssignment: Assignment,
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

      if (!hasAssignment(session.user.assignments, requiredAssignment)) {
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
