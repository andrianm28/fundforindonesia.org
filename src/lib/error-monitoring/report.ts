import { randomBytes } from 'node:crypto';
import { scrub } from './scrub';

/**
 * A minimal Sentry-protocol reporter (GlitchTip speaks it). No SDK: one JSON
 * POST to the project's store endpoint. Server-only; the DSN is read from
 * SENTRY_DSN at call time and must never be NEXT_PUBLIC_. With no DSN nothing
 * is sent. Reporting is fire-and-forget and never throws into the request.
 */

export type Dsn = { endpoint: string; publicKey: string };

const SEND_TIMEOUT_MS = 3000;
const CLIENT = 'ffi-minimal/1.0';

/** `https://<key>@<host>[/path]/<project>`. Anything else is "no DSN". */
export function parseDsn(raw: string | undefined): Dsn | null {
  if (!raw) return null;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (!url.username) return null;
    const segments = url.pathname.split('/').filter(Boolean);
    const project = segments.pop();
    if (!project) return null;
    const prefix = segments.length ? `/${segments.join('/')}` : '';
    return { endpoint: `${url.protocol}//${url.host}${prefix}/api/${project}/store/`, publicKey: url.username };
  } catch {
    return null;
  }
}

export type ErrorContext = {
  /** Request URL or path; scrubbed. No headers and no body are ever taken. */
  url?: string;
  method?: string;
  routePath?: string;
  source?: 'server' | 'client';
  tags?: Record<string, string>;
};

type Frame = { function?: string; filename?: string; lineno?: number; colno?: number };

function parseStack(stack: string | undefined): Frame[] {
  if (!stack) return [];
  const frames: Frame[] = [];
  for (const line of stack.split('\n')) {
    const m = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/.exec(line);
    if (m) frames.push({ function: m[1], filename: m[2], lineno: Number(m[3]), colno: Number(m[4]) });
  }
  // Sentry wants the oldest frame first.
  return frames.reverse();
}

export function buildEvent(err: unknown, context: ErrorContext = {}, now: Date = new Date()) {
  const error = err instanceof Error ? err : new Error(typeof err === 'string' ? err : 'Non-error thrown');
  const event = {
    event_id: randomBytes(16).toString('hex'),
    timestamp: now.toISOString(),
    platform: 'node',
    level: 'error',
    environment: process.env.NODE_ENV ?? 'unknown',
    exception: {
      values: [{ type: error.name, value: error.message, stacktrace: { frames: parseStack(error.stack) } }],
    },
    request: context.url ? { url: context.url, method: context.method } : undefined,
    tags: {
      source: context.source ?? 'server',
      ...(context.routePath ? { route: context.routePath } : {}),
      ...context.tags,
    },
  };
  return scrub(event);
}

/** Never throws; returns nothing. Without SENTRY_DSN, does nothing at all. */
export function reportError(err: unknown, context: ErrorContext = {}): void {
  try {
    const dsn = parseDsn(process.env.SENTRY_DSN);
    if (!dsn) return;
    const event = buildEvent(err, context);
    const auth = `Sentry sentry_version=7, sentry_key=${dsn.publicKey}, sentry_client=${CLIENT}`;
    void fetch(dsn.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Sentry-Auth': auth },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    }).catch(() => {});
  } catch {
    // Monitoring must never break the request it observes.
  }
}

export function monitoringEnabled(): boolean {
  return parseDsn(process.env.SENTRY_DSN) !== null;
}
