"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** A verified member files a Partnership Inquiry for their company (POST /api/csr/inquiries). */
export function CompanyInquiryForm({ programs }: { programs: Array<{ id: string; title: string }> }) {
  const router = useRouter();
  const [programId, setProgramId] = useState(programs[0]?.id ?? "");
  const [needs, setNeeds] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/csr/inquiries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ programId, needs }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(body.error ?? "Gagal mengirim Inquiry.");
        return;
      }
      setNeeds("");
      setMessage("Inquiry terkirim.");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4 max-w-xl">
      <label className="block text-sm font-medium">
        Program
        <select className="mt-1 w-full rounded border px-3 py-2" value={programId} onChange={(e) => setProgramId(e.target.value)}>
          {programs.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm font-medium">
        Kebutuhan yang ingin dibicarakan
        <textarea
          className="mt-1 w-full rounded border px-3 py-2"
          rows={4}
          value={needs}
          onChange={(e) => setNeeds(e.target.value)}
          maxLength={5000}
          required
        />
      </label>
      <button type="submit" disabled={busy || programs.length === 0} className="rounded bg-emerald-700 px-4 py-2 text-white disabled:opacity-60">
        Kirim Inquiry
      </button>
      {message && <p role="status" className="text-sm">{message}</p>}
    </form>
  );
}
