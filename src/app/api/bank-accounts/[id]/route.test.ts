import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { NextRequest } from "next/server";
import {
  bankAccountRow,
  bankAccountVerificationRequestRow,
  makeCampaignDb,
} from "../../../../../tests/support/in-memory-campaign-db";

/**
 * DELETE-only on `/api/bank-accounts/[id]` (decision 5): PATCH and PUT are
 * explicit 405s, proof that editing a Bank Account is unreachable through
 * this route, not merely unimplemented.
 */
const state = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof makeCampaignDb> }));

vi.mock("@/lib/auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, { get: (_target, key) => (state.db.prisma as Record<string | symbol, unknown>)[key] }),
}));

import { DELETE, PATCH, PUT } from "./route";
import { getServerSession } from "@/lib/auth";

const mockSession = getServerSession as unknown as Mock;
const url = (id: string) => `http://localhost:3000/api/bank-accounts/${id}`;
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

function del(id: string): Promise<Response> {
  return DELETE(new NextRequest(url(id), { method: "DELETE" }), ctx(id));
}

beforeEach(() => {
  vi.clearAllMocks();
  state.db = makeCampaignDb({ bankAccounts: [bankAccountRow()] });
  mockSession.mockResolvedValue({ user: { id: "owner-1" } });
});

describe("DELETE /api/bank-accounts/[id]", () => {
  it("answers 401 when signed out", async () => {
    mockSession.mockResolvedValue(null);
    expect((await del("bank-account-1")).status).toBe(401);
  });

  it("deletes the owner's own unverified, unsubmitted account, answering 204", async () => {
    const res = await del("bank-account-1");
    expect(res.status).toBe(204);
    expect(state.db.bankAccounts).toHaveLength(0);
  });

  it("refuses to delete another owner's account", async () => {
    mockSession.mockResolvedValue({ user: { id: "someone-else" } });
    const res = await del("bank-account-1");
    expect(res.status).toBe(404);
    expect(state.db.bankAccounts).toHaveLength(1);
  });

  it("refuses when a PENDING request row exists", async () => {
    state.db = makeCampaignDb({
      bankAccounts: [bankAccountRow()],
      bankAccountVerificationRequests: [bankAccountVerificationRequestRow({ outcome: "PENDING" })],
    });
    const res = await del("bank-account-1");
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("BANK_ACCOUNT_NOT_DELETABLE");
    expect(state.db.bankAccounts).toHaveLength(1);
  });

  it("refuses when a REJECTED request row exists -- not only a PENDING one", async () => {
    state.db = makeCampaignDb({
      bankAccounts: [bankAccountRow()],
      bankAccountVerificationRequests: [bankAccountVerificationRequestRow({ outcome: "REJECTED" })],
    });
    const res = await del("bank-account-1");
    expect(res.status).toBe(409);
    expect(state.db.bankAccounts).toHaveLength(1);
  });
});

describe("PATCH and PUT /api/bank-accounts/[id] (decision 5: no edit path at all)", () => {
  it("PATCH answers 405, leaving the account's fields unchanged", async () => {
    const res = await PATCH();
    expect(res.status).toBe(405);
    expect(state.db.bankAccount("bank-account-1")).toMatchObject({
      bankCode: "bca",
      accountName: "Siti Fundraiser",
    });
  });

  it("PUT answers 405, leaving the account's fields unchanged", async () => {
    const res = await PUT();
    expect(res.status).toBe(405);
    expect(state.db.bankAccount("bank-account-1")).toMatchObject({
      bankCode: "bca",
      accountName: "Siti Fundraiser",
    });
  });
});
