export async function register(): Promise<void> {
  // Node runtime only: the edge runtime has no node:crypto and runs no limiter.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { assertProductionEnv } = await import('./lib/env-check');
    assertProductionEnv();
  }
}
