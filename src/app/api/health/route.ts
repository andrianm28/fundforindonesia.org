import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// Polled by ops/deploy.sh on 127.0.0.1:8093 after switching containers; a
// failure triggers rollback. It must reflect the live DB on every request,
// needs no auth, and must not echo error details (connection strings).
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    return NextResponse.json({ ok: false }, { status: 503, headers: NO_STORE });
  }
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
