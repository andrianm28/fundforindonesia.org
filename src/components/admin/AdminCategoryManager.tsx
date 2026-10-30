'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Lists, adds, renames and deletes Categories through /api/admin/categories
 * (PRD: "Category Campaign dikelola Admin dari panel"). Validation lives on
 * the server, whose refusal is shown here in its own words. The slug is fixed
 * once made, and a Category a Campaign still uses has no delete button.
 */

export interface CategoryRow {
  id: string;
  name: string;
  slug: string;
  icon: string;
  order: number;
  campaignCount: number;
}

const INPUT = 'w-full rounded-md border border-gray-300 px-3 py-2 text-sm';

export function AdminCategoryManager({ categories }: { categories: CategoryRow[] }) {
  const router = useRouter();
  const [refusal, setRefusal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({ name: '', slug: '', icon: '', order: '0' });
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);

  async function send(url: string, method: string, body?: unknown): Promise<boolean> {
    setBusy(true);
    setRefusal(null);
    try {
      const res = await fetch(url, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const answer = await res.json().catch(() => ({}));
        setRefusal(answer.error ?? 'Perubahan gagal disimpan.');
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setRefusal('Tidak dapat menghubungi server.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const ok = await send('/api/admin/categories', 'POST', {
      name: draft.name,
      slug: draft.slug,
      icon: draft.icon,
      order: Number(draft.order || 0),
    });
    if (ok) setDraft({ name: '', slug: '', icon: '', order: '0' });
  }

  async function rename(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    if (await send(`/api/admin/categories/${editing.id}`, 'PATCH', { name: editing.name })) setEditing(null);
  }

  return (
    <div className="space-y-6">
      {refusal && (
        <p role="alert" className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
          {refusal}
        </p>
      )}

      <section className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-600">
            <tr>
              <th className="px-4 py-3">Ikon</th>
              <th className="px-4 py-3">Nama</th>
              <th className="px-4 py-3">Slug</th>
              <th className="px-4 py-3">Urutan</th>
              <th className="px-4 py-3">Campaign</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {categories.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-gray-500">
                  Belum ada kategori.
                </td>
              </tr>
            )}
            {categories.map((c) => (
              <tr key={c.id} className="border-t border-gray-100">
                <td className="px-4 py-3">{c.icon}</td>
                <td className="px-4 py-3">
                  {editing?.id === c.id ? (
                    <form onSubmit={rename} className="flex gap-2">
                      <input
                        aria-label={`Nama baru untuk ${c.name}`}
                        className={INPUT}
                        value={editing.name}
                        onChange={(e) => setEditing({ id: c.id, name: e.target.value })}
                      />
                      <button type="submit" disabled={busy} className="rounded-md bg-primary px-3 py-2 text-white">
                        Simpan
                      </button>
                      <button type="button" onClick={() => setEditing(null)} className="px-2 text-gray-600">
                        Batal
                      </button>
                    </form>
                  ) : (
                    c.name
                  )}
                </td>
                <td className="px-4 py-3 font-mono text-xs">{c.slug}</td>
                <td className="px-4 py-3">{c.order}</td>
                <td className="px-4 py-3">{c.campaignCount}</td>
                <td className="space-x-3 px-4 py-3 text-right">
                  {editing?.id !== c.id && (
                    <button type="button" onClick={() => setEditing({ id: c.id, name: c.name })} className="text-primary">
                      Ubah nama
                    </button>
                  )}
                  {c.campaignCount === 0 && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        if (window.confirm(`Hapus kategori ${c.name}?`)) void send(`/api/admin/categories/${c.id}`, 'DELETE');
                      }}
                      className="text-red-600"
                    >
                      Hapus
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-6">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">Tambah kategori</h2>
        <form onSubmit={create} className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm">
            Nama
            <input className={INPUT} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </label>
          <label className="text-sm">
            Slug
            <input
              className={INPUT}
              value={draft.slug}
              placeholder="huruf-kecil-dan-angka"
              onChange={(e) => setDraft({ ...draft, slug: e.target.value })}
            />
          </label>
          <label className="text-sm">
            Ikon
            <input className={INPUT} value={draft.icon} placeholder="🕌" onChange={(e) => setDraft({ ...draft, icon: e.target.value })} />
          </label>
          <label className="text-sm">
            Urutan
            <input
              className={INPUT}
              inputMode="numeric"
              value={draft.order}
              onChange={(e) => setDraft({ ...draft, order: e.target.value.replace(/\D/g, '') })}
            />
          </label>
          <div className="sm:col-span-2">
            <button type="submit" disabled={busy} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white">
              Tambah
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
