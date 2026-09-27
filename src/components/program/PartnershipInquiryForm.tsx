'use client';

import { useState, type FormEvent } from 'react';

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
 */
export function PartnershipInquiryForm({ programId, programSlug }: { programId: string; programSlug: string }) {
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'refused'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const body = Object.fromEntries(new FormData(form).entries());

    setState('sending');
    setError(null);
    try {
      const response = await fetch('/api/partnership-inquiries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
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
