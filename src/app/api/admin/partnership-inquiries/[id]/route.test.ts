import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';

import {
  inquiryRow,
  makeInquiryDb,
  proposalRow,
  userRow,
} from '../../../../../../tests/support/in-memory-inquiry-db';

/**
 * GET and PATCH /api/admin/partnership-inquiries/[id] (tickets 06 and
 * pks-pemenuhan/17): the one door the partnership team reads an Inquiry in full
 * and changes its stage, PIC and note through. The rules are the module's
 * (src/lib/partnership-inquiry-followup.test.ts); what this file pins is the
 * route's own: the ADMIN gate (ADR 0005) with the literal 404 for everyone
 * else, that the company can never reach this door, and that the body says
 * nothing more than the stage, the PIC and the note.
 */
vi.mock("@/lib/auth", () => ({ getServerSession: vi.fn() }));

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { getServerSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { GET, PATCH } from "./route";

const mockGetServerSession = getServerSession as unknown as Mock;

function patch(payload: unknown, id = "inquiry-1") {
  const req = new NextRequest(`http://localhost:3000/api/admin/partnership-inquiries/${id}`, {
    method: "PATCH",
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
    headers: { "Content-Type": "application/json" },
  });
  return PATCH(req, { params: Promise.resolve({ id }) });
}

function get(id = "inquiry-1") {
  const req = new NextRequest(`http://localhost:3000/api/admin/partnership-inquiries/${id}`);
  return GET(req, { params: Promise.resolve({ id }) });
}

let db: ReturnType<typeof makeInquiryDb>;

const USERS = [userRow(), userRow({ id: "admin-2", name: "Bagas Kemitraan" }), userRow({ id: "fundraiser-1", name: "Siti Penggalang" })];

/** Points the mocked client at one database, delegates and transaction alike. */
function loadDb(seed: Parameters<typeof makeInquiryDb>[0]) {
  db = makeInquiryDb({ users: USERS, adminIds: ["admin-1", "admin-2"], ...seed });
  const target = prisma as unknown as Record<string, unknown>;
  target.partnershipInquiry = db.prisma.partnershipInquiry;
  target.partnershipInquiryStatusChange = db.prisma.partnershipInquiryStatusChange;
  target.userAssignment = db.prisma.userAssignment;
  target.document = db.prisma.document;
  target.$transaction = db.prisma.$transaction;
  return db;
}

beforeEach(() => {
  vi.clearAllMocks();
  loadDb({ inquiries: [inquiryRow()], documents: [proposalRow()] });
  mockGetServerSession.mockResolvedValue({ user: { id: "admin-1", assignments: ["ADMIN"] } });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("PATCH /api/admin/partnership-inquiries/[id]", () => {
  it("changes the stage and answers with the Inquiry and the change recorded", async () => {
    const res = await patch({ status: "NEGOTIATION", note: "Sudah bertemu." });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(
      expect.objectContaining({
        inquiry: expect.objectContaining({ id: "inquiry-1", status: "NEGOTIATION" }),
        change: expect.objectContaining({ fromStatus: "NEW", toStatus: "NEGOTIATION", actedById: "admin-1", note: "Sudah bertemu." }),
      }),
    );
    expect(db.changes).toHaveLength(1);
  });

  it("assigns a PIC, and the assignment and the note land in the history", async () => {
    const res = await patch({ picId: "admin-2", note: "Bagas pegang." });

    expect(res.status).toBe(200);
    expect(db.inquiries[0].picId).toBe("admin-2");
    expect(db.changes).toEqual([
      expect.objectContaining({ picChanged: true, picToId: "admin-2", note: "Bagas pegang.", actedById: "admin-1" }),
    ]);
  });

  it("refuses a PIC who is not an Admin with a 400", async () => {
    const res = await patch({ picId: "fundraiser-1" });

    expect(res.status).toBe(400);
    expect(db.inquiries[0].picId).toBeNull();
    expect(db.changes).toEqual([]);
  });

  it("answers a literal 404 to anyone without the ADMIN assignment, and 401 to nobody", async () => {
    mockGetServerSession.mockResolvedValue(null);
    expect((await patch({ status: "CONTACTED" })).status).toBe(401);

    for (const assignments of [["VERIFIER"], [], ["MODERATOR"]]) {
      mockGetServerSession.mockResolvedValue({ user: { id: "user-2", assignments } });
      const res = await patch({ status: "CONTACTED" });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "Not Found" });
    }

    expect(db.inquiries[0].status).toBe("NEW");
    expect(db.changes).toEqual([]);
  });

  it("refuses a body that is not an object, or that names a status the platform lacks", async () => {
    expect((await patch("not json")).status).toBe(400);
    expect((await patch([{ status: "CONTACTED" }])).status).toBe(400);
    expect((await patch({ status: "ARCHIVED" })).status).toBe(400);
    expect((await patch({ status: "IN_PROGRESS" })).status).toBe(400);
    expect(db.changes).toEqual([]);
  });

  it("refuses a body that changes nothing, with a 409", async () => {
    expect((await patch({})).status).toBe(409);
    expect((await patch({ status: "NEW" })).status).toBe(409);
    expect(db.changes).toEqual([]);
  });

  it("refuses an Inquiry nobody submitted with a 404", async () => {
    expect((await patch({ status: "CONTACTED" }, "inquiry-404")).status).toBe(404);
  });

  it("needs a reason to leave Selesai, and takes it as the note", async () => {
    const closed = loadDb({ inquiries: [inquiryRow({ status: "DONE" })] });

    expect((await patch({ status: "ONGOING" })).status).toBe(400);
    expect(closed.changes).toEqual([]);

    expect((await patch({ status: "ONGOING", note: "Kontrak diperpanjang." })).status).toBe(200);
    expect(closed.inquiries[0].status).toBe("ONGOING");
  });

  it("never changes a Program, a company name or a need: the body can only name stage, PIC and note", async () => {
    await patch({ status: "CONTACTED", programId: "program-2", companyName: "PT Lain", needs: "lain" });

    expect(db.inquiries[0].programId).toBe("program-1");
    expect(db.inquiries[0].companyName).toBe("PT Sinar Abadi");
    expect(db.inquiries[0].needs).toBe(inquiryRow().needs);
    expect(db.inquiries[0].status).toBe("CONTACTED");
  });
});

describe("GET /api/admin/partnership-inquiries/[id]", () => {
  it("gives an Admin the Inquiry in full, with the sealed fields read back and the proposal", async () => {
    loadDb({
      inquiries: [inquiryRow({ companyAddress: "Jl. Contoh Nomor 1", companyNpwp: "0".repeat(15) })],
      documents: [proposalRow()],
    });

    const res = await get();

    expect(res.status).toBe(200);
    const { inquiry } = (await res.json()) as { inquiry: Record<string, unknown> };
    expect(inquiry).toEqual(
      expect.objectContaining({
        contactEmail: "rina@sinarabadi.test",
        companyAddress: "Jl. Contoh Nomor 1",
        companyNpwp: "0".repeat(15),
        proposals: [expect.objectContaining({ id: "doc-1" })],
      }),
    );
    expect(JSON.stringify(inquiry)).not.toContain("Ciphertext");
  });

  it("answers a literal 404 to anyone without the ADMIN assignment, and for an Inquiry that does not exist", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "user-2", assignments: [] } });
    const refused = await get();
    expect(refused.status).toBe(404);
    expect(await refused.json()).toEqual({ error: "Not Found" });

    mockGetServerSession.mockResolvedValue({ user: { id: "admin-1", assignments: ["ADMIN"] } });
    expect((await get("inquiry-404")).status).toBe(404);
  });
});
