"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ChecklistEntry, VerificationDecision } from "@/lib/campaign-lifecycle";

interface CampaignModerationActionsProps {
  campaignId: string;
  /** The Campaign's PENDING Verification Request, or null when none awaits a decision. */
  request: { id: string; isFirst: boolean; checklist: ChecklistEntry[] } | null;
  /** When the Fundraiser's Identity Verification was recorded, or null if it never was. */
  identityVerifiedAt: Date | null;
  /** The Collecting Entity approving confirms (prd-compliance 10), or null when it names none. */
  collectingEntityName?: string | null;
}

/**
 * The Verifier's decision on one Verification Request: tick the checklist
 * snapshot it was submitted with, then approve, or reject with a reason.
 * The first approval of a Fundraiser also records their Identity
 * Verification, so the note field shows only while they have none.
 * Approve stays disabled until every required item is ticked, naming the
 * ones still missing; the server refuses such an approval anyway.
 * Suspension is an Admin decision (ADR 0005), so this panel never offers it.
 */
export function CampaignModerationActions({
  campaignId,
  request,
  identityVerifiedAt,
  collectingEntityName = null,
}: CampaignModerationActionsProps) {
  const router = useRouter();
  const [loading, setLoading] = useState<VerificationDecision | null>(null);
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const [reason, setReason] = useState("");
  const [identityNote, setIdentityNote] = useState("");
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const toggle = (id: string) => {
    setTicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const untickedRequired = (request?.checklist ?? [])
    .filter((entry) => entry.required && !ticked.has(entry.id))
    .map((entry) => entry.label);

  const handleAction = async (decision: VerificationDecision) => {
    if (!request) return;
    if (decision === "approve" && untickedRequired.length > 0) return;
    setMessage(null);
    if (decision === "reject" && reason.trim() === "") {
      setMessage({ type: "error", text: "Alasan penolakan wajib diisi." });
      return;
    }
    setLoading(decision);

    const body: Record<string, unknown> = {
      action: decision,
      requestId: request.id,
      // In checklist order, whatever order the boxes were ticked in.
      ticked: request.checklist.filter((entry) => ticked.has(entry.id)).map((entry) => entry.id),
    };
    if (decision === "reject") body.reason = reason;
    if (decision === "approve" && !identityVerifiedAt && identityNote.trim() !== "") {
      body.identityNote = identityNote;
    }

    try {
      const response = await fetch(`/api/moderasi/campaigns/${campaignId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Terjadi kesalahan");
      }

      setMessage({
        type: "success",
        text: decision === "approve" ? "Campaign berhasil diloloskan" : "Campaign berhasil ditolak",
      });

      // Refresh the page data after a short delay
      setTimeout(() => {
        router.refresh();
      }, 1500);
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Terjadi kesalahan saat memproses aksi";
      setMessage({
        type: "error",
        text: errorMessage,
      });
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-[#E0E0E0] p-6">
      <h2 className="text-sm font-semibold text-[#212121] mb-4">
        Verification Request
      </h2>

      {message && (
        <div
          role={message.type === "error" ? "alert" : "status"}
          className={`mb-4 p-3 rounded-lg text-sm ${
            message.type === "success"
              ? "bg-[#E8F5E9] text-[#2E7D32]"
              : "bg-[#FFEBEE] text-[#C62828]"
          }`}
        >
          {message.text}
        </div>
      )}

      {!request && (
        <p className="text-sm text-[#757575]">
          Tidak ada Verification Request yang menunggu keputusan.
        </p>
      )}

      {request && (
        <>
          <p className="text-xs text-[#757575] mb-3">
            {request.isFirst ? "Pengajuan pertama" : "Pengajuan ulang"}
          </p>

          <fieldset className="mb-4">
            <legend className="text-sm font-medium text-[#212121] mb-2">Checklist dokumen</legend>
            {request.checklist.length === 0 ? (
              <p className="text-sm text-[#757575]">Checklist kosong saat Campaign diajukan.</p>
            ) : (
              <ul className="space-y-2">
                {request.checklist.map((entry) => (
                  <li key={entry.id}>
                    <label className="flex items-start gap-2 text-sm text-[#424242]">
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={ticked.has(entry.id)}
                        onChange={() => toggle(entry.id)}
                        disabled={loading !== null}
                      />
                      <span>
                        {entry.label}
                        {entry.required && (
                          <span className="ml-2 text-xs text-[#C62828]">Wajib</span>
                        )}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </fieldset>

          {identityVerifiedAt ? (
            <p className="mb-4 text-sm text-[#2E7D32]">
              Identitas Fundraiser sudah diverifikasi pada{" "}
              {new Date(identityVerifiedAt).toLocaleDateString("id-ID", {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
              .
            </p>
          ) : (
            <div className="mb-4">
              <label htmlFor="identity-note" className="block text-sm font-medium text-[#212121] mb-1">
                Catatan verifikasi identitas (opsional)
              </label>
              <p className="text-xs text-[#757575] mb-2">
                Identitas Fundraiser ini belum pernah diverifikasi. Menyetujui pengajuan ini mencatat
                Identity Verification atas nama Anda.
              </p>
              <textarea
                id="identity-note"
                value={identityNote}
                onChange={(event) => setIdentityNote(event.target.value)}
                maxLength={1000}
                rows={2}
                disabled={loading !== null}
                className="w-full rounded-lg border border-[#E0E0E0] p-2 text-sm"
              />
            </div>
          )}

          <div className="mb-4">
            <label htmlFor="reject-reason" className="block text-sm font-medium text-[#212121] mb-1">
              Alasan penolakan (wajib bila menolak)
            </label>
            <textarea
              id="reject-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={1000}
              rows={3}
              disabled={loading !== null}
              className="w-full rounded-lg border border-[#E0E0E0] p-2 text-sm"
            />
          </div>

          <p className="mb-4 text-sm text-[#424242]">
            {collectingEntityName
              ? `Meloloskan pengajuan ini mengonfirmasi ${collectingEntityName} sebagai Collecting Entity yang menghimpun dana Campaign ini.`
              : "Campaign ini belum menyebutkan Collecting Entity, sehingga belum dapat diloloskan."}
          </p>

          {untickedRequired.length > 0 && (
            <p id="approve-blocked" className="mb-3 text-sm text-[#757575]">
              Centang semua butir wajib untuk meloloskan: {untickedRequired.join(", ")}.
            </p>
          )}

          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => handleAction("approve")}
              disabled={loading !== null || untickedRequired.length > 0}
              aria-describedby={untickedRequired.length > 0 ? "approve-blocked" : undefined}
              className="inline-flex items-center gap-2 px-4 py-2 bg-[#2E7D32] text-white text-sm font-medium rounded-lg hover:bg-[#1B5E20] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading === "approve" ? <LoadingSpinner /> : <CheckIcon />}
              Loloskan
            </button>

            <button
              onClick={() => handleAction("reject")}
              disabled={loading !== null}
              className="inline-flex items-center gap-2 px-4 py-2 bg-[#C62828] text-white text-sm font-medium rounded-lg hover:bg-[#B71C1C] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading === "reject" ? <LoadingSpinner /> : <XIcon />}
              Tolak
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function LoadingSpinner() {
  return (
    <svg
      className="w-4 h-4 animate-spin"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      className="w-4 h-4"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M5 13l4 4L19 7"
      />
    </svg>
  );
}

function XIcon() {
  return (
    <svg
      className="w-4 h-4"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M6 18L18 6M6 6l12 12"
      />
    </svg>
  );
}
