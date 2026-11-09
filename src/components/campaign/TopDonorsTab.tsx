'use client';

import { useEffect, useState } from 'react';
import { formatRupiah } from '@/lib/utils/currency';
import type { TopDonor } from '@/lib/top-donors';

/**
 * The "Donatur teratas" tab of the Campaign page (PKS Pasal 3.7b): the largest
 * paid Donations, ranked. The server has already replaced an anonymous Donor's
 * name with "Anonim" and sent nothing else about them (src/lib/top-donors.ts),
 * so this only renders what it is given.
 */
export function TopDonorsTab({ slug }: { slug: string }) {
  const [donors, setDonors] = useState<TopDonor[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/campaigns/${slug}/top-donors`)
      .then((res) => (res.ok ? res.json() : { donors: [] }))
      .then((body: { donors?: TopDonor[] }) => {
        if (!cancelled) setDonors(body.donors ?? []);
      })
      .catch(() => {
        if (!cancelled) setDonors([]);
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (donors === null) return <p className="text-sm text-text-secondary">Memuat...</p>;
  if (donors.length === 0) return <p className="text-sm text-text-secondary">Belum ada donasi.</p>;

  return (
    <ol className="divide-y divide-border">
      {donors.map((donor) => (
        <li key={donor.rank} className="flex items-center justify-between py-3">
          <span className="text-sm text-text">
            <span className="mr-3 text-text-secondary">{donor.rank}.</span>
            {donor.donorName}
          </span>
          <span className="text-sm font-semibold text-text">{formatRupiah(donor.amount)}</span>
        </li>
      ))}
    </ol>
  );
}
