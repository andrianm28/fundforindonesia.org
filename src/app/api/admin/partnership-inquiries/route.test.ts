import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';

import {
  inquiryChangeRow,
  inquiryRow,
  makeInquiryDb,
  programOfInquiry,
  userRow,
} from '../../../../../tests/support/in-memory-inquiry-db';

/**
 * GET /api/admin/partnership-inquiries (ticket 06): the queue the partnership
 * team works from. Every Inquiry, with the Program it is about, the company
 * that asked, and how far the follow-up has got. A queue of one company's
 * contact details is not something the public can ask for, so the ADMIN gate
 * (ADR 0005) is the first thing this file pins.
 */
vi.mock("@/lib/auth", () => ({ getServerSession: vi.fn() }));

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { getServerSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { GET } from "./route";

const mockGetServerSession = getServerSession as unknown as Mock;

function get() {
  return GET(new NextRequest("http://localhost:3000/api/admin/partnership-inquiries"), {});
}

function loadDb(seed: Parameters<typeof makeInquiryDb>[0]) {
  const db = makeInquiryDb(seed);
  const target = prisma as unknown as Record<string, unknown>;
  target.partnershipInquiry = db.prisma.partnershipInquiry;
  target.partnershipInquiryStatusChange = db.prisma.partnershipInquiryStatusChange;
  target.$transaction = db.prisma.$transaction;
  return db;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetServerSession.mockResolvedValue({ user: { id: "admin-1", assignments: ["ADMIN"] } });
  loadDb({
    inquiries: [
      inquiryRow({ id: "inquiry-1", createdAt: new Date("2026-09-20T00:00:00Z") }),
      inquiryRow({
        id: "inquiry-2",
        companyName: "PT Bumi Hijau",
        status: "IN_PROGRESS",
        createdAt: new Date("2026-09-25T00:00:00Z"),
      }),
    ],
    changes: [
      inquiryChangeRow({
        id: "change-1",
        inquiryId: "inquiry-2",
        toStatus: "IN_PROGRESS",
        actedById: "admin-2",
        actedAt: new Date("2026-09-26T00:00:00Z"),
      }),
    ],
    users: [userRow(), userRow({ id: "admin-2", name: "Bagas Kemitraan" })],
  });
});

describe("GET /api/admin/partnership-inquiries", () => {
  it("lists every Inquiry with its Program, company and current status", async () => {
    const res = await get();

    expect(res.status).toBe(200);
    const { inquiries } = (await res.json()) as {
      inquiries: {
        id: string;
        companyName: string;
        status: string;
        program: { title: string; sector: string };
        lastStatusChange: { actedByName: string } | null;
      }[];
    };
    expect(inquiries).toEqual([
      expect.objectContaining({
        id: "inquiry-2",
        companyName: "PT Bumi Hijau",
        status: "IN_PROGRESS",
        program: expect.objectContaining(programOfInquiry()),
        lastStatusChange: expect.objectContaining({ actedByName: "Bagas Kemitraan" }),
      }),
      expect.objectContaining({
        id: "inquiry-1",
        companyName: "PT Sinar Abadi",
        status: "NOT_YET_FOLLOWED_UP",
        lastStatusChange: null,
      }),
    ]);
  });

  it("answers an empty queue as an empty list", async () => {
    loadDb({});

    const res = await get();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ inquiries: [] });
  });

  it("refuses anyone without a session, and anyone without the ADMIN assignment", async () => {
    mockGetServerSession.mockResolvedValue(null);
    expect((await get()).status).toBe(401);

    mockGetServerSession.mockResolvedValue({ user: { id: "user-2", assignments: ["VERIFIER"] } });
    expect((await get()).status).toBe(403);
  });
});
