import { sanitizeTrafficSource } from './traffic-source';

/**
 * Traffic Source capture (ticket 24): the `src` param a shared link carries
 * is only ever on the URL of the Campaign page a visitor first lands on --
 * by the time they reach the separate `/donate` route it is gone. This
 * bridges that gap client-side: captured once per Campaign into
 * sessionStorage (private to this tab, gone when it closes, never sent
 * anywhere by itself), read back when the Donation is submitted.
 *
 * sessionStorage can throw (a private window, a browser blocking site
 * data) -- both functions swallow that and degrade to "no source captured",
 * the same as a link with no `src` at all, never a broken page.
 */

function storageKey(campaignSlugOrId: string): string {
  return `ffi:traffic-source:${campaignSlugOrId}`;
}

/** Reads `src` off `url`, sanitizes it, and stores it for this Campaign. A missing or unsafe `src` leaves any previous capture untouched. */
export function captureTrafficSource(campaignSlugOrId: string, url: string): void {
  let raw: string | null;
  try {
    raw = new URL(url).searchParams.get('src');
  } catch {
    return;
  }
  const sanitized = sanitizeTrafficSource(raw);
  if (sanitized === null) return;

  try {
    window.sessionStorage.setItem(storageKey(campaignSlugOrId), sanitized);
  } catch {
    // Storage unavailable -- nothing captured, same as no `src` at all.
  }
}

/** The Traffic Source previously captured for this Campaign, or null if none was, or storage is unavailable. */
export function readCapturedTrafficSource(campaignSlugOrId: string): string | null {
  try {
    return window.sessionStorage.getItem(storageKey(campaignSlugOrId));
  } catch {
    return null;
  }
}
