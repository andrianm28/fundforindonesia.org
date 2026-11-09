"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { BUDGET_RANGE_LABEL, PARTNERSHIP_BUDGET_RANGES } from "@/lib/partnership-inquiry-status";

/**
 * A verified member files a Partnership Inquiry for their company
 * (POST /api/csr/inquiries). PKS Pasal 3.6 (pks-pemenuhan/17): besides the need,
 * the member can give the budget range, the period (start and end month), the
 * company address and NPWP (optional) and attach a proposal PDF, which is
 * stored privately. Posted as multipart so the PDF travels with the text.
 */
export function CompanyInquiryForm({ programs }: { programs: Array<{ id: string; title: string }> }) {
  const router = useRouter();
  const [programId, setProgramId] = useState(programs[0]?.id ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const body = new FormData(form);
    body.set("programId", programId);
    const proposalInput = form.elements.namedItem("proposal");
    const attachedProposal =
      proposalInput instanceof HTMLInputElement && (proposalInput.files?.[0]?.size ?? 0) > 0;
    setBusy(true);
    setMessage(null);
    try {
      // No Content-Type: the browser sets multipart with its boundary.
      const res = await fetch("/api/csr/inquiries", { method: "POST", body });
      const answer = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(answer.error ?? "Gagal mengirim Inquiry.");
        return;
      }
      form.reset();
      setMessage(
        answer.inquiry?.proposalStored === false && attachedProposal
          ? "Inquiry terkirim, tetapi proposal belum tersimpan. Mohon kirim ulang proposal lewat email atau kanal kontak tim kemitraan."
          : "Inquiry terkirim.",
      );
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const field = "mt-1 w-full rounded border px-3 py-2";

  return (
    <form onSubmit={submit} className="space-y-4 max-w-xl">
      <label className="block text-sm font-medium">
        Program
        <select className={field} value={programId} onChange={(e) => setProgramId(e.target.value)}>
          {programs.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm font-medium">
        Kebutuhan yang ingin dibicarakan
        <textarea name="needs" className={field} rows={4} maxLength={5000} required />
      </label>
      <label className="block text-sm font-medium">
        Kisaran anggaran (opsional)
        <select name="budgetRange" className={field} defaultValue="">
          <option value="">Pilih kisaran anggaran</option>
          {PARTNERSHIP_BUDGET_RANGES.map((range) => (
            <option key={range} value={range}>
              {BUDGET_RANGE_LABEL[range]}
            </option>
          ))}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-4">
        <label className="block text-sm font-medium">
          Periode mulai (bulan)
          <input name="periodStart" type="month" className={field} />
        </label>
        <label className="block text-sm font-medium">
          Periode selesai (bulan)
          <input name="periodEnd" type="month" className={field} />
        </label>
      </div>
      <label className="block text-sm font-medium">
        Alamat perusahaan (opsional)
        <textarea name="companyAddress" className={field} rows={2} maxLength={500} />
      </label>
      <label className="block text-sm font-medium">
        NPWP perusahaan (opsional)
        <input name="companyNpwp" inputMode="numeric" autoComplete="off" className={field} />
      </label>
      <label className="block text-sm font-medium">
        Proposal (PDF, opsional, maksimal 10MB)
        <input name="proposal" type="file" accept="application/pdf" className="mt-1 w-full text-sm" />
        <span className="mt-1 block text-xs font-normal">Disimpan privat dan hanya dapat dibuka oleh tim kemitraan.</span>
      </label>
      <button type="submit" disabled={busy || programs.length === 0} className="rounded bg-emerald-700 px-4 py-2 text-white disabled:opacity-60">
        Kirim Inquiry
      </button>
      {message && <p role="status" className="text-sm">{message}</p>}
    </form>
  );
}
