import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Ticket 42 AC 3, proved at the public seam (ticket 44): once an Admin revokes
 * an assignment through DELETE /api/admin/users/[id]/assignments, the very next
 * request from that user to a route guarded by it is a 403.
 *
 * Nothing between the revocation and the guarded route is stubbed except the
 * database and the cookie: `getServerSession` below runs the REAL `jwt` and
 * `session` callbacks of `authOptions` (the per-request refresh that reads
 * assignments fresh), over an in-memory `UserAssignment` table that the REAL
 * `revokeAssignment` writes to. The token is the one issued at login and is
 * never rebuilt, which is the stale-session case the ticket worries about.
 */

type AssignmentRow = { userId: string; assignment: "VERIFIER" | "ADMIN" };
const table: AssignmentRow[] = [];

vi.mock("@/lib/prisma", () => {
  const key = (w: { userId_assignment: { userId: string; assignment: string } }) => w.userId_assignment;
  const tx = {
    userAssignment: {
      findUnique: vi.fn(async ({ where }: { where: never }) => {
        const k = key(where);
        return table.find((r) => r.userId === k.userId && r.assignment === k.assignment) ?? null;
      }),
      delete: vi.fn(async ({ where }: { where: never }) => {
        const k = key(where);
        const i = table.findIndex((r) => r.userId === k.userId && r.assignment === k.assignment);
        return table.splice(i, 1)[0];
      }),
      count: vi.fn(async ({ where }: { where: { assignment: string } }) =>
        table.filter((r) => r.assignment === where.assignment).length,
      ),
    },
    assignmentAuditEntry: { create: vi.fn(async () => ({})) },
    notification: { create: vi.fn(async () => ({})) },
    $queryRaw: vi.fn(async () => []),
  };
  return {
    prisma: {
      ...tx,
      user: {
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) => ({
          assignments: table.filter((r) => r.userId === where.id).map((r) => ({ assignment: r.assignment })),
        })),
      },
      bankAccountVerificationRequest: { findMany: vi.fn(async () => []) },
      assignmentAuditEntry: { ...tx.assignmentAuditEntry, findMany: vi.fn(async () => []) },
      $transaction: (fn: (client: unknown) => unknown) => fn(tx),
    },
  };
});

// The acting person, as the session cookie names them. Only the cookie is
// replaced: the session is built by the real next-auth callbacks.
let cookieUserId: string | null = null;
vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
  return {
    ...actual,
    getServerSession: async () => {
      if (!cookieUserId) return null;
      const token = await actual.authOptions.callbacks!.jwt!({
        token: { id: cookieUserId } as never,
        user: undefined as never,
        account: null,
        profile: undefined,
        trigger: undefined,
      } as never);
      return actual.authOptions.callbacks!.session!({
        session: { user: {}, expires: "2099-01-01" } as never,
        token,
        newSession: undefined,
        trigger: "update",
      } as never);
    },
  };
});

import { DELETE, GET as auditTrail } from "./route";
import { GET as verifierQueue } from "@/app/api/moderasi/bank-accounts/route";

function revokeRequest(userId: string, assignment: string) {
  return DELETE(
    new NextRequest(`http://localhost:3000/api/admin/users/${userId}/assignments`, {
      method: "DELETE",
      body: JSON.stringify({ assignment }),
      headers: { "Content-Type": "application/json" },
    }),
    { params: Promise.resolve({ id: userId }) },
  );
}

function auditTrailRequest(userId: string) {
  return auditTrail(new NextRequest(`http://localhost:3000/api/admin/users/${userId}/assignments`), {
    params: Promise.resolve({ id: userId }),
  });
}

function verifierQueueRequest() {
  return verifierQueue(new NextRequest("http://localhost:3000/api/moderasi/bank-accounts"));
}

describe("a revoked assignment stops working on the very next request", () => {
  beforeEach(() => {
    table.length = 0;
    table.push(
      { userId: "admin-1", assignment: "ADMIN" },
      { userId: "admin-2", assignment: "ADMIN" },
      { userId: "verifier-1", assignment: "VERIFIER" },
      { userId: "both-1", assignment: "VERIFIER" },
      { userId: "both-1", assignment: "ADMIN" },
    );
    cookieUserId = null;
  });

  it("answers 403 to a revoked Verifier on a Verifier-guarded route, having answered 200 before", async () => {
    cookieUserId = "verifier-1";
    expect((await verifierQueueRequest()).status).toBe(200);

    cookieUserId = "admin-1";
    expect((await revokeRequest("verifier-1", "VERIFIER")).status).toBe(200);

    cookieUserId = "verifier-1";
    expect((await verifierQueueRequest()).status).toBe(403);
  });

  it("answers 403 to a revoked Admin on an Admin-guarded route, having answered 200 before", async () => {
    cookieUserId = "admin-2";
    expect((await auditTrailRequest("admin-1")).status).toBe(200);

    cookieUserId = "admin-1";
    expect((await revokeRequest("admin-2", "ADMIN")).status).toBe(200);

    cookieUserId = "admin-2";
    expect((await auditTrailRequest("admin-1")).status).toBe(403);
  });

  it("removes only the revoked assignment: a user who holds both keeps the other", async () => {
    cookieUserId = "admin-1";
    expect((await revokeRequest("both-1", "VERIFIER")).status).toBe(200);

    cookieUserId = "both-1";
    expect((await verifierQueueRequest()).status).toBe(403);
    expect((await auditTrailRequest("admin-1")).status).toBe(200);
  });
});
