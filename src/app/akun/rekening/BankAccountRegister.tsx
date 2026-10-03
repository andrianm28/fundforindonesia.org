"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * The owner's own Bank Accounts (ticket 16; ADR 0018): add one, submit it to
 * a Verifier, withdraw a PENDING submission, or delete an account that has
 * never been submitted. There is no edit control here at all (decision 5) --
 * a wrong number is fixed by deleting and re-adding.
 */

type Account = {
  id: string;
  bankCode: string;
  accountName: string;
  maskedNumber: string;
  verifiedAt: string | null;
  deletable: boolean;
  pendingRequestId: string | null;
  latestOutcome: "PENDING" | "APPROVED" | "REJECTED" | "WITHDRAWN" | null;
};

const API = "/api/bank-accounts";

async function send(url: string, method: string, body?: unknown): Promise<string | null> {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.ok) return null;
  const data = await response.json().catch(() => ({}));
  return data.error || "Terjadi kesalahan.";
}

function statusLabel(account: Account): string {
  if (account.verifiedAt) return "Terverifikasi";
  if (account.pendingRequestId) return "Menunggu Verifikasi";
  if (account.latestOutcome === "REJECTED") return "Ditolak Verifier";
  return "Belum Diajukan";
}

const inputClass = "w-full rounded-lg border border-border p-2 text-sm";

export function BankAccountRegister() {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    const response = await fetch(API);
    if (!response.ok) {
      setMessage({ type: "error", text: "Gagal memuat Bank Account." });
      setAccounts([]);
      return;
    }
    setAccounts((await response.json()).accounts);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (request: Promise<string | null>, success: string) => {
    const refused = await request;
    setMessage(refused ? { type: "error", text: refused } : { type: "success", text: success });
    if (!refused) await load();
    return !refused;
  };

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-text">Rekening Bank Saya</h1>

      {message && (
        <div
          role={message.type === "error" ? "alert" : "status"}
          className={`p-3 rounded-lg text-sm ${
            message.type === "success" ? "bg-[#E8F5E9] text-[#2E7D32]" : "bg-[#FFEBEE] text-[#C62828]"
          }`}
        >
          {message.text}
        </div>
      )}

      <RegisterForm onSubmit={(body) => act(send(API, "POST", body), "Bank Account ditambahkan.")} />

      {accounts === null && <p className="text-sm text-text-secondary">Memuat...</p>}
      {accounts?.length === 0 && <p className="text-sm text-text-secondary">Belum ada Bank Account terdaftar.</p>}
      {accounts?.map((account) => (
        <section key={account.id} className="bg-white rounded-xl border border-border p-6 space-y-2" data-testid={`bank-account-${account.id}`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-text">
                {account.bankCode.toUpperCase()} &middot; {account.accountName}
              </h2>
              <p className="text-xs text-text-secondary">Nomor rekening: {account.maskedNumber}</p>
              <p className="text-xs text-text-secondary">Status: {statusLabel(account)}</p>
            </div>
            <div className="flex gap-2">
              {!account.verifiedAt && !account.pendingRequestId && account.latestOutcome !== "PENDING" && (
                <button
                  type="button"
                  onClick={() =>
                    act(send(`${API}/${account.id}/verification-requests`, "POST"), "Diajukan untuk diverifikasi.")
                  }
                  className="text-xs font-medium px-3 py-1.5 rounded-lg text-white bg-[#0073E6] hover:bg-[#005BB5]"
                >
                  Ajukan Verifikasi
                </button>
              )}
              {account.pendingRequestId && (
                <button
                  type="button"
                  onClick={() =>
                    act(send(`${API}/${account.id}/verification-requests`, "DELETE"), "Pengajuan ditarik.")
                  }
                  className="text-xs font-medium px-3 py-1.5 rounded-lg text-[#0073E6] bg-white border border-[#0073E6] hover:bg-bg-secondary"
                >
                  Tarik Pengajuan
                </button>
              )}
              {account.deletable && (
                <button
                  type="button"
                  onClick={() => act(send(`${API}/${account.id}`, "DELETE"), "Bank Account dihapus.")}
                  className="text-xs font-medium px-3 py-1.5 rounded-lg text-[#C62828] bg-white border border-[#C62828] hover:bg-[#FFEBEE]"
                >
                  Hapus
                </button>
              )}
            </div>
          </div>
        </section>
      ))}
    </div>
  );
}

function RegisterForm({ onSubmit }: { onSubmit: (body: Record<string, unknown>) => Promise<boolean> }) {
  const [bankCode, setBankCode] = useState("");
  const [accountName, setAccountName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    const ok = await onSubmit({ bankCode, accountName, accountNumber });
    setPending(false);
    if (ok) {
      setBankCode("");
      setAccountName("");
      setAccountNumber("");
    }
  }

  return (
    <form onSubmit={submit} className="bg-white rounded-xl border border-border p-6 space-y-3">
      <h2 className="text-sm font-semibold text-text">Tambah Bank Account</h2>
      <div>
        <label className="block text-xs text-text-secondary mb-1" htmlFor="bank-code">
          Kode Bank
        </label>
        <input
          id="bank-code"
          className={inputClass}
          value={bankCode}
          onChange={(e) => setBankCode(e.target.value)}
          placeholder="bca, mandiri, bni, ..."
        />
      </div>
      <div>
        <label className="block text-xs text-text-secondary mb-1" htmlFor="account-name">
          Nama Pemilik Rekening
        </label>
        <input id="account-name" className={inputClass} value={accountName} onChange={(e) => setAccountName(e.target.value)} />
      </div>
      <div>
        <label className="block text-xs text-text-secondary mb-1" htmlFor="account-number">
          Nomor Rekening
        </label>
        <input id="account-number" className={inputClass} value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="text-sm font-medium px-4 py-2 rounded-lg text-white bg-[#0073E6] hover:bg-[#005BB5] disabled:opacity-50"
      >
        Tambah
      </button>
    </form>
  );
}
