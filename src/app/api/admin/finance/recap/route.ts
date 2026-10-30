import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withHiddenAssignmentCheck } from '@/lib/withAssignmentCheck';
import { Assignment } from '@/generated/prisma/client';
import { financeRecap, InvalidRecapPeriodError, wibMonthOf } from '@/lib/money/finance-recap';
import { financeRecapCsv } from '@/lib/money/finance-recap-csv';

/**
 * GET /api/admin/finance/recap?from=YYYY-MM&to=YYYY-MM -- the finance recap as
 * CSV (ticket 79), ADMIN-only (404 for anyone else, ticket 90). Same figures
 * and columns as /admin/finance; the definitions are in
 * src/lib/money/finance-recap.ts. Read-only. Both months default to the
 * current WIB month.
 */
export const GET = withHiddenAssignmentCheck(Assignment.ADMIN, async (req: NextRequest) => {
  const current = wibMonthOf(new Date());
  const from = req.nextUrl.searchParams.get('from') ?? current;
  const to = req.nextUrl.searchParams.get('to') ?? from;

  try {
    const recap = await financeRecap(prisma, { from, to });
    return new NextResponse(financeRecapCsv(recap), {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="rekap-keuangan-${from}_${to}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    if (err instanceof InvalidRecapPeriodError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
});
