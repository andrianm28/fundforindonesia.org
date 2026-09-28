import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { NextRequest } from "next/server";
import { bankAccountRow, bankAccountVerificationRequestRow, makeCampaignDb } from "../../../../tests/support/in-memory-campaign-db";

/**
 * The owner's own Bank Account collection (ticket 16), through the real
 * handler and module with the session and database stood in: any signed-in
 * user may reach it, and the rules themselves are the module's
 * (src/lib/bank-account-verification.test.ts).
 */
const state = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof makeCampaignDb> }));

vi.mock("@/lib/auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, { get: (_target, key) => (state.db.prisma as Record<string | symbol, unknown>)[key] }),
}));

import { GET, POST } from "./route";
import { getServerSession } from "@/lib/auth";

const mockSession = getServerSession as unknown as Mock;
const URL = "http://localhost:3000/api/bank-accounts";

function get(): Promise<Response> {
  return GET(new NextRequest(URL));
}
function post(body: unknown): Promise<Response> {
  return POST(new NextRequest(URL, { method: "POST", body: JSON.stringify(body) }));
}

describe("GET /api/bank-accounts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.db = makeCampaignDb({ bankAccounts: [], bankAccountVerificationRequests: [] });
    mockSession.mockResolvedValue({ user: { id: "owner-1" } });
  });

  it("answers 401 when signed out", async () => {
    mockSession.mockResolvedValue(null);
    expect((await get()).status).toBe(401);
  });

  it("lists only the signed-in person's own accounts, masking the number", async () => {
    state.db = makeCampaignDb({
      bankAccounts: [bankAccountRow({ id: "mine", ownerId: "owner-1" }), bankAccountRow({ id: "not-mine", ownerId: "someone-else" })],
    });

    const res = await get();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.accounts).toHaveLength(1);
    expect(body.accounts[0]).toMatchObject({ id: "mine", maskedNumber: "****7890", deletable: true, pendingRequestId: null });
    expect(body.accounts[0]).not.toHaveProperty("accountNumberCiphertext");
  });

  it("marks an account with a request row as not deletable and names its PENDING request", async () => {
    state.db = makeCampaignDb({
      bankAccounts: [bankAccountRow()],
      bankAccountVerificationRequests: [bankAccountVerificationRequestRow()],
    });

    const body = await (await get()).json();

    expect(body.accounts[0]).toMatchObject({ deletable: false, pendingRequestId: "bank-account-verification-1" });
  });
});

describe("POST /api/bank-accounts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.db = makeCampaignDb({ bankAccounts: [] });
    mockSession.mockResolvedValue({ user: { id: "owner-1" } });
  });

  it("answers 401 when signed out", async () => {
    mockSession.mockResolvedValue(null);
    expect((await post({ bankCode: "bca", accountName: "Siti", accountNumber: "123" })).status).toBe(401);
  });

  it("creates the account owned by the signed-in person, answering 201 with no plaintext number", async () => {
    const res = await post({ bankCode: "bca", accountName: "Siti Fundraiser", accountNumber: "9988776655" });
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.account).toMatchObject({ bankCode: "bca", accountName: "Siti Fundraiser", verifiedAt: null });
    expect(JSON.stringify(body)).not.toContain("9988776655");
    expect(state.db.bankAccounts[0].ownerId).toBe("owner-1");
  });

  it("answers a refusal with its status and code", async () => {
    const res = await post({ bankCode: "", accountName: "Siti", accountNumber: "123" });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("BANK_ACCOUNT_INVALID");
  });
});
