import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  buildCompanyImpactReport,
  csrErrorToHttp,
  impactReportFilename,
  renderImpactReportMarkdown,
} from "@/lib/tim-csr";

/**
 * GET /api/csr/impact-report: the member's company's impact report as a
 * Markdown download (ticket E9/01, tahap 2). Program data only. A literal 404
 * for anyone who is not a verified member.
 */
export async function GET() {
  const session = await getServerSession();
  try {
    const report = await buildCompanyImpactReport(prisma, session?.user?.id);
    return new NextResponse(renderImpactReportMarkdown(report), {
      status: 200,
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="${impactReportFilename(report.companyName)}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    if (csrErrorToHttp(error)?.status === 404) return NextResponse.json({ error: "Not Found" }, { status: 404 });
    throw error;
  }
}
