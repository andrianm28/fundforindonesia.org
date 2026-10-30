'use client';

import { useEffect, useState } from 'react';
import { formatRupiah } from '@/lib/utils/currency';
import { formatIndonesianDate } from '@/lib/utils/date';

type Row = { id: string; amount: number; donorName: string; createdAt: string };
type Answer = { donations: Row[]; total: number; page: number; totalPages: number };

/**
 * A Fundraiser's own read-only list of settled Donations on one Campaign
 * (ticket 73). Reads GET /api/user/campaigns/[slug]/donations, which already
 * hides anonymous Donors and carries no contact details.
 */
export function CampaignDonationList({ slug }: { slug: string }) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Answer | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/user/campaigns/${encodeURIComponent(slug)}/donations?page=${page}`)
      .then(async (res) => {
        if (res.status === 404) throw new Error('Kampanye tidak ditemukan.');
        if (!res.ok) throw new Error('Gagal memuat daftar donasi.');
        return (await res.json()) as Answer;
      })
      .then((json) => {
        if (!cancelled) {
          setData(json);
          setError(null);
        }
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [slug, page]);

  if (error) return <p role="alert" className="text-sm text-red-600">{error}</p>;
  if (!data) return <p className="text-sm text-gray-500">Memuat...</p>;
  if (data.total === 0) return <p className="text-sm text-gray-500">Belum ada donasi.</p>;

  return (
    <div>
      <p className="text-sm text-gray-600 mb-3">{data.total} donasi</p>
      <ul className="divide-y divide-gray-100 bg-white rounded-lg">
        {data.donations.map((d) => (
          <li key={d.id} className="flex items-center justify-between px-4 py-3">
            <div>
              <p className="text-sm font-medium">{d.donorName}</p>
              <p className="text-xs text-gray-500">{formatIndonesianDate(new Date(d.createdAt))}</p>
            </div>
            <p className="text-sm font-semibold">{formatRupiah(d.amount)}</p>
          </li>
        ))}
      </ul>
      {data.totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 text-sm">
          <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} className="px-3 py-1 rounded border disabled:opacity-40">
            Sebelumnya
          </button>
          <span>
            Halaman {data.page} dari {data.totalPages}
          </span>
          <button type="button" disabled={page >= data.totalPages} onClick={() => setPage(page + 1)} className="px-3 py-1 rounded border disabled:opacity-40">
            Berikutnya
          </button>
        </div>
      )}
    </div>
  );
}
