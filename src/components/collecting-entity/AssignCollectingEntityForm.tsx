"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type AssignableCampaign = {
  slug: string;
  title: string;
  fundraiserName: string;
  /** The organisations this Campaign's Fundraiser may collect under. */
  options: { id: string; name: string }[];
};

/**
 * One Active Campaign without a Collecting Entity, and the Admin's or
 * Verifier's choice of one, with a reason (prd-compliance 10). The server
 * judges the choice again (assignCollectingEntity).
 */
export function AssignCollectingEntityForm({ campaign }: { campaign: AssignableCampaign }) {
  const router = useRouter();
  const [collectingEntityId, setCollectingEntityId] = useState(
    campaign.options.length === 1 ? campaign.options[0].id : ""
  );
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const response = await fetch(`/api/campaigns/${campaign.slug}/collecting-entity`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ collectingEntityId, reason }),
    });
    setBusy(false);
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setError(data.error || "Terjadi kesalahan.");
      return;
    }
    router.refresh();
  };

  const selectId = `entity-${campaign.slug}`;
  const reasonId = `reason-${campaign.slug}`;

  return (
    <form onSubmit={submit} className="bg-white rounded-xl border border-[#E0E0E0] p-4 space-y-2">
      <p className="text-sm font-medium text-[#212121]">{campaign.title}</p>
      <p className="text-xs text-[#757575]">Fundraiser: {campaign.fundraiserName}</p>
      {error && (
        <p role="alert" className="text-sm text-[#C62828]">
          {error}
        </p>
      )}
      {campaign.options.length === 0 ? (
        <p className="text-sm text-[#C62828]">
          Belum ada Partner Organisation yang dapat menaungi Campaign ini.
        </p>
      ) : (
        <>
          <label htmlFor={selectId} className="block text-xs text-[#757575]">
            Collecting Entity
          </label>
          <select
            id={selectId}
            value={collectingEntityId}
            onChange={(e) => setCollectingEntityId(e.target.value)}
            className="w-full rounded-lg border border-[#E0E0E0] p-2 text-sm"
            required
          >
            <option value="">Pilih Partner Organisation</option>
            {campaign.options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
          <label htmlFor={reasonId} className="block text-xs text-[#757575]">
            Alasan
          </label>
          <textarea
            id={reasonId}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={1000}
            rows={2}
            required
            className="w-full rounded-lg border border-[#E0E0E0] p-2 text-sm"
          />
          <button
            type="submit"
            disabled={busy}
            className="px-4 py-2 bg-[#0073E6] text-white text-sm font-medium rounded-lg disabled:opacity-50"
          >
            Tetapkan
          </button>
        </>
      )}
    </form>
  );
}
