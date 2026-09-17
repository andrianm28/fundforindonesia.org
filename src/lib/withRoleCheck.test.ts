import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

// Mock auth
vi.mock("@/lib/auth", () => ({
  getServerSession: vi.fn(),
}));

import { getServerSession } from "@/lib/auth";
import { withRoleCheck } from "./withRoleCheck";

const mockGetServerSession = vi.mocked(getServerSession);

function createMockRequest(url = "http://localhost:3000/api/test") {
  return new NextRequest(url);
}

describe("withRoleCheck", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when no session exists", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const handler = vi.fn();
    const wrapped = withRoleCheck("ADMIN", handler);
    const response = await wrapped(createMockRequest());

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe("Unauthorized");
    expect(handler).not.toHaveBeenCalled();
  });

  it("returns 401 when session has no user", async () => {
    mockGetServerSession.mockResolvedValue({ user: null } as any);

    const handler = vi.fn();
    const wrapped = withRoleCheck("ADMIN", handler);
    const response = await wrapped(createMockRequest());

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe("Unauthorized");
    expect(handler).not.toHaveBeenCalled();
  });

  it("returns 403 when user role is insufficient", async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1", role: "DONOR" },
    } as any);

    const handler = vi.fn();
    const wrapped = withRoleCheck("ADMIN", handler);
    const response = await wrapped(createMockRequest());

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toBe("Forbidden");
    expect(handler).not.toHaveBeenCalled();
  });

  it("returns 403 when CAMPAIGN_CREATOR tries to access MODERATOR endpoint", async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1", role: "CAMPAIGN_CREATOR" },
    } as any);

    const handler = vi.fn();
    const wrapped = withRoleCheck("MODERATOR", handler);
    const response = await wrapped(createMockRequest());

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toBe("Forbidden");
    expect(handler).not.toHaveBeenCalled();
  });

  it("passes through to handler when role meets minimum", async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1", role: "ADMIN" },
    } as any);

    const handlerResponse = NextResponse.json({ success: true });
    const handler = vi.fn().mockResolvedValue(handlerResponse);
    const wrapped = withRoleCheck("ADMIN", handler);
    const req = createMockRequest();
    const response = await wrapped(req);

    expect(handler).toHaveBeenCalledWith(req, undefined);
    expect(response).toBe(handlerResponse);
  });

  it("passes through when role exceeds minimum (hierarchy)", async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1", role: "ADMIN" },
    } as any);

    const handlerResponse = NextResponse.json({ data: "test" });
    const handler = vi.fn().mockResolvedValue(handlerResponse);
    const wrapped = withRoleCheck("MODERATOR", handler);
    const req = createMockRequest();
    const response = await wrapped(req);

    expect(handler).toHaveBeenCalledWith(req, undefined);
    expect(response).toBe(handlerResponse);
  });

  it("passes context to handler", async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1", role: "ADMIN" },
    } as any);

    const handlerResponse = NextResponse.json({ ok: true });
    const handler = vi.fn().mockResolvedValue(handlerResponse);
    const wrapped = withRoleCheck("ADMIN", handler);
    const req = createMockRequest();
    const context = { params: { id: "123" } };
    const response = await wrapped(req, context);

    expect(handler).toHaveBeenCalledWith(req, context);
    expect(response).toBe(handlerResponse);
  });

  it("defaults missing role to DONOR", async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1" },
    } as any);

    const handler = vi.fn();
    const wrapped = withRoleCheck("CAMPAIGN_CREATOR", handler);
    const response = await wrapped(createMockRequest());

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toBe("Forbidden");
    expect(handler).not.toHaveBeenCalled();
  });

  it("allows DONOR access when minimum is DONOR", async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1", role: "DONOR" },
    } as any);

    const handlerResponse = NextResponse.json({ allowed: true });
    const handler = vi.fn().mockResolvedValue(handlerResponse);
    const wrapped = withRoleCheck("DONOR", handler);
    const response = await wrapped(createMockRequest());

    expect(handler).toHaveBeenCalled();
    expect(response).toBe(handlerResponse);
  });

  it("returns 500 on unexpected errors (never leaks 403)", async () => {
    mockGetServerSession.mockRejectedValue(new Error("DB connection failed"));

    const handler = vi.fn();
    const wrapped = withRoleCheck("ADMIN", handler);
    const response = await wrapped(createMockRequest());

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe("Internal Server Error");
    expect(handler).not.toHaveBeenCalled();
  });

  it("returns 500 when handler throws (not 403)", async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1", role: "ADMIN" },
    } as any);

    const handler = vi.fn().mockRejectedValue(new Error("Something broke"));
    const wrapped = withRoleCheck("ADMIN", handler);
    const response = await wrapped(createMockRequest());

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe("Internal Server Error");
  });
});
