import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { NextRequest } from "next/server";
import {
  bankAccountRevocationRow,
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
const url = (id: string) => `http://localhost:3000/api/moderasi/bank-account-revocations/${id}`;
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

function post(id: string, body: unknown): Promise<Response> {
  return POST(new NextRequest(url(id), { method: "POST", body: JSON.stringify(body) }), ctx(id));
}

const NOW = new Date("2026-09-28T10:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  state.db = makeCampaignDb({
    bankAccounts: [bankAccountRow({ verifiedAt: NOW })],
    bankAccountVerificationRequests: [
      bankAccountVerificationRequestRow({ outcome: "APPROVED", decidedById: "verifier-1", decidedAt: NOW }),
    ],
  });
  mockSession.mockResolvedValue({ user: { id: "verifier-2", assignments: ["VERIFIER"] } });
});

describe("POST /api/moderasi/bank-account-revocations/[id]", () => {
  it("answers 401 when signed out", async () => {
    mockSession.mockResolvedValue(null);
    expect((await post("bank-account-1", { action: "revoke", reason: "Alasan." })).status).toBe(401);
  });

  it("answers 403 for someone without the VERIFIER assignment", async () => {
    mockSession.mockResolvedValue({ user: { id: "admin-1", assignments: ["ADMIN"] } });
    expect((await post("bank-account-1", { action: "revoke", reason: "Alasan." })).status).toBe(403);
  });

  it("revokes, clearing verifiedAt", async () => {
    const res = await post("bank-account-1", { action: "revoke", reason: "Rekening bermasalah." });

    expect(res.status).toBe(200);
    expect((await res.json()).revocation).toMatchObject({ action: "REVOKED" });
    expect(state.db.bankAccount("bank-account-1").verifiedAt).toBeNull();
  });

  it("refuses the Verifier who most recently approved the account", async () => {
    mockSession.mockResolvedValue({ user: { id: "verifier-1", assignments: ["VERIFIER"] } });

    const res = await post("bank-account-1", { action: "revoke", reason: "Alasan." });

    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("BANK_ACCOUNT_REVOKED_BY_APPROVER");
  });

  it("refuses the account's own owner", async () => {
    mockSession.mockResolvedValue({ user: { id: "owner-1", assignments: ["VERIFIER"] } });

    const res = await post("bank-account-1", { action: "revoke", reason: "Alasan." });

    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("OWN_BANK_ACCOUNT_CONFLICT");
  });

  it("answers 422 for a missing reason", async () => {
    const res = await post("bank-account-1", { action: "revoke" });
    expect(res.status).toBe(422);
  });

  it("answers 422 for a malformed action value", async () => {
    const res = await post("bank-account-1", { action: "nope", reason: "Alasan." });
    expect(res.status).toBe(422);
  });

  it("reinstates a revoked account with a different Verifier than the revoker", async () => {
    state.db = makeCampaignDb({
      bankAccounts: [bankAccountRow({ verifiedAt: null })],
      bankAccountRevocations: [bankAccountRevocationRow({ actorId: "verifier-2" })],
    });
    mockSession.mockResolvedValue({ user: { id: "verifier-1", assignments: ["VERIFIER"] } });

    const res = await post("bank-account-1", { action: "reinstate", reason: "Investigasi selesai." });

    expect(res.status).toBe(200);
    expect((await res.json()).revocation).toMatchObject({ action: "REINSTATED" });
    expect(state.db.bankAccount("bank-account-1").verifiedAt).not.toBeNull();
  });

  it("refuses the Verifier who revoked the account from reinstating it", async () => {
    state.db = makeCampaignDb({
      bankAccounts: [bankAccountRow({ verifiedAt: null })],
      bankAccountRevocations: [bankAccountRevocationRow({ actorId: "verifier-2" })],
    });

    const res = await post("bank-account-1", { action: "reinstate", reason: "Alasan." });

    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("BANK_ACCOUNT_REINSTATED_BY_REVOKER");
  });

  it("answers 409 reinstating an account that was never revoked", async () => {
    state.db = makeCampaignDb({ bankAccounts: [bankAccountRow({ verifiedAt: null })] });

    const res = await post("bank-account-1", { action: "reinstate", reason: "Alasan." });

    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("BANK_ACCOUNT_NOT_REINSTATABLE");
  });
});
