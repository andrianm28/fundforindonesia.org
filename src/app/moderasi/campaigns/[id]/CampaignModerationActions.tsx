"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface CampaignModerationActionsProps {
  campaignId: string;
  currentStatus: string;
}

export function CampaignModerationActions({
  campaignId,
  currentStatus,
}: CampaignModerationActionsProps) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const handleAction = async (action: "approve" | "reject" | "suspend") => {
    setLoading(action);
    setMessage(null);

    try {
      const response = await fetch(`/api/moderasi/campaigns/${campaignId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Terjadi kesalahan");
      }

      const actionLabels: Record<string, string> = {
        approve: "disetujui",
        reject: "ditolak",
        suspend: "ditangguhkan",
      };

      setMessage({
        type: "success",
        text: `Kampanye berhasil ${actionLabels[action]}`,
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

  const isPending = currentStatus === "pending";
  const isActive = currentStatus === "active";

  return (
    <div className="bg-white rounded-xl border border-[#E0E0E0] p-6">
      <h2 className="text-sm font-semibold text-[#212121] mb-4">
        Aksi Moderasi
      </h2>

      {message && (
        <div
          className={`mb-4 p-3 rounded-lg text-sm ${
            message.type === "success"
              ? "bg-[#E8F5E9] text-[#2E7D32]"
              : "bg-[#FFEBEE] text-[#C62828]"
          }`}
        >
          {message.text}
        </div>
      )}

      {!isPending && !isActive && (
        <p className="text-sm text-[#757575]">
          Kampanye ini sudah dimoderasi dengan status saat ini.
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        {isPending && (
          <>
            <button
              onClick={() => handleAction("approve")}
              disabled={loading !== null}
              className="inline-flex items-center gap-2 px-4 py-2 bg-[#2E7D32] text-white text-sm font-medium rounded-lg hover:bg-[#1B5E20] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading === "approve" ? (
                <LoadingSpinner />
              ) : (
                <CheckIcon />
              )}
              Setujui
            </button>

            <button
              onClick={() => handleAction("reject")}
              disabled={loading !== null}
              className="inline-flex items-center gap-2 px-4 py-2 bg-[#C62828] text-white text-sm font-medium rounded-lg hover:bg-[#B71C1C] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading === "reject" ? (
                <LoadingSpinner />
              ) : (
                <XIcon />
              )}
              Tolak
            </button>
          </>
        )}

        {(isPending || isActive) && (
          <button
            onClick={() => handleAction("suspend")}
            disabled={loading !== null}
            className="inline-flex items-center gap-2 px-4 py-2 bg-[#E65100] text-white text-sm font-medium rounded-lg hover:bg-[#BF360C] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading === "suspend" ? (
              <LoadingSpinner />
            ) : (
              <PauseIcon />
            )}
            Tangguhkan
          </button>
        )}
      </div>
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

function PauseIcon() {
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
        d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  );
}
