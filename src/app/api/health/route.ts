import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// The CD deploy script (spec: .scratch/ci-cd-github-actions) polls this on
// 127.0.0.1:8093 after switching containers and rolls back on failure. It must
// reflect the live DB on every request, needs no auth, and must not echo error
// details (connection strings) to the caller; they go to the server log only.
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (error) {
    console.error('Health check: database query failed', error);
    return NextResponse.json({ ok: false }, { status: 503, headers: NO_STORE });
  }
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
