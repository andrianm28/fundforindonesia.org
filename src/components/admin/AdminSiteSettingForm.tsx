'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { SiteSettingKey, SiteSettings } from '@/lib/site-settings';

/**
 * One section of the public pages' content (Pengaturan Laman Publik;
 * src/lib/site-settings.ts). Each section posts its whole value to
 * POST /api/admin/site-settings; validation lives only on the server, so the
 * form shows the server's own refusal rather than re-deriving the rules.
 */

type Field = { name: string; label: string; hint?: string; multiline?: boolean };

const FIELDS: Partial<Record<SiteSettingKey, Field[]>> = {
  contact: [
    { name: 'email', label: 'Email dukungan' },
    { name: 'phone', label: 'Telepon', hint: 'Kosongkan untuk menyembunyikan kartu telepon.' },
    { name: 'whatsapp', label: 'WhatsApp', hint: 'Kosongkan untuk menyembunyikan kartu WhatsApp.' },
    { name: 'hours', label: 'Jam layanan', hint: 'Mis. Senin-Jumat, 09:00-17:00 WIB.' },
    { name: 'address', label: 'Alamat kantor', multiline: true },
  ],
  social: [
    { name: 'instagram', label: 'Instagram', hint: 'Alamat https:// lengkap; kosongkan untuk menyembunyikan.' },
    { name: 'twitter', label: 'Twitter / X' },
    { name: 'facebook', label: 'Facebook' },
  ],
  footer: [{ name: 'about', label: 'Teks "Tentang Fund for Indonesia" di footer', multiline: true }],
};

const SLIDE_FIELDS: Field[] = [
  { name: 'image', label: 'Gambar', hint: 'Path (/images/hero/banner-1.jpg) atau alamat https://.' },
  { name: 'headline', label: 'Judul' },
  { name: 'ctaLabel', label: 'Label tombol' },
  { name: 'ctaHref', label: 'Tujuan tombol', hint: 'Path (/explore/all) atau alamat https://.' },
];

type Slide = SiteSettings['hero']['slides'][number];

export function AdminSiteSettingForm<K extends SiteSettingKey>({
  settingKey,
  initial,
}: {
  settingKey: K;
  initial: SiteSettings[K];
}) {
  const router = useRouter();
  const [value, setValue] = useState<SiteSettings[K]>(initial);
  const [submitting, setSubmitting] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const dirty = JSON.stringify(value) !== JSON.stringify(initial);

  function change(next: SiteSettings[K]) {
    setValue(next);
    setSaved(false);
  }

  async function save() {
    setSubmitting(true);
    setRefusal(null);
    setSaved(false);
    try {
      const res = await fetch('/api/admin/site-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: settingKey, value }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setRefusal(typeof body.error === 'string' && body.error !== '' ? body.error : 'Gagal menyimpan pengaturan.');
        return;
      }
      setSaved(true);
      router.refresh();
    } catch {
      setRefusal('Gagal menyimpan pengaturan.');
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass = 'mt-1 w-full rounded-lg border border-gray-300 px-3 py-2';

  function textField(field: Field, current: string, onChange: (v: string) => void) {
    return (
      <label key={field.name} className="block text-sm text-gray-700">
        {field.label}
        {field.multiline ? (
          <textarea aria-label={field.label} rows={4} value={current} onChange={(e) => onChange(e.target.value)} className={inputClass} />
        ) : (
          <input aria-label={field.label} value={current} onChange={(e) => onChange(e.target.value)} className={inputClass} />
        )}
        {field.hint && <span className="mt-1 block text-xs text-gray-500">{field.hint}</span>}
      </label>
    );
  }

  let body: React.ReactNode = null;
  if (settingKey === 'hero') {
    const slides = (value as SiteSettings['hero']).slides;
    const setSlides = (next: Slide[]) => change({ slides: next } as SiteSettings[K]);
    body = (
      <div className="space-y-4">
        {slides.map((slide, i) => (
          <fieldset key={i} className="space-y-3 rounded-lg border border-gray-200 p-4">
            <legend className="px-1 text-sm font-medium text-gray-900">Slide {i + 1}</legend>
            {SLIDE_FIELDS.map((f) =>
              textField({ ...f, label: `${f.label} (slide ${i + 1})` }, slide[f.name as keyof Slide], (v) =>
                setSlides(slides.map((s, j) => (j === i ? { ...s, [f.name]: v } : s))),
              ),
            )}
            <div className="flex gap-2 text-sm">
              <button type="button" disabled={i === 0} onClick={() => setSlides(swap(slides, i, i - 1))} className="rounded border border-gray-300 px-2 py-1 disabled:opacity-40">
                Naik
              </button>
              <button type="button" disabled={i === slides.length - 1} onClick={() => setSlides(swap(slides, i, i + 1))} className="rounded border border-gray-300 px-2 py-1 disabled:opacity-40">
                Turun
              </button>
              <button type="button" disabled={slides.length <= 1} onClick={() => setSlides(slides.filter((_, j) => j !== i))} className="rounded border border-red-300 px-2 py-1 text-red-700 disabled:opacity-40">
                Hapus slide {i + 1}
              </button>
            </div>
          </fieldset>
        ))}
        <button
          type="button"
          disabled={slides.length >= 8}
          onClick={() => setSlides([...slides, { image: '/images/hero/banner-1.jpg', headline: '', ctaLabel: '', ctaHref: '/' }])}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:opacity-40"
        >
          Tambah slide
        </button>
      </div>
    );
  } else if (settingKey === 'pages') {
    const pages = value as SiteSettings['pages'];
    body = (
      <div className="space-y-4">
        <label className="block text-sm text-gray-700">
          Isi halaman Tentang Kami
          <textarea
            aria-label="Isi halaman Tentang Kami"
            rows={12}
            value={pages.aboutParagraphs.join('\n\n')}
            onChange={(e) =>
              change({ ...pages, aboutParagraphs: e.target.value.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean) } as SiteSettings[K])
            }
            className={inputClass}
          />
          <span className="mt-1 block text-xs text-gray-500">Pisahkan paragraf dengan satu baris kosong.</span>
        </label>
        {textField({ name: 'pressEmail', label: 'Email media (halaman Media)' }, pages.pressEmail, (v) => change({ ...pages, pressEmail: v } as SiteSettings[K]))}
        {textField({ name: 'careersEmail', label: 'Email karir (halaman Karir)' }, pages.careersEmail, (v) => change({ ...pages, careersEmail: v } as SiteSettings[K]))}
      </div>
    );
  } else {
    const record = value as Record<string, string>;
    body = (
      <div className="space-y-4">
        {(FIELDS[settingKey] ?? []).map((f) => textField(f, record[f.name] ?? '', (v) => change({ ...record, [f.name]: v } as SiteSettings[K])))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {body}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={!dirty || submitting}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {submitting ? 'Menyimpan...' : 'Simpan'}
        </button>
        {saved && <p role="status" className="text-sm text-green-700">Tersimpan.</p>}
        {refusal && <p role="alert" className="text-sm text-red-700">{refusal}</p>}
      </div>
    </div>
  );
}

function swap<T>(items: T[], a: number, b: number): T[] {
  const next = [...items];
  [next[a], next[b]] = [next[b], next[a]];
  return next;
}
