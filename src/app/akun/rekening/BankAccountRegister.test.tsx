import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { BankAccountRegister } from "./BankAccountRegister";

type OutcomeType = "PENDING" | "APPROVED" | "REJECTED" | "WITHDRAWN" | null;

/** The owner's own Bank Account screen (ticket 16), against a stand-in fetch. */
const UNSUBMITTED = {
  id: "acc-1",
  bankCode: "bca",
  accountName: "Siti Fundraiser",
  maskedNumber: "****7890",
  verifiedAt: null as string | null,
  deletable: true,
  pendingRequestId: null as string | null,
  latestOutcome: null as OutcomeType,
};

const calls: Array<{ url: string; method: string; body?: unknown }> = [];
let accounts = [UNSUBMITTED];

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ url, method, body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
      if (method === "GET") return Response.json({ accounts });
      if (method === "POST" && url === "/api/bank-accounts") return Response.json({}, { status: 201 });
      return Response.json({});
    })
  );
}

beforeEach(() => {
  calls.length = 0;
  accounts = [UNSUBMITTED];
  stubFetch();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("BankAccountRegister", () => {
  it("lists the owner's accounts with the masked number and status", async () => {
    render(<BankAccountRegister />);

    expect(await screen.findByText(/BCA/)).toBeDefined();
    expect(screen.getByText(/\*\*\*\*7890/)).toBeDefined();
    expect(screen.getByText(/Belum Diajukan/)).toBeDefined();
  });

  it("adds a new account", async () => {
    render(<BankAccountRegister />);
    await screen.findByText(/BCA/);

    fireEvent.change(screen.getByLabelText("Kode Bank"), { target: { value: "mandiri" } });
    fireEvent.change(screen.getByLabelText("Nama Pemilik Rekening"), { target: { value: "Budi" } });
    fireEvent.change(screen.getByLabelText("Nomor Rekening"), { target: { value: "111222333" } });
    fireEvent.click(screen.getByRole("button", { name: "Tambah" }));

    await waitFor(() =>
      expect(calls.find((c) => c.method === "POST" && c.url === "/api/bank-accounts")).toEqual({
        url: "/api/bank-accounts",
        method: "POST",
        body: { bankCode: "mandiri", accountName: "Budi", accountNumber: "111222333" },
      })
    );
  });

  it("offers to submit an unverified, unsubmitted account for verification", async () => {
    render(<BankAccountRegister />);
    await screen.findByText(/BCA/);

    fireEvent.click(screen.getByRole("button", { name: "Ajukan Verifikasi" }));

    await waitFor(() =>
      expect(calls.find((c) => c.method === "POST" && c.url.endsWith("/verification-requests"))).toMatchObject({
        url: "/api/bank-accounts/acc-1/verification-requests",
        method: "POST",
      })
    );
  });

  it("offers to withdraw a PENDING submission instead of submitting again", async () => {
    accounts = [{ ...UNSUBMITTED, deletable: false, pendingRequestId: "req-1", latestOutcome: "PENDING" }];
    render(<BankAccountRegister />);
    await screen.findByText(/Menunggu Verifikasi/);

    expect(screen.queryByRole("button", { name: "Ajukan Verifikasi" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Tarik Pengajuan" }));

    await waitFor(() =>
      expect(calls.find((c) => c.method === "DELETE" && c.url.endsWith("/verification-requests"))).toMatchObject({
        url: "/api/bank-accounts/acc-1/verification-requests",
        method: "DELETE",
      })
    );
  });

  it("offers to delete only a deletable account, never a verified or submitted one", async () => {
    accounts = [{ ...UNSUBMITTED, verifiedAt: "2026-09-28T00:00:00Z", deletable: false }];
    render(<BankAccountRegister />);
    await screen.findByText(/Terverifikasi/);

    expect(screen.queryByRole("button", { name: "Hapus" })).toBeNull();
  });

  it("deletes a deletable account", async () => {
    render(<BankAccountRegister />);
    await screen.findByText(/BCA/);

    fireEvent.click(screen.getByRole("button", { name: "Hapus" }));

    await waitFor(() =>
      expect(calls.find((c) => c.method === "DELETE" && c.url === "/api/bank-accounts/acc-1")).toBeDefined()
    );
  });

  it("shows no edit control anywhere on the page", async () => {
    render(<BankAccountRegister />);
    await screen.findByText(/BCA/);

    expect(screen.queryByRole("button", { name: /ubah|edit/i })).toBeNull();
  });
});
