"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Posts the invitation token (POST /api/organisation/team/accept) when the person presses the button. */
export function AcceptInvitationForm({ token }: { token: string | null }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!token) return <p className="text-sm">Tautan undangan tidak lengkap.</p>;

  async function accept() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/organisation/team/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        router.push("/akun/organisasi");
        router.refresh();
        return;
      }
      setMessage(
        res.status === 404
          ? "Undangan ini tidak berlaku: sudah dipakai, dicabut, kedaluwarsa, atau ditujukan ke email lain."
          : (body.error ?? "Gagal menerima undangan."),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <button type="button" onClick={accept} disabled={busy} className="rounded bg-emerald-700 px-4 py-2 text-white disabled:opacity-60">
        Terima undangan
      </button>
      {message && <p role="status" className="text-sm">{message}</p>}
    </div>
  );
}
