import { NextResponse } from 'next/server';

// The commit this process runs, from APP_REVISION (set in the image by cd.yml's
// build arg). ci/staging-gate.sh reads it from staging before a production
// deploy. A public repository's commit SHA is no secret; anything that is not
// a full SHA is reported as null rather than echoed.
export const dynamic = 'force-dynamic';

export async function GET() {
  const value = process.env.APP_REVISION ?? '';
  const revision = /^[0-9a-f]{40}$/.test(value) ? value : null;
  return NextResponse.json({ revision }, { headers: { 'Cache-Control': 'no-store' } });
}
