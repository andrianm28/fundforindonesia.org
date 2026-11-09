import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { zakatAdminRoute } from '@/lib/zakat-route';
import { InvalidRecapPeriodError, wibMonthOf } from '@/lib/money/finance-recap';
import { zakatTransactions, zakatTransactionsCsv } from '@/lib/zakat-report';

/**
 * GET /api/admin/zakat/transaksi?from=YYYY-MM&to=YYYY-MM -- the zakat
 * transactions as CSV (PKS pemenuhan 19, ADR 0028). Admin-only, and a 404 for
 * everyone while the zakat module is off. Read-only; only Donations on zakat
 * Campaigns. Both months default to the current WIB month.
 */
export const GET = zakatAdminRoute(async (req: NextRequest) => {
  const current = wibMonthOf(new Date());
  const from = req.nextUrl.searchParams.get('from') ?? current;
  const to = req.nextUrl.searchParams.get('to') ?? from;

  try {
    const rows = await zakatTransactions(prisma, { from, to });
    return new NextResponse(zakatTransactionsCsv(rows), {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="transaksi-zakat-${from}_${to}.csv"`,
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
