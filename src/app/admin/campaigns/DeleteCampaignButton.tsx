"use client";

import { useRouter } from "next/navigation";

export default function DeleteCampaignButton({
  campaignId,
  campaignTitle,
}: {
  campaignId: string;
  campaignTitle: string;
}) {
  const router = useRouter();

  async function handleDelete() {
    const confirmed = window.confirm(
      `Apakah Anda yakin ingin menghapus kampanye "${campaignTitle}"? Tindakan ini tidak dapat dibatalkan.`
    );

    if (!confirmed) return;

    try {
      const res = await fetch(`/api/campaigns/${campaignId}`, {
        method: "DELETE",
      });

      if (res.ok) {
        router.refresh();
      } else {
        const data = await res.json().catch(() => null);
        alert(data?.error ?? "Gagal menghapus kampanye. Silakan coba lagi.");
      }
    } catch {
      alert("Terjadi kesalahan. Silakan coba lagi.");
    }
  }

  return (
    <button
      type="button"
      onClick={handleDelete}
      className="inline-flex items-center px-2.5 py-1.5 text-xs font-medium rounded bg-red-50 text-red-700 hover:bg-red-100 transition-colors"
    >
      Hapus
    </button>
  );
}
