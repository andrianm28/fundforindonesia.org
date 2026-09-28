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

import { DELETE, POST } from "./route";
import { getServerSession } from "@/lib/auth";

const mockSession = getServerSession as unknown as Mock;
const url = (id: string) => `http://localhost:3000/api/bank-accounts/${id}/verification-requests`;
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

function post(id: string): Promise<Response> {
  return POST(new NextRequest(url(id), { method: "POST" }), ctx(id));
}
function del(id: string): Promise<Response> {
  return DELETE(new NextRequest(url(id), { method: "DELETE" }), ctx(id));
}

beforeEach(() => {
  vi.clearAllMocks();
  state.db = makeCampaignDb({ bankAccounts: [bankAccountRow()] });
  mockSession.mockResolvedValue({ user: { id: "owner-1" } });
});

describe("POST /api/bank-accounts/[id]/verification-requests", () => {
  it("answers 401 when signed out", async () => {
    mockSession.mockResolvedValue(null);
    expect((await post("bank-account-1")).status).toBe(401);
  });

  it("submits the owner's own account, answering 201", async () => {
    const res = await post("bank-account-1");
    expect(res.status).toBe(201);
    expect((await res.json()).request).toMatchObject({ outcome: "PENDING" });
  });

  it("refuses a second submission while one is PENDING", async () => {
    await post("bank-account-1");
    const res = await post("bank-account-1");
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("BANK_ACCOUNT_VERIFICATION_ALREADY_PENDING");
  });

  it("refuses another owner's account", async () => {
    mockSession.mockResolvedValue({ user: { id: "someone-else" } });
    const res = await post("bank-account-1");
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/bank-accounts/[id]/verification-requests", () => {
  it("withdraws the account's own PENDING request", async () => {
    state.db = makeCampaignDb({
      bankAccounts: [bankAccountRow()],
      bankAccountVerificationRequests: [bankAccountVerificationRequestRow()],
    });

    const res = await del("bank-account-1");

    expect(res.status).toBe(200);
    expect((await res.json()).request).toMatchObject({ outcome: "WITHDRAWN" });
  });

  it("refuses when there is nothing PENDING to withdraw", async () => {
    const res = await del("bank-account-1");
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("BANK_ACCOUNT_VERIFICATION_NOT_PENDING");
  });
});
