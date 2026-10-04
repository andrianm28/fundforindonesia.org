/**
 * Which deployment this process is, as an explicit marker rather than a guess.
 *
 * NODE_ENV cannot say: the staging image is the production build and runs with
 * NODE_ENV=production, because that is what makes it behave like production.
 * What distinguishes staging is a variable that only docker-compose.staging.yml
 * sets (go-live-ops 02). docker-compose.prod.yml never passes it, and a test
 * pins that, so a production .env cannot turn it on by accident.
 *
 * Only the exact string `staging` counts. "Staging", "true" and a trailing
 * space are somebody almost writing it, and guessing in the permissive
 * direction here lets a sandbox base url through on the money path.
 *
 * Server-side only, read per call, never NEXT_PUBLIC_: it must not be inlined
 * into a bundle at build time, and one image digest must not be able to
 * change its answer by being rebuilt.
 */
export function isStagingDeployment(): boolean {
  return process.env.DEPLOY_ENVIRONMENT === 'staging';
}

/**
 * Why prisma/seed.ts must not run in this environment, or null if it may.
 *
 * The seed creates Users with a published password. A production database that
 * received it would have accounts anyone can sign in to, so a production-mode
 * process refuses unless it is explicitly staging. A developer's shell
 * (NODE_ENV unset, development or test) is allowed, as before; the script's own
 * empty-database check still applies in every case. The seed never reads
 * another database: staging data is generated, never copied from production.
 */
export function seedRefusal(): string | null {
  if (process.env.NODE_ENV !== 'production' || isStagingDeployment()) return null;
  return (
    'Refusing to seed: NODE_ENV is production and DEPLOY_ENVIRONMENT is not staging. The seed ' +
    'creates accounts with a public password, so it only ever runs on a developer machine or on ' +
    'the staging stack (docs/runbooks/staging.md).'
  );
}
