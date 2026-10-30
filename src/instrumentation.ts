import type { Instrumentation } from 'next';

export async function register(): Promise<void> {
  // Node runtime only: the edge runtime has no node:crypto and runs no limiter.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { assertProductionEnv } = await import('./lib/env-check');
    assertProductionEnv();
  }
}

// Server errors (render, route handler, action). A no-op without SENTRY_DSN.
// Only the path and method are forwarded: never headers or the body.
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { reportError } = await import('./lib/error-monitoring/report');
  reportError(err, { url: request.path, method: request.method, routePath: context.routePath, source: 'server' });
};
