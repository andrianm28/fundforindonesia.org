import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';

import { inquiryRow, makeInquiryDb } from '../../../../../../tests/support/in-memory-inquiry-db';

/**
 * PATCH /api/admin/partnership-inquiries/[id] (ticket 06): the one door the
 * partnership team moves a follow-up through. The rules are the module's
 * (src/lib/partnership-inquiry-followup.test.ts); what this file pins is the
 * route's own: the ADMIN gate (ADR 0005), that the company can never reach
 * this door, and that the body says nothing more than which status to move to.
 */
vi.mock("@/lib/auth", () => ({ getServerSession: vi.fn() }));

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { getServerSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PATCH } from "./route";

const mockGetServerSession = getServerSession as unknown as Mock;

function body(payload: unknown): string {
  return JSON.stringify(payload);
}

function patch(payload: unknown, id = "inquiry-1") {
  const req = new NextRequest(`http://localhost:3000/api/admin/partnership-inquiries/${id}`, {
    method: "PATCH",
    body: typeof payload === "string" ? payload : body(payload),
    headers: { "Content-Type": "application/json" },
  });
  return PATCH(req, { params: Promise.resolve({ id }) });
}

let db: ReturnType<typeof makeInquiryDb>;

/** Points the mocked client at one database, delegates and transaction alike. */
function loadDb(seed: Parameters<typeof makeInquiryDb>[0]) {
  db = makeInquiryDb(seed);
  const target = prisma as unknown as Record<string, unknown>;
  target.partnershipInquiry = db.prisma.partnershipInquiry;
  target.partnershipInquiryStatusChange = db.prisma.partnershipInquiryStatusChange;
  target.$transaction = db.prisma.$transaction;
  return db;
}

beforeEach(() => {
  vi.clearAllMocks();
  loadDb({ inquiries: [inquiryRow()] });
  mockGetServerSession.mockResolvedValue({ user: { id: "admin-1", assignments: ["ADMIN"] } });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("PATCH /api/admin/partnership-inquiries/[id]", () => {
  it("moves the follow-up forward and answers with the Inquiry and the change recorded", async () => {
    const res = await patch({ status: "IN_PROGRESS" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(
      expect.objectContaining({
        inquiry: expect.objectContaining({ id: "inquiry-1", status: "IN_PROGRESS" }),
        change: expect.objectContaining({
          fromStatus: "NOT_YET_FOLLOWED_UP",
          toStatus: "IN_PROGRESS",
          actedById: "admin-1",
        }),
      }),
    );
    expect(db.changes).toHaveLength(1);
  });

  it("refuses anyone without a session, and anyone without the ADMIN assignment", async () => {
    mockGetServerSession.mockResolvedValue(null);
    expect((await patch({ status: "IN_PROGRESS" })).status).toBe(401);

    mockGetServerSession.mockResolvedValue({ user: { id: "user-2", assignments: ["VERIFIER"] } });
    expect((await patch({ status: "IN_PROGRESS" })).status).toBe(403);

    expect(db.inquiries[0].status).toBe("NOT_YET_FOLLOWED_UP");
    expect(db.changes).toEqual([]);
  });

  it("refuses a body that is not an object naming a status", async () => {
    expect((await patch("not json")).status).toBe(400);
    expect((await patch([{ status: "IN_PROGRESS" }])).status).toBe(400);
    expect((await patch({})).status).toBe(400);
    expect((await patch({ status: "ARCHIVED" })).status).toBe(400);
    expect(db.changes).toEqual([]);
  });

  it("refuses an Inquiry nobody submitted, and one that cannot move that way", async () => {
    expect((await patch({ status: "IN_PROGRESS" }, "inquiry-404")).status).toBe(404);

    const done = loadDb({ inquiries: [inquiryRow({ status: "DONE" })] });
    const res = await patch({ status: "IN_PROGRESS" });

    expect(res.status).toBe(409);
    expect(done.changes).toEqual([]);
  });

  it("never moves a Program, a company name or a need: the body can only name a status", async () => {
    await patch({ status: "IN_PROGRESS", programId: "program-2", companyName: "PT Lain", needs: "lain" });

    expect(db.inquiries[0].programId).toBe("program-1");
    expect(db.inquiries[0].companyName).toBe("PT Sinar Abadi");
    expect(db.inquiries[0].needs).toBe(inquiryRow().needs);
    expect(db.inquiries[0].status).toBe("IN_PROGRESS");
  });
});
