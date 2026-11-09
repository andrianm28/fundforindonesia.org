import React from 'react';
import Link from 'next/link';
import type { PrayerStreamItem } from '@/lib/hooks/usePrayerStream';

/**
 * "Sorotan doa" on the home page (PKS pemenuhan 15): the Prayers an Admin
 * marked, in the Admin's order, above the live Prayer Wall. The page passes
 * only Prayers that pass the public Prayer rule. An anonymous Donor shows as
 * "Anonim" (the item carries no user then).
 */
export function PrayerHighlights({ prayers }: { prayers: PrayerStreamItem[] }) {
  if (prayers.length === 0) return null;
  return (
    <section className="px-4 py-4" aria-label="Sorotan doa">
      <h2 className="text-lg font-bold text-text mb-3">Sorotan Doa</h2>
      <ul className="space-y-3">
        {prayers.map((prayer) => (
          <li key={prayer.id} className="rounded-lg border border-border bg-white p-3">
            <p className="text-sm text-text-secondary leading-relaxed">{prayer.text}</p>
            <p className="mt-1 text-xs text-text-secondary">
              {prayer.user?.name ?? 'Anonim'}
              {prayer.campaign && (
                <>
                  {' '}
                  untuk{' '}
                  <Link href={`/campaign/${prayer.campaign.slug}`} className="font-medium text-primary">
                    {prayer.campaign.title}
                  </Link>
                </>
              )}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
