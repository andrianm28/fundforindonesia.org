import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { NextRequest } from "next/server";
import {
  bankAccountRow,
  bankAccountVerificationRequestRow,
  makeCampaignDb,
  userRow,
} from "../../../../../tests/support/in-memory-campaign-db";

/** The Verifier queue (ticket 16, flow step 3): gated on the VERIFIER assignment, masked number only. */
const state = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof makeCampaignDb> }));

vi.mock("@/lib/auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, { get: (_target, key) => (state.db.prisma as Record<string | symbol, unknown>)[key] }),
}));

import { GET } from "./route";
import { getServerSession } from "@/lib/auth";

const mockSession = getServerSession as unknown as Mock;
const URL = "http://localhost:3000/api/moderasi/bank-accounts";

function get(): Promise<Response> {
  return GET(new NextRequest(URL));
}

beforeEach(() => {
  vi.clearAllMocks();
  state.db = makeCampaignDb({
    users: [userRow({ id: "owner-1", name: "Siti Fundraiser" })],
    bankAccounts: [bankAccountRow()],
    bankAccountVerificationRequests: [bankAccountVerificationRequestRow()],
  });
  mockSession.mockResolvedValue({ user: { id: "verifier-1", assignments: ["VERIFIER"] } });
});

describe("GET /api/moderasi/bank-accounts", () => {
  it("answers 401 when signed out", async () => {
    mockSession.mockResolvedValue(null);
    expect((await get()).status).toBe(401);
  });

  it("answers 403 for someone without the VERIFIER assignment", async () => {
    mockSession.mockResolvedValue({ user: { id: "admin-1", assignments: ["ADMIN"] } });
    expect((await get()).status).toBe(403);
  });

  it("lists PENDING requests with the account's owner, bank code, name and masked number only", async () => {
    const res = await get();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.requests).toHaveLength(1);
    expect(body.requests[0]).toMatchObject({
      id: "bank-account-verification-1",
      bankAccount: { bankCode: "bca", accountName: "Siti Fundraiser", ownerName: "Siti Fundraiser", maskedNumber: "****7890" },
    });
    expect(JSON.stringify(body)).not.toContain("1234567890");
  });

  it("does not list an already-decided request", async () => {
    state.db = makeCampaignDb({
      bankAccounts: [bankAccountRow()],
      bankAccountVerificationRequests: [bankAccountVerificationRequestRow({ outcome: "APPROVED" })],
    });

    const body = await (await get()).json();
    expect(body.requests).toHaveLength(0);
  });
});
