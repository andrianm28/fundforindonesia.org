/**
 * Whether this process is the public beta, as an explicit marker rather than a
 * guess (ticket rilis-1-benda/92).
 *
 * NODE_ENV cannot say: the beta image is the production build and runs with
 * NODE_ENV=production, because that is what makes it behave like production.
 * What distinguishes the beta is `BETA_SANDBOX`, which the owner sets in the
 * production `.env` for the beta period and removes at go-live. While it is on,
 * the Sumopod sandbox is the ONLY thing the money path accepts (no real rupiah
 * moves); while it is off, the sandbox is refused as it always was.
 *
 * Only the exact string `true` counts. "True", "1", "yes" and a trailing space
 * are somebody almost writing it, and guessing in the permissive direction here
 * lets a sandbox base url through on the money path.
 *
 * Server-side only, read per call, never NEXT_PUBLIC_: it must not be inlined
 * into a bundle at build time, and one image digest must not be able to change
 * its answer by being rebuilt. Client components receive the answer as a prop
 * from a server component; they never read it.
 */
export function isBetaSandbox(): boolean {
  return process.env.BETA_SANDBOX === 'true';
}
