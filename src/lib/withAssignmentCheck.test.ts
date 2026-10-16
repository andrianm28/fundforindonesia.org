import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

vi.mock("@/lib/auth", () => ({
  getServerSession: vi.fn(),
}));

import { getServerSession } from "@/lib/auth";
import { withAssignmentCheck, withHiddenAssignmentCheck } from "./withAssignmentCheck";

const mockGetServerSession = vi.mocked(getServerSession);

function createMockRequest(url = "http://localhost:3000/api/test") {
  return new NextRequest(url);
}

describe("withAssignmentCheck", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when no session exists", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const handler = vi.fn();
    const wrapped = withAssignmentCheck("ADMIN", handler);
    const response = await wrapped(createMockRequest());

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe("Unauthorized");
    expect(handler).not.toHaveBeenCalled();
  });

  it("returns 401 when session has no user", async () => {
    mockGetServerSession.mockResolvedValue({ user: null } as any);

    const handler = vi.fn();
    const wrapped = withAssignmentCheck("ADMIN", handler);
    const response = await wrapped(createMockRequest());

    expect(response.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it("returns 403 when the required assignment is missing", async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1", assignments: ["VERIFIER"] },
    } as any);

    const handler = vi.fn();
    const wrapped = withAssignmentCheck("ADMIN", handler);
    const response = await wrapped(createMockRequest());

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toBe("Forbidden");
    expect(handler).not.toHaveBeenCalled();
  });

  it("returns 403 when assignments is missing entirely, even for an ADMIN-ranked user", async () => {
    // The exact scenario ADR 0005 exists to fix: rank alone must never
    // substitute for the assignment a route requires.
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1" },
    } as any);

    const handler = vi.fn();
    const wrapped = withAssignmentCheck("ADMIN", handler);
    const response = await wrapped(createMockRequest());

    expect(response.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });

  it("calls the handler when the required assignment is present", async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1", assignments: ["ADMIN"] },
    } as any);

    const handler = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));
    const wrapped = withAssignmentCheck("ADMIN", handler);
    const response = await wrapped(createMockRequest());

    expect(handler).toHaveBeenCalledOnce();
    const body = await response.json();
    expect(body.ok).toBe(true);
  });

  it("passes a user holding both assignments through either gate", async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1", assignments: ["VERIFIER", "ADMIN"] },
    } as any);

    const handler = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));

    const adminWrapped = withAssignmentCheck("ADMIN", handler);
    expect((await adminWrapped(createMockRequest())).status).toBe(200);

    const verifierWrapped = withAssignmentCheck("VERIFIER", handler);
    expect((await verifierWrapped(createMockRequest())).status).toBe(200);
  });

  it("returns 500 and does not leak 403 when the handler throws", async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1", assignments: ["ADMIN"] },
    } as any);

    const handler = vi.fn().mockRejectedValue(new Error("boom"));
    const wrapped = withAssignmentCheck("ADMIN", handler);
    const response = await wrapped(createMockRequest());

    expect(response.status).toBe(500);
  });

  it("returns 500 when getServerSession itself throws", async () => {
    mockGetServerSession.mockRejectedValue(new Error("session lookup failed"));

    const handler = vi.fn();
    const wrapped = withAssignmentCheck("ADMIN", handler);
    const response = await wrapped(createMockRequest());

    expect(response.status).toBe(500);
    expect(handler).not.toHaveBeenCalled();
  });
});

/**
 * The Admin and Moderasi APIs answer a signed-in user without the assignment
 * the same 404 as a route that does not exist, so they do not confirm the
 * panel exists (owner decision 2026-10-14, ticket 90: "yang lain 404").
 * Signed-out callers still get 401, as the login redirect still applies to
 * the pages.
 */
type Session = Awaited<ReturnType<typeof getServerSession>>;

describe("withHiddenAssignmentCheck", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when no session exists", async () => {
    mockGetServerSession.mockResolvedValue(null);
    const handler = vi.fn();
    const response = await withHiddenAssignmentCheck("ADMIN", handler)(createMockRequest());
    expect(response.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it("returns 404, not 403, when the required assignment is missing", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1", assignments: ["VERIFIER"] } } as Session);
    const handler = vi.fn();
    const response = await withHiddenAssignmentCheck("ADMIN", handler)(createMockRequest());
    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("Not Found");
    expect(handler).not.toHaveBeenCalled();
  });

  it("calls the handler when the required assignment is present", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1", assignments: ["ADMIN"] } } as Session);
    const handler = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));
    const response = await withHiddenAssignmentCheck("ADMIN", handler)(createMockRequest());
    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
  });
});
