"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * The Verifier's decision form for one PENDING BankAccountVerificationRequest
 * (decision 2, 6): the two fields read off the document, a free note, and
 * reject-with-reason. It never receives the account number -- the full
 * number is rendered by the server component that hosts this panel, so it
 * never crosses into this client component's props or the RSC payload
 * (decision 6's stated cost).
 */
export function DecidePanel({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [checkedBankCode, setCheckedBankCode] = useState("");
  const [documentedAccountName, setDocumentedAccountName] = useState("");
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function decide(decision: "approve" | "reject") {
    setPending(true);
    setError("");
    const response = await fetch(`/api/moderasi/bank-accounts/${requestId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision, checkedBankCode, documentedAccountName, note, reason }),
    });
    setPending(false);
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(body.error || "Terjadi kesalahan.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-3 border-t border-[#E0E0E0] pt-4">
      {error && (
        <p role="alert" className="text-sm text-[#C62828]">
          {error}
        </p>
      )}
      <div>
        <label className="block text-xs text-[#757575] mb-1" htmlFor={`checked-bank-code-${requestId}`}>
          Kode bank pada dokumen
        </label>
        <input
          id={`checked-bank-code-${requestId}`}
          className="w-full rounded-lg border border-[#E0E0E0] p-2 text-sm"
          value={checkedBankCode}
          onChange={(e) => setCheckedBankCode(e.target.value)}
        />
      </div>
      <div>
        <label className="block text-xs text-[#757575] mb-1" htmlFor={`documented-name-${requestId}`}>
          Nama pada dokumen
        </label>
        <input
          id={`documented-name-${requestId}`}
          className="w-full rounded-lg border border-[#E0E0E0] p-2 text-sm"
          value={documentedAccountName}
          onChange={(e) => setDocumentedAccountName(e.target.value)}
        />
      </div>
      <div>
        <label className="block text-xs text-[#757575] mb-1" htmlFor={`note-${requestId}`}>
          Catatan (opsional)
        </label>
        <input
          id={`note-${requestId}`}
          className="w-full rounded-lg border border-[#E0E0E0] p-2 text-sm"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      <button
        type="button"
        disabled={pending}
        onClick={() => decide("approve")}
        className="text-xs font-medium px-3 py-1.5 rounded-lg text-white bg-[#2E7D32] hover:bg-[#1B5E20] disabled:opacity-50"
      >
        Setujui
      </button>

      <div className="pt-2">
        <label className="block text-xs text-[#757575] mb-1" htmlFor={`reason-${requestId}`}>
          Alasan penolakan
        </label>
        <input
          id={`reason-${requestId}`}
          className="w-full rounded-lg border border-[#E0E0E0] p-2 text-sm"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <button
          type="button"
          disabled={pending}
          onClick={() => decide("reject")}
          className="mt-2 text-xs font-medium px-3 py-1.5 rounded-lg text-[#C62828] bg-white border border-[#C62828] hover:bg-[#FFEBEE] disabled:opacity-50"
        >
          Tolak
        </button>
      </div>
    </div>
  );
}
