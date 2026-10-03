"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * A Verifier's revoke or reinstate form for one Bank Account (ticket 11):
 * a required reason and one button. Never receives the account number --
 * only the masked tail the server component already computed, the same
 * boundary DecidePanel keeps for the decide form.
 */
export function RevocationPanel({
  accountId,
  ownerName,
  bankCode,
  accountName,
  maskedNumber,
  revocationAction,
}: {
  accountId: string;
  ownerName: string;
  bankCode: string;
  accountName: string;
  maskedNumber: string;
  revocationAction: "revoke" | "reinstate";
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setPending(true);
    setError("");
    const response = await fetch(`/api/moderasi/bank-account-revocations/${accountId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: revocationAction, reason }),
    });
    setPending(false);
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(body.error || "Terjadi kesalahan.");
      return;
    }
    router.refresh();
  }

  const label = revocationAction === "revoke" ? "Cabut Verifikasi" : "Pulihkan Verifikasi";
  const reasonId = `${revocationAction}-reason-${accountId}`;

  return (
    <div className="bg-white rounded-xl border border-border p-6 space-y-3">
      <div className="space-y-1">
        <p className="text-sm text-text font-medium">Pemilik: {ownerName}</p>
        <p className="text-sm text-text-secondary">Bank: {bankCode}</p>
        <p className="text-sm text-text-secondary">Nama pemilik rekening: {accountName}</p>
        <p className="text-sm text-text-secondary">Nomor rekening (tersamar): {maskedNumber}</p>
      </div>

      {error && (
        <p role="alert" className="text-sm text-[#C62828]">
          {error}
        </p>
      )}

      <div>
        <label className="block text-xs text-text-secondary mb-1" htmlFor={reasonId}>
          Alasan
        </label>
        <input
          id={reasonId}
          className="w-full rounded-lg border border-border p-2 text-sm"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>

      <button
        type="button"
        disabled={pending}
        onClick={submit}
        className={
          revocationAction === "revoke"
            ? "text-xs font-medium px-3 py-1.5 rounded-lg text-[#C62828] bg-white border border-[#C62828] hover:bg-[#FFEBEE] disabled:opacity-50"
            : "text-xs font-medium px-3 py-1.5 rounded-lg text-white bg-[#2E7D32] hover:bg-[#1B5E20] disabled:opacity-50"
        }
      >
        {label}
      </button>
    </div>
  );
}
