import { NextResponse, type NextRequest } from 'next/server';
import { clientAddress } from '@/lib/client-ip';
import { guardRoute } from '@/lib/rate-limit-guard';
import { monitoringEnabled, reportError } from '@/lib/error-monitoring/report';

// Same-origin relay for browser errors: the DSN stays on the server and CSP
// connect-src 'self' keeps working. Everything is scrubbed before forwarding.
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 8 * 1024;
const LIMIT = 20;
const WINDOW_SECONDS = 10 * 60;
const cap = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : '');

export async function POST(request: NextRequest) {
  // Nothing to forward to: no limiter write, no work.
  if (!monitoringEnabled()) return new NextResponse(null, { status: 204 });

  const refused = await guardRoute(
    {
      scope: 'client-error',
      subject: clientAddress(request.headers),
      limit: LIMIT,
      windowSeconds: WINDOW_SECONDS,
      onUnavailable: 'closed',
    },
    { limited: 'Terlalu banyak laporan.' },
  );
  if (refused) return refused;

  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_BODY_BYTES) return new NextResponse(null, { status: 413 });

  let payload: Record<string, unknown> = {};
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return new NextResponse(null, { status: 413 });
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === 'object') payload = parsed as Record<string, unknown>;
  } catch {
    return new NextResponse(null, { status: 400 });
  }

  const error = new Error(cap(payload.message, 1000) || 'Client error');
  error.name = cap(payload.name, 100) || 'Error';
  error.stack = cap(payload.stack, 4000) || undefined;
  reportError(error, {
    source: 'client',
    url: cap(payload.url, 500) || undefined,
    tags: payload.digest ? { digest: cap(payload.digest, 100) } : undefined,
  });
  return new NextResponse(null, { status: 204 });
}
