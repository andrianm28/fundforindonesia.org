"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface CampaignFlagFormProps {
  campaignSlug: string;
}

const FALLBACK_REFUSAL = "Gagal memasang Flag.";

/**
 * The Verifier raises a Flag on the Campaign they are looking at, with a
 * reason (flagCampaign, src/lib/campaign-lifecycle.ts, through
 * POST /api/campaigns/[slug]/flags). A Flag asks an Admin to consider
 * Suspension; it is the Admin who decides (CONTEXT.md, Flag and Verifier).
 *
 * Who may flag, and from which status, is judged by the lifecycle module
 * alone, so this form keeps no copy of either: the page decides whether to
 * render it with the module's own list, and every refusal is shown in the
 * server's words. What it adds is asking for the reason before submitting,
 * which the command requires, as the Admin forms do.
 */
export function CampaignFlagForm({ campaignSlug }: CampaignFlagFormProps) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  async function submit() {
    setSubmitting(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/campaigns/${campaignSlug}/flags`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setMessage({
          type: "error",
          text: typeof body.error === "string" && body.error !== "" ? body.error : FALLBACK_REFUSAL,
        });
        return;
      }
      setReason("");
      setMessage({ type: "success", text: "Flag terpasang. Admin akan mempertimbangkan Suspension." });
      router.refresh();
    } catch {
      setMessage({ type: "error", text: FALLBACK_REFUSAL });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-border p-6">
      <h2 className="text-sm font-semibold text-text mb-1">Flag untuk Admin</h2>
      <p className="text-xs text-text-secondary mb-4">
        Flag meminta Admin mempertimbangkan Suspension atas Campaign ini, dengan alasan dari Anda.
        Verifier tidak men-suspend; Admin yang memutuskan.
      </p>

      {message && (
        <div
          role={message.type === "error" ? "alert" : "status"}
          className={`mb-4 p-3 rounded-lg text-sm ${
            message.type === "success" ? "bg-[#E8F5E9] text-[#2E7D32]" : "bg-[#FFEBEE] text-[#C62828]"
          }`}
        >
          {message.text}
        </div>
      )}

      <label htmlFor="flag-reason" className="block text-sm font-medium text-text mb-1">
        Alasan Flag
      </label>
      <textarea
        id="flag-reason"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        rows={3}
        disabled={submitting}
        className="mb-4 w-full rounded-lg border border-border p-2 text-sm"
      />

      <button
        type="button"
        onClick={submit}
        disabled={reason.trim() === "" || submitting}
        className="inline-flex items-center gap-2 px-4 py-2 bg-[#E65100] text-white text-sm font-medium rounded-lg hover:bg-[#BF360C] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        Pasang Flag
      </button>
    </div>
  );
}
