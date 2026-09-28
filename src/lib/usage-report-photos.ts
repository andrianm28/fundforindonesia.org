/**
 * Only http(s) is a photo anyone can host as public evidence (CONTEXT.md,
 * Usage Report; ticket 22) -- a `javascript:` URL is a link that would run
 * when a public visitor or an Admin clicks it, and `data:` is not evidence of
 * anything hosted at all. The service layer (@/lib/usage-reports.ts) already
 * refuses either at submission time; every renderer of `UsageReport.photos`
 * (the public Campaign page, the Admin payout screen) calls this same
 * function as a second, independent check, so a row written before that rule
 * existed -- or by any other path -- is never turned into a clickable link.
 */
export function isPublicPhotoUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}
