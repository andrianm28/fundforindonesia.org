'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { SECTORS, SECTOR_LABEL } from '@/lib/programs';

/**
 * Create and edit form for a Program (ticket 78), through
 * /api/admin/programs. Validation lives in src/lib/programs.ts; its refusal
 * is shown here in its own words. A Program takes no money online, so
 * "Angka di luar pembukuan" is a plain reported figure, not a balance.
 */

export interface ProgramFormValues {
  id: string;
  slug: string;
  title: string;
  sector: string;
  problem: string;
  beneficiaries: string;
  location: string;
  activities: string;
  budget: number;
  timeline: string;
  kpis: string[];
  documentation: string[];
  impactReport: string | null;
  reportedAmount: number;
  /** yyyy-mm-dd, or null */
  reportedAsOf: string | null;
  reportedNote: string | null;
}

const INPUT = 'mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm';

function lines(text: string): string[] {
  return text.split('\n').map((l) => l.trim()).filter((l) => l !== '');
}

export function AdminProgramForm({ program }: { program?: ProgramFormValues }) {
  const router = useRouter();
  const [refusal, setRefusal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [v, setV] = useState({
    title: program?.title ?? '',
    slug: program?.slug ?? '',
    sector: program?.sector ?? '',
    problem: program?.problem ?? '',
    beneficiaries: program?.beneficiaries ?? '',
    location: program?.location ?? '',
    activities: program?.activities ?? '',
    budget: program ? String(program.budget) : '',
    timeline: program?.timeline ?? '',
    kpis: (program?.kpis ?? []).join('\n'),
    documentation: (program?.documentation ?? []).join('\n'),
    impactReport: program?.impactReport ?? '',
    reportedAmount: program ? String(program.reportedAmount) : '',
    reportedAsOf: program?.reportedAsOf ?? '',
    reportedNote: program?.reportedNote ?? '',
  });
  const set = (key: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setV({ ...v, [key]: e.target.value });
  const digits = (key: 'budget' | 'reportedAmount') => (e: React.ChangeEvent<HTMLInputElement>) =>
    setV({ ...v, [key]: e.target.value.replace(/\D/g, '') });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setRefusal(null);
    setSaved(false);
    const body: Record<string, unknown> = {
      title: v.title,
      sector: v.sector,
      problem: v.problem,
      beneficiaries: v.beneficiaries,
      location: v.location,
      activities: v.activities,
      timeline: v.timeline,
      kpis: lines(v.kpis),
      documentation: lines(v.documentation),
      impactReport: v.impactReport,
      reportedAsOf: v.reportedAsOf,
      reportedNote: v.reportedNote,
    };
    // A blank number is "not given": the module refuses a missing budget and
    // leaves the figure alone otherwise, rather than reading blank as zero.
    if (v.budget !== '') body.budget = Number(v.budget);
    if (v.reportedAmount !== '') body.reportedAmount = Number(v.reportedAmount);
    if (v.slug.trim() !== '') body.slug = v.slug.trim();

    try {
      const res = await fetch(program ? `/api/admin/programs/${program.id}` : '/api/admin/programs', {
        method: program ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const answer = await res.json().catch(() => ({}));
        setRefusal(answer.error ?? 'Perubahan gagal disimpan.');
        return;
      }
      if (program) {
        setSaved(true);
        router.refresh();
      } else {
        router.push('/admin/programs');
      }
    } catch {
      setRefusal('Tidak dapat menghubungi server.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-xl border border-gray-200 bg-white p-6" noValidate>
      {refusal && (
        <p role="alert" className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
          {refusal}
        </p>
      )}
      {saved && (
        <p role="status" className="rounded-md bg-green-50 px-4 py-3 text-sm text-green-700">
          Program tersimpan.
        </p>
      )}

      <label className="block text-sm">
        Judul
        <input className={INPUT} value={v.title} onChange={set('title')} />
      </label>
      <label className="block text-sm">
        Slug
        <input className={INPUT} value={v.slug} onChange={set('slug')} placeholder="otomatis dari judul bila dikosongkan" />
      </label>
      <label className="block text-sm">
        Sektor
        <select className={INPUT} value={v.sector} onChange={set('sector')}>
          <option value="">Pilih sektor</option>
          {SECTORS.map((code) => (
            <option key={code} value={code}>
              {SECTOR_LABEL[code]}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        Masalah yang dijawab
        <textarea className={INPUT} rows={3} value={v.problem} onChange={set('problem')} />
      </label>
      <label className="block text-sm">
        Penerima manfaat
        <textarea className={INPUT} rows={2} value={v.beneficiaries} onChange={set('beneficiaries')} />
      </label>
      <label className="block text-sm">
        Lokasi
        <input className={INPUT} value={v.location} onChange={set('location')} />
      </label>
      <label className="block text-sm">
        Kegiatan
        <textarea className={INPUT} rows={3} value={v.activities} onChange={set('activities')} />
      </label>
      <label className="block text-sm">
        Anggaran (Rp)
        <input className={INPUT} inputMode="numeric" value={v.budget} onChange={digits('budget')} />
      </label>
      <label className="block text-sm">
        Linimasa
        <input className={INPUT} value={v.timeline} onChange={set('timeline')} placeholder="Jan–Des 2027" />
      </label>
      <label className="block text-sm">
        KPI (satu per baris)
        <textarea className={INPUT} rows={3} value={v.kpis} onChange={set('kpis')} />
      </label>
      <label className="block text-sm">
        Dokumentasi (satu tautan per baris)
        <textarea className={INPUT} rows={3} value={v.documentation} onChange={set('documentation')} />
      </label>
      <label className="block text-sm">
        Laporan dampak
        <textarea className={INPUT} rows={3} value={v.impactReport} onChange={set('impactReport')} />
      </label>

      <fieldset className="space-y-4 rounded-md border border-gray-200 p-4">
        <legend className="px-1 text-sm font-medium text-gray-700">Dana CSR di luar pembukuan platform</legend>
        <p className="text-xs text-gray-500">
          Angka yang dilaporkan saja. Program tidak menerima dana lewat platform, jadi tidak ada jurnal di balik angka ini.
        </p>
        <label className="block text-sm">
          Angka di luar pembukuan (Rp)
          <input className={INPUT} inputMode="numeric" value={v.reportedAmount} onChange={digits('reportedAmount')} />
        </label>
        <label className="block text-sm">
          Per tanggal
          <input className={INPUT} type="date" value={v.reportedAsOf} onChange={set('reportedAsOf')} />
        </label>
        <label className="block text-sm">
          Catatan
          <input className={INPUT} value={v.reportedNote} onChange={set('reportedNote')} />
        </label>
      </fieldset>

      <button type="submit" disabled={busy} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white">
        {program ? 'Simpan perubahan' : 'Buat Program'}
      </button>
    </form>
  );
}
