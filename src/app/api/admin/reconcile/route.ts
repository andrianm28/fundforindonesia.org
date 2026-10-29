import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withHiddenAssignmentCheck } from '@/lib/withAssignmentCheck';
import { Assignment } from '@/generated/prisma/client';
import { buildReconciliationReport } from '@/lib/money/reconciliation-report';

/**
 * GET /api/admin/reconcile -- ADMIN-only reconciliation report. Reports, never
 * corrects; what each field means is documented on buildReconciliationReport
 * (src/lib/money/reconciliation-report.ts), which /admin/reconciliation reads too.
 */
export const GET = withHiddenAssignmentCheck(Assignment.ADMIN, async (_req: NextRequest) => {
  const report = await prisma.$transaction((tx) => buildReconciliationReport(tx));

  return NextResponse.json(report);
});
