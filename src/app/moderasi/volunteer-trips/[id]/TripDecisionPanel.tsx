"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * A Verifier's decision on one Submitted Volunteer Trip. Posts exactly what
 * PATCH /api/moderasi/volunteer-trips/[id] reads, `{ action, reason }` (the reason required on a reject), and shows the
 * server's refusal text as it comes: the rules (never the Verifier's own Trip,
 * Submitted only) are decideTripSubmission's, not this screen's.
 */
export function TripDecisionPanel({ tripId }: { tripId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");

  async function decide(action: "approve" | "reject") {
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/moderasi/volunteer-trips/${tripId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reason }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.error || "Terjadi kesalahan.");
        return;
      }
      router.refresh();
    } catch {
      setError("Terjadi kesalahan.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-3 border-t border-border pt-4">
      {error && (
        <p role="alert" className="text-sm text-[#C62828]">
          {error}
        </p>
      )}
      <div>
        <label htmlFor={`reason-${tripId}`} className="block text-sm font-medium text-text mb-1">
          Alasan penolakan (wajib bila menolak)
        </label>
        <textarea
          id={`reason-${tripId}`}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={1000}
          rows={3}
          disabled={pending}
          className="w-full rounded-lg border border-border p-2 text-sm"
        />
      </div>
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={() => decide("approve")}
          className="px-4 py-2 bg-[#2E7D32] text-white text-sm font-medium rounded-lg hover:bg-[#1B5E20] disabled:opacity-50"
        >
          Loloskan
        </button>
        <button
          type="button"
          disabled={pending || reason.trim() === ""}
          onClick={() => decide("reject")}
          className="px-4 py-2 bg-[#C62828] text-white text-sm font-medium rounded-lg hover:bg-[#B71C1C] disabled:opacity-50"
        >
          Tolak
        </button>
      </div>
    </div>
  );
}
