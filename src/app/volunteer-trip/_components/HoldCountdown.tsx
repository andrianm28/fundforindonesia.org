'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

const POLL_MS = 15_000;

function remaining(expiresAt: string): number {
  return Math.max(0, new Date(expiresAt).getTime() - Date.now());
}

function format(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const mm = String(Math.floor(total / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

/**
 * Counts down the seat hold (30 minutes). Refreshes the server page when it
 * reaches zero, and every 15 seconds while it runs so a Trip Fee that settles
 * moves the page to its confirmation without a manual reload. The server, not
 * this clock, decides whether the hold lapsed.
 */
export function HoldCountdown({ expiresAt }: { expiresAt: string }) {
  const router = useRouter();
  const [ms, setMs] = useState(() => remaining(expiresAt));

  useEffect(() => {
    let sinceRefresh = 0;
    const tick = setInterval(() => {
      const left = remaining(expiresAt);
      setMs(left);
      sinceRefresh += 1000;
      if (left === 0) {
        clearInterval(tick);
        router.refresh();
      } else if (sinceRefresh >= POLL_MS) {
        sinceRefresh = 0;
        router.refresh();
      }
    }, 1000);
    return () => clearInterval(tick);
  }, [expiresAt, router]);

  return (
    <span role="timer" className="font-mono font-semibold">
      {format(ms)}
    </span>
  );
}
