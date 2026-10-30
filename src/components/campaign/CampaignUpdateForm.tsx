'use client';

import { useState } from 'react';

const MAX_IMAGES = 4;

/**
 * The Fundraiser's form for a Kabar Terbaru: title, body (plain text) and up
 * to four images. Images go to POST /api/upload first; the update itself goes
 * to POST /api/campaigns/[slug]/updates, which refuses anyone but the
 * Campaign's Fundraiser, so this form only reports the answer.
 */
export function CampaignUpdateForm({ slug, onPosted }: { slug: string; onPosted?: () => void }) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [images, setImages] = useState<{ name: string; url: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  async function addImage(file: File) {
    if (images.length >= MAX_IMAGES) {
      setMessage({ type: 'error', text: `Maksimal ${MAX_IMAGES} gambar.` });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const body = new FormData();
      body.append('file', file);
      const res = await fetch('/api/upload', { method: 'POST', body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || typeof data.url !== 'string') {
        throw new Error(typeof data.error === 'string' ? data.error : 'Gagal mengunggah gambar.');
      }
      setImages((prev) => [...prev, { name: file.name, url: data.url }]);
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Gagal mengunggah gambar.' });
    } finally {
      setBusy(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (title.trim() === '' || content.trim() === '') {
      setMessage({ type: 'error', text: 'Judul dan isi kabar wajib diisi.' });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/campaigns/${slug}/updates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), content: content.trim(), images: images.map((i) => i.url) }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(typeof data.error === 'string' ? data.error : data.message ?? 'Gagal menerbitkan kabar.');
      }
      setTitle('');
      setContent('');
      setImages([]);
      setMessage({ type: 'success', text: 'Kabar terbit.' });
      onPosted?.();
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Gagal menerbitkan kabar.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-lg border border-border bg-white p-4">
      <div>
        <label htmlFor="kabar-judul" className="block text-sm font-medium text-text">
          Judul
        </label>
        <input
          id="kabar-judul"
          value={title}
          maxLength={200}
          onChange={(e) => setTitle(e.target.value)}
          className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
        />
      </div>
      <div>
        <label htmlFor="kabar-isi" className="block text-sm font-medium text-text">
          Isi kabar
        </label>
        <textarea
          id="kabar-isi"
          rows={6}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
        />
      </div>
      <div>
        <label htmlFor="kabar-gambar" className="block text-sm font-medium text-text">
          Gambar (opsional)
        </label>
        <input
          id="kabar-gambar"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={busy || images.length >= MAX_IMAGES}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void addImage(file);
            e.target.value = '';
          }}
          className="mt-1 block text-sm"
        />
        {images.length > 0 && (
          <ul className="mt-2 space-y-1">
            {images.map((img) => (
              <li key={img.url} className="flex items-center gap-2 text-xs text-text-secondary">
                <span>{img.name}</span>
                <button
                  type="button"
                  className="text-danger"
                  onClick={() => setImages((prev) => prev.filter((i) => i.url !== img.url))}
                >
                  Hapus
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {message && (
        <p role={message.type === 'error' ? 'alert' : 'status'} className={message.type === 'error' ? 'text-sm text-danger' : 'text-sm text-green-700'}>
          {message.text}
        </p>
      )}
      <button
        type="submit"
        disabled={busy}
        className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
      >
        Terbitkan kabar
      </button>
    </form>
  );
}
