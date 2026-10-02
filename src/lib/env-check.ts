/**
 * Boot-time environment check, called from src/instrumentation.ts. The rate
 * limiter itself fails OPEN at request time (a broken limiter must not take
 * the partnership form down), so a missing secret would otherwise go unnoticed
 * and leave public endpoints unguarded. Failing the boot makes the omission
 * loud instead. Only production is held to it; dev and tests may run without.
 */
export function assertProductionEnv(): void {
  if (process.env.NODE_ENV !== 'production') return;
  if (!process.env.RATE_LIMIT_SECRET && !process.env.NEXTAUTH_SECRET) {
    throw new Error('RATE_LIMIT_SECRET (or NEXTAUTH_SECRET) must be set in production');
  }
}
