import { NextRequest, NextResponse } from 'next/server';
import { followShortLink } from '@/lib/short-links';
import { publicUrl } from '@/lib/public-url';

// Every visit is looked up and counted: never prerendered, never cached.
export const dynamic = 'force-dynamic';

const NOT_FOUND_PAGE = `<!doctype html>
<html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Tautan tidak ditemukan</title></head>
<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem">
<h1>Tautan tidak ditemukan</h1>
<p>Tautan ini tidak ada atau Campaign-nya tidak lagi dapat dibuka.</p>
<p><a href="/">Kembali ke Fund for Indonesia</a></p>
</body></html>`;

/**
 * GET /s/<code> (ticket E1/02; owner decision 2026-10-04: a prefix on the
 * apex domain). A route handler rather than a page: a page renders behind
 * the root loading.tsx, which would stream a 200 before a redirect() or
 * notFound() could set the status (see src/proxy.ts), and a link preview
 * bot needs a real 302 to reach the Campaign's Open Graph tags.
 *
 * Redirects to publicUrl(), never to the request's own host, which behind
 * nginx is the internal one.
 */
export async function GET(_request: NextRequest, context: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await context.params;
    const target = await followShortLink(code, new Date());

    if (!target) {
      return new NextResponse(NOT_FOUND_PAGE, {
        status: 404,
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    }

    const response = NextResponse.redirect(publicUrl(target), 302);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch (error) {
    console.error('Error following short link:', error);
    return new NextResponse('Terjadi kesalahan server', { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}
