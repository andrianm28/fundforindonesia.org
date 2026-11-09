'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { LEGAL_DOCS_VERSION } from '@/lib/site-identity';

/** Where a signed-in person who has not accepted the current Terms is sent. */
export const CONSENT_PATH = '/akun/persetujuan';

/** Pages they can still read (the documents themselves) or sign out from. */
const OPEN_PATHS = [CONSENT_PATH, '/terms', '/privacy', '/login'];

const CACHE_PREFIX = 'consent-ok:';

/** The key names the documents' version, so a new LEGAL_DOCS_VERSION is never answered from an old acceptance. */
const cacheKey = (userId: string) => `${CACHE_PREFIX}${LEGAL_DOCS_VERSION}:${userId}`;

function readCache(userId: string): boolean {
  try {
    return window.sessionStorage.getItem(cacheKey(userId)) === '1';
  } catch {
    return false;
  }
}

function writeCache(userId: string) {
  try {
    window.sessionStorage.setItem(cacheKey(userId), '1');
  } catch {
    // Storage blocked: the ref still avoids a check per navigation.
  }
}

/** Forget every remembered answer; called after the consent page records an acceptance. */
export function clearConsentCache() {
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.sessionStorage.length; i++) {
      const key = window.sessionStorage.key(i);
      if (key?.startsWith(CACHE_PREFIX)) keys.push(key);
    }
    keys.forEach((k) => window.sessionStorage.removeItem(k));
  } catch {
    // Nothing stored, nothing to clear.
  }
}

/**
 * A signed-in person who has no acceptance of the current Terms and Privacy
 * Policy (PKS 3.1) is put the two required checkboxes here, before anything
 * else: Google sign-ins never saw the registration form, older accounts
 * predate the record, and a new LEGAL_DOCS_VERSION asks everyone again.
 * Renders nothing. The server answers whether an acceptance is missing
 * (GET /api/user/consent); this only sends the person to the page that records
 * it. The gate is deliberately soft: it protects a consent record, not money
 * or access, and server routes do not enforce it. So it asks once per session:
 * an "accepted" answer is remembered in a ref and in sessionStorage per document version and user id,
 * and cleared after the consent POST. A failed check lets the person through
 * and is not remembered, so the next page load asks again.
 */
export function ConsentGate() {
  const { data: session } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const userId = session?.user?.id;
  const open = OPEN_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const acceptedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!userId || open) return;
    if (acceptedFor.current === userId) return;
    if (readCache(userId)) {
      acceptedFor.current = userId;
      return;
    }
    let cancelled = false;
    fetch('/api/user/consent')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.pending === true) {
          if (!cancelled) router.replace(CONSENT_PATH);
        } else if (data?.pending === false) {
          acceptedFor.current = userId;
          writeCache(userId);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [userId, open, pathname, router]);

  return null;
}
