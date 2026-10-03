import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

vi.mock("@/lib/auth", () => ({ getServerSession: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  useRouter: vi.fn(() => ({ refresh: vi.fn() })),
}));

const state = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof import("../../../../tests/support/in-memory-campaign-db").makeCampaignDb> }));

vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, { get: (_target, key) => (state.db.prisma as Record<string | symbol, unknown>)[key] }),
}));

import { render, screen, cleanup } from "@testing-library/react";
import {
  bankAccountRevocationRow,
  bankAccountRow,
  bankAccountVerificationRequestRow,
  makeCampaignDb,
  userRow,
} from "../../../../tests/support/in-memory-campaign-db";
import { getServerSession } from "@/lib/auth";
import ModerasiRekeningPage from "./page";

const mockGetServerSession = getServerSession as unknown as Mock;

describe("ModerasiRekeningPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.db = makeCampaignDb({
      users: [userRow({ id: "owner-1", name: "Siti Fundraiser" })],
      bankAccounts: [bankAccountRow()],
      bankAccountVerificationRequests: [bankAccountVerificationRequestRow()],
    });
  });

  it("redirects home when unauthenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);
    await expect(ModerasiRekeningPage()).rejects.toThrow("NEXT_REDIRECT:/");
  });

  it("redirects home for someone without the VERIFIER assignment", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "admin-1", assignments: ["ADMIN"] } });
    await expect(ModerasiRekeningPage()).rejects.toThrow("NEXT_REDIRECT:/");
  });

  it("shows the owner, bank code, name and the masked number in the queue, and the full number in the decide panel", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "verifier-1", assignments: ["VERIFIER"] } });

    render(await ModerasiRekeningPage());

    expect(screen.getAllByText(/Siti Fundraiser/).length).toBeGreaterThan(0);
    expect(screen.getByText(/bca/)).toBeDefined();
    expect(screen.getByText(/tersamar.*\*\*\*\*7890/)).toBeDefined();
    // Decision 6: the full number is rendered directly in this server
    // component, not fetched by the client decide panel.
    expect(screen.getByText(/1234567890/)).toBeDefined();
    cleanup();
  });

  it("shows nothing waiting when there is no PENDING request", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "verifier-1", assignments: ["VERIFIER"] } });
    state.db = makeCampaignDb({ bankAccounts: [], bankAccountVerificationRequests: [] });

    render(await ModerasiRekeningPage());

    expect(screen.getByText(/Tidak ada Bank Account/)).toBeDefined();
    cleanup();
  });

  it("does not list an already-decided request", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "verifier-1", assignments: ["VERIFIER"] } });
    state.db = makeCampaignDb({
      bankAccounts: [bankAccountRow()],
      bankAccountVerificationRequests: [bankAccountVerificationRequestRow({ outcome: "APPROVED" })],
    });

    render(await ModerasiRekeningPage());

    expect(screen.getByText(/Tidak ada Bank Account/)).toBeDefined();
    cleanup();
  });

  it("lists a verified account for revoke, and shows none to reinstate (ticket 11)", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "verifier-1", assignments: ["VERIFIER"] } });
    state.db = makeCampaignDb({
      users: [userRow({ id: "owner-1", name: "Siti Fundraiser" })],
      bankAccounts: [bankAccountRow({ verifiedAt: new Date("2026-09-27T00:00:00Z") })],
    });

    render(await ModerasiRekeningPage());

    expect(screen.getByText(/Rekening Terverifikasi/)).toBeDefined();
    expect(screen.getByText("Cabut Verifikasi")).toBeDefined();
    expect(screen.getByText(/Tidak ada rekening yang sedang dicabut/)).toBeDefined();
    cleanup();
  });

  it("lists a revoked account for reinstate, and shows none to revoke (ticket 11)", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "verifier-1", assignments: ["VERIFIER"] } });
    state.db = makeCampaignDb({
      users: [userRow({ id: "owner-1", name: "Siti Fundraiser" })],
      bankAccounts: [bankAccountRow({ verifiedAt: null })],
      bankAccountRevocations: [bankAccountRevocationRow()],
    });

    render(await ModerasiRekeningPage());

    expect(screen.getByText(/Rekening Dicabut/)).toBeDefined();
    expect(screen.getByText("Pulihkan Verifikasi")).toBeDefined();
    expect(screen.getByText(/Tidak ada rekening terverifikasi/)).toBeDefined();
    cleanup();
  });
});
