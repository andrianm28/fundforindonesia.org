'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface AamiinPrayer {
  id: string;
  amiinCount: number;
}

/**
 * The Aamiin button's state for a list of Prayers (PKS pemenuhan 15): the
 * count (optimistic, then the server's), which Prayers this visitor already
 * gave an Aamiin, the pulse, and the failure toast. One Aamiin per visitor and
 * Prayer is the server's rule; here a given Aamiin is shown as given and a
 * second click does nothing. After a reload the given state is read from
 * /api/prayers/aamiin-status.
 */
export function useAamiin(prayers: AamiinPrayer[]) {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [given, setGiven] = useState<Record<string, boolean>>({});
  const [animating, setAnimating] = useState<Record<string, boolean>>({});
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const asked = useRef(new Set<string>());

  const idsKey = prayers.map((p) => p.id).join(',');
  useEffect(() => {
    const fresh = idsKey.split(',').filter((id) => id && !asked.current.has(id));
    if (fresh.length === 0) return;
    fresh.forEach((id) => asked.current.add(id));
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/prayers/aamiin-status?ids=${encodeURIComponent(fresh.slice(0, 50).join(','))}`);
        if (!res?.ok) return;
        const body = (await res.json()) as { given?: string[] };
        if (cancelled || !body.given?.length) return;
        setGiven((prev) => ({ ...prev, ...Object.fromEntries(body.given!.map((id) => [id, true])) }));
      } catch {
        // The button then simply starts as "not yet given"; the server still refuses a second one.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [idsKey]);

  const countOf = useCallback((prayer: AamiinPrayer) => counts[prayer.id] ?? prayer.amiinCount, [counts]);
  const isGiven = useCallback((prayerId: string) => given[prayerId] === true, [given]);

  const showToast = useCallback((message: string) => {
    setToastMessage(message);
    setTimeout(() => setToastMessage(null), 3000);
  }, []);

  const give = useCallback(
    async (prayerId: string, currentCount: number) => {
      if (given[prayerId]) return;
      setCounts((prev) => ({ ...prev, [prayerId]: currentCount + 1 }));
      setGiven((prev) => ({ ...prev, [prayerId]: true }));
      setAnimating((prev) => ({ ...prev, [prayerId]: true }));
      setTimeout(() => setAnimating((prev) => ({ ...prev, [prayerId]: false })), 600);

      try {
        const res = await fetch(`/api/prayers/${prayerId}/amiin`, { method: 'POST' });
        if (!res.ok) throw new Error('Failed to amiin');
        const body = (typeof res.json === 'function' ? await res.json().catch(() => null) : null) as {
          amiinCount?: number;
        } | null;
        // The server's count wins: when the Aamiin was already given the
        // optimistic +1 was wrong, and others may have added theirs meanwhile.
        if (typeof body?.amiinCount === 'number') {
          const serverCount = body.amiinCount;
          setCounts((prev) => ({ ...prev, [prayerId]: serverCount }));
        }
      } catch {
        setCounts((prev) => ({ ...prev, [prayerId]: currentCount }));
        setGiven((prev) => ({ ...prev, [prayerId]: false }));
        showToast('Gagal mengirim Aamiin. Coba lagi.');
      }
    },
    [given, showToast],
  );

  return { countOf, isGiven, isAnimating: (id: string) => animating[id] ?? false, give, toastMessage };
}
