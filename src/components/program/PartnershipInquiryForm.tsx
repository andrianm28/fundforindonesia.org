'use client';

import { useState, type FormEvent } from 'react';
import {
  BUDGET_RANGE_LABEL,
  PARTNERSHIP_BUDGET_RANGES,
} from '@/lib/partnership-inquiry-status';

/**
 * The Partnership Inquiry form on a Program page (ticket csr-04; PRD
 * FFI-10): the only thing a visitor can *do* on a Program page, because a
 * Program takes no money online (ADR 0002). It posts to
 * POST /api/partnership-inquiries, which is where ticket csr-05 creates the
 * Inquiry and tells the partnership team.
 *
 * It moves no money and never shows an amount, a payment method, or a total:
 * a conversation is what is being started here. The Program is named by the
 * page rather than chosen by the visitor, so a company cannot file an Inquiry
 * about a Program it is not looking at.
 *
 * PKS Pasal 3.6 (pks-pemenuhan/17): besides the contact and the need, a company
 * can say its budget range (a choice of range, never a figure), the period it has
 * in mind (a start and an end month), its address and NPWP (both optional), and
 * attach a proposal as a PDF. The form posts multipart so the PDF can travel with
 * the text; the PDF is stored as a private document only the partnership team can
 * open.
 */
export function PartnershipInquiryForm({ programId, programSlug }: { programId: string; programSlug: string }) {
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'refused'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const body = new FormData(form);

    setState('sending');
    setError(null);
    try {
      const response = await fetch('/api/partnership-inquiries', {
        method: 'POST',
        // No Content-Type: the browser sets multipart with its boundary.
        body,
      });
      if (!response.ok) {
        const refusal = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(refusal?.error ?? 'Permintaan Anda belum dapat dikirim. Coba lagi beberapa saat lagi.');
        setState('refused');
        return;
      }
      form.reset();
      setState('sent');
    } catch {
      setError('Permintaan Anda belum dapat dikirim. Coba lagi beberapa saat lagi.');
      setState('refused');
    }
  }

  if (state === 'sent') {
    return (
      <p data-testid="inquiry-sent" className="rounded-lg border border-green-300 bg-green-50 p-4 text-green-900">
        Terima kasih. Tim kemitraan kami akan menghubungi Anda lewat email yang Anda tuliskan.
      </p>
    );
  }

  return (
    <form onSubmit={submit} data-program-slug={programSlug} className="grid gap-4 max-w-xl">
      <input type="hidden" name="programId" value={programId} readOnly />

      {/* Honeypot (csr-06b): invisible and unreachable for a person, filled by a bot. */}
      {/* The name is neutral on purpose: autofill fills `website`. `inert` takes the wrapper out of
          the tab order and the accessibility tree, so nothing focusable sits inside aria-hidden. */}
      <div aria-hidden="true" inert className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="fax_ref">Jangan diisi</label>
        <input id="fax_ref" name="fax_ref" type="text" tabIndex={-1} autoComplete="new-password" defaultValue="" />
      </div>

      <div>
        <label htmlFor="companyName" className="block text-sm font-medium text-text mb-1">
          Nama perusahaan
        </label>
        <input
          id="companyName"
          name="companyName"
          required
          className="w-full px-3 py-2 text-sm border border-border rounded-md text-text"
        />
      </div>

      <div>
        <label htmlFor="contactName" className="block text-sm font-medium text-text mb-1">
          Nama narahubung
        </label>
        <input
          id="contactName"
          name="contactName"
          required
          className="w-full px-3 py-2 text-sm border border-border rounded-md text-text"
        />
      </div>

      <div>
        <label htmlFor="contactEmail" className="block text-sm font-medium text-text mb-1">
          Email narahubung
        </label>
        <input
          id="contactEmail"
          name="contactEmail"
          type="email"
          required
          className="w-full px-3 py-2 text-sm border border-border rounded-md text-text"
        />
      </div>

      <div>
        <label htmlFor="contactPhone" className="block text-sm font-medium text-text mb-1">
          Telepon (opsional)
        </label>
        <input
          id="contactPhone"
          name="contactPhone"
          className="w-full px-3 py-2 text-sm border border-border rounded-md text-text"
        />
      </div>

      <div>
        <label htmlFor="budgetRange" className="block text-sm font-medium text-text mb-1">
          Kisaran anggaran (opsional)
        </label>
        <select
          id="budgetRange"
          name="budgetRange"
          defaultValue=""
          className="w-full px-3 py-2 text-sm border border-border rounded-md text-text"
        >
          <option value="">Pilih kisaran anggaran</option>
          {PARTNERSHIP_BUDGET_RANGES.map((range) => (
            <option key={range} value={range}>
              {BUDGET_RANGE_LABEL[range]}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="periodStart" className="block text-sm font-medium text-text mb-1">
            Periode mulai (bulan)
          </label>
          <input
            id="periodStart"
            name="periodStart"
            type="month"
            className="w-full px-3 py-2 text-sm border border-border rounded-md text-text"
          />
        </div>
        <div>
          <label htmlFor="periodEnd" className="block text-sm font-medium text-text mb-1">
            Periode selesai (bulan)
          </label>
          <input
            id="periodEnd"
            name="periodEnd"
            type="month"
            className="w-full px-3 py-2 text-sm border border-border rounded-md text-text"
          />
        </div>
      </div>

      <div>
        <label htmlFor="companyAddress" className="block text-sm font-medium text-text mb-1">
          Alamat perusahaan (opsional)
        </label>
        <textarea
          id="companyAddress"
          name="companyAddress"
          rows={2}
          maxLength={500}
          className="w-full px-3 py-2 text-sm border border-border rounded-md text-text"
        />
      </div>

      <div>
        <label htmlFor="companyNpwp" className="block text-sm font-medium text-text mb-1">
          NPWP perusahaan (opsional)
        </label>
        <input
          id="companyNpwp"
          name="companyNpwp"
          inputMode="numeric"
          autoComplete="off"
          className="w-full px-3 py-2 text-sm border border-border rounded-md text-text"
        />
      </div>

      <div>
        <label htmlFor="needs" className="block text-sm font-medium text-text mb-1">
          Apa yang ingin Anda bicarakan
        </label>
        <textarea
          id="needs"
          name="needs"
          required
          rows={4}
          className="w-full px-3 py-2 text-sm border border-border rounded-md text-text"
        />
      </div>

      <div>
        <label htmlFor="proposal" className="block text-sm font-medium text-text mb-1">
          Proposal (PDF, opsional, maksimal 10MB)
        </label>
        <input
          id="proposal"
          name="proposal"
          type="file"
          accept="application/pdf"
          className="w-full text-sm text-text"
        />
        <p className="mt-1 text-xs text-text-secondary">
          Proposal Anda disimpan privat dan hanya dapat dibuka oleh tim kemitraan kami.
        </p>
      </div>

      {error ? (
        <p data-testid="inquiry-refused" className="rounded-lg border border-red-300 bg-red-50 p-3 text-red-800">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={state === 'sending'}
        className="px-4 py-2 text-sm font-medium text-white bg-primary rounded-md disabled:opacity-60"
      >
        {state === 'sending' ? 'Mengirim...' : 'Kirim permintaan diskusi'}
      </button>
    </form>
  );
}
