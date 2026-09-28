import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { NextRequest } from "next/server";
import {
  bankAccountRow,
  bankAccountVerificationRequestRow,
  makeCampaignDb,
} from "../../../../../../tests/support/in-memory-campaign-db";

const state = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof makeCampaignDb> }));

vi.mock("@/lib/auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, { get: (_target, key) => (state.db.prisma as Record<string | symbol, unknown>)[key] }),
}));

import { POST } from "./route";
import { getServerSession } from "@/lib/auth";

const mockSession = getServerSession as unknown as Mock;
const url = (id: string) => `http://localhost:3000/api/moderasi/bank-accounts/${id}`;
const ctx = (id: string) => ({ params: Promise.resolve({ requestId: id }) });

function post(id: string, body: unknown): Promise<Response> {
  return POST(new NextRequest(url(id), { method: "POST", body: JSON.stringify(body) }), ctx(id));
}

beforeEach(() => {
  vi.clearAllMocks();
  state.db = makeCampaignDb({
    bankAccounts: [bankAccountRow()],
    bankAccountVerificationRequests: [bankAccountVerificationRequestRow()],
  });
  mockSession.mockResolvedValue({ user: { id: "verifier-1", assignments: ["VERIFIER"] } });
});

describe("POST /api/moderasi/bank-accounts/[requestId]", () => {
  it("answers 401 when signed out", async () => {
    mockSession.mockResolvedValue(null);
    expect((await post("bank-account-verification-1", { decision: "approve" })).status).toBe(401);
  });

  it("answers 403 for someone without the VERIFIER assignment", async () => {
    mockSession.mockResolvedValue({ user: { id: "admin-1", assignments: ["ADMIN"] } });
    expect((await post("bank-account-verification-1", { decision: "approve" })).status).toBe(403);
  });

  it("approves, writing verifiedAt on the account", async () => {
    const res = await post("bank-account-verification-1", {
      decision: "approve",
      checkedBankCode: "bca",
      documentedAccountName: "Siti Fundraiser",
    });

    expect(res.status).toBe(200);
    expect((await res.json()).request).toMatchObject({ outcome: "APPROVED" });
    expect(state.db.bankAccount("bank-account-1").verifiedAt).not.toBeNull();
  });

  it("rejects with a reason, leaving verifiedAt null", async () => {
    const res = await post("bank-account-verification-1", { decision: "reject", reason: "Nama tidak sesuai." });

    expect(res.status).toBe(200);
    expect((await res.json()).request).toMatchObject({ outcome: "REJECTED" });
    expect(state.db.bankAccount("bank-account-1").verifiedAt).toBeNull();
  });

  it("answers 422 for an approval missing the checked fields", async () => {
    const res = await post("bank-account-verification-1", { decision: "approve" });
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe("BANK_ACCOUNT_DECISION_INVALID");
  });

  it("answers 422 for a rejection with no reason", async () => {
    const res = await post("bank-account-verification-1", { decision: "reject" });
    expect(res.status).toBe(422);
  });

  it("answers 422 for a malformed decision value", async () => {
    const res = await post("bank-account-verification-1", { decision: "nope" });
    expect(res.status).toBe(422);
  });

  it("refuses a Verifier deciding their own account (ADR 0018)", async () => {
    state.db = makeCampaignDb({
      bankAccounts: [bankAccountRow({ ownerId: "verifier-1" })],
      bankAccountVerificationRequests: [bankAccountVerificationRequestRow()],
    });

    const res = await post("bank-account-verification-1", {
      decision: "approve",
      checkedBankCode: "bca",
      documentedAccountName: "Siti Fundraiser",
    });

    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("OWN_BANK_ACCOUNT_CONFLICT");
  });
});
