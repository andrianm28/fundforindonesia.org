'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';

/** Where a signed-in person who has not accepted the current Terms is sent. */
export const CONSENT_PATH = '/akun/persetujuan';

/** Pages they can still read (the documents themselves) or sign out from. */
const OPEN_PATHS = [CONSENT_PATH, '/terms', '/privacy', '/login'];

/**
 * A person who first signed in with Google never saw the registration form, so
 * the two required checkboxes (PKS 3.1) are put to them here, once, before
 * anything else. Renders nothing. The server answers whether an acceptance is
 * missing (GET /api/user/consent); this only sends the person to the page that
 * records it. A failed check lets the person through: it gates a record, not
 * money or access, and the next page load asks again.
 */
export function ConsentGate() {
  const { data: session } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const userId = session?.user?.id;
  const open = OPEN_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  useEffect(() => {
    if (!userId || open) return;
    let cancelled = false;
    fetch('/api/user/consent')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data?.pending === true) router.replace(CONSENT_PATH);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [userId, open, pathname, router]);

  return null;
}
