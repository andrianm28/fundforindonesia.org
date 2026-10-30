'use client';

import { useCallback, useEffect, useState } from 'react';
import { isUpdateImageUrl } from '@/lib/campaign-update-images';

interface CampaignUpdateRow {
  id: string;
  title: string;
  content: string;
  images: string[];
  createdAt: string;
}

const PAGE_SIZE = 10;

/**
 * The public "Kabar Terbaru" tab: the Fundraiser's updates, newest first,
 * ten at a time. Title and content are the Fundraiser's own plain text, so
 * they render as text (whitespace preserved), never as markup.
 */
export function CampaignUpdatesTab({ slug }: { slug: string }) {
  const [rows, setRows] = useState<CampaignUpdateRow[]>([]);
  const [page, setPage] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  // Reads one page; setState happens only after the await, so the first read
  // can run from an effect and "Muat lebih banyak" from a click.
  const fetchPage = useCallback(
    async (next: number) => {
      const res = await fetch(`/api/campaigns/${slug}/updates?page=${next}&limit=${PAGE_SIZE}`);
      if (!res.ok) throw new Error('read failed');
      const data = await res.json();
      return {
        updates: (Array.isArray(data.updates) ? data.updates : []) as CampaignUpdateRow[],
        totalPages: typeof data.totalPages === 'number' ? data.totalPages : 1,
      };
    },
    [slug],
  );

  useEffect(() => {
    let cancelled = false;
    fetchPage(1)
      .then((data) => {
        if (cancelled) return;
        setRows(data.updates);
        setTotalPages(data.totalPages);
        setPage(1);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchPage]);

  async function loadMore() {
    setLoading(true);
    setFailed(false);
    try {
      const data = await fetchPage(page + 1);
      setRows((prev) => [...prev, ...data.updates]);
      setTotalPages(data.totalPages);
      setPage(page + 1);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }

  if (failed && rows.length === 0) {
    return (
      <p role="alert" className="text-sm text-danger">
        Gagal memuat kabar terbaru.
      </p>
    );
  }

  if (page === 0) {
    return <p className="text-sm text-text-secondary">Memuat kabar terbaru...</p>;
  }

  if (rows.length === 0) {
    return <p className="text-sm text-text-secondary">Belum ada kabar terbaru untuk campaign ini.</p>;
  }

  return (
    <div className="space-y-4">
      {rows.map((row) => (
        <article key={row.id} className="border-b border-border pb-4 last:border-b-0">
          <h3 className="text-sm font-semibold text-text break-words">{row.title}</h3>
          <p className="mt-0.5 text-xs text-text-secondary">
            {new Date(row.createdAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
          <p className="mt-2 text-sm text-text leading-relaxed whitespace-pre-line break-words">{row.content}</p>
          {row.images.filter(isUpdateImageUrl).length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-2">
              {row.images.filter(isUpdateImageUrl).map((src, idx) => (
                <li key={idx}>
                  <a
                    href={src}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block h-24 w-24 overflow-hidden rounded-lg border border-border"
                  >
                    {/* Fundraiser-supplied URL, so a plain <img>, as the Usage Report photos do. */}
                    <img src={src} alt={`Gambar kabar ${idx + 1}`} className="h-full w-full object-cover" />
                  </a>
                </li>
              ))}
            </ul>
          )}
        </article>
      ))}
      {failed && (
        <p role="alert" className="text-sm text-danger">
          Gagal memuat kabar berikutnya.
        </p>
      )}
      {page < totalPages && (
        <button
          type="button"
          disabled={loading}
          onClick={loadMore}
          className="text-sm font-medium text-primary disabled:opacity-50"
        >
          Muat lebih banyak
        </button>
      )}
    </div>
  );
}
