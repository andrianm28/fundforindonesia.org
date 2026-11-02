"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Joins (or creates) the company of the signed-in person's own email domain
 * (POST /api/csr/membership). The domain is never typed: the server takes it
 * from the account's email.
 */
export function JoinCompanyForm() {
  const router = useRouter();
  const [companyName, setCompanyName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/csr/membership", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(companyName.trim() === "" ? {} : { companyName }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(body.error ?? "Gagal bergabung.");
        return;
      }
      if (body.membership?.verified) {
        router.push("/akun/tim-csr");
        router.refresh();
      } else {
        setMessage("Anda tercatat sebagai anggota. Verifikasi email Anda agar dapat melihat Inquiry perusahaan.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4 max-w-md">
      <label className="block text-sm font-medium">
        Nama perusahaan (hanya perlu bila perusahaan Anda belum terdaftar)
        <input
          className="mt-1 w-full rounded border px-3 py-2"
          value={companyName}
          onChange={(e) => setCompanyName(e.target.value)}
          maxLength={200}
        />
      </label>
      <button type="submit" disabled={busy} className="rounded bg-emerald-700 px-4 py-2 text-white disabled:opacity-60">
        Gabung sebagai Tim CSR
      </button>
      {message && <p role="status" className="text-sm">{message}</p>}
    </form>
  );
}
