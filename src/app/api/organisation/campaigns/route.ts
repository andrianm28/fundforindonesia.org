import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { listOrganisationCampaigns, teamErrorToHttp } from "@/lib/organisation-team";

/**
 * GET /api/organisation/campaigns: the organisation's Campaigns dashboard,
 * read-only (ticket E4), for its primary Fundraiser and its team members. No
 * amounts, balances, Payouts or Bank Accounts. The organisation is the
 * caller's own; a stranger or an anonymous visitor gets a literal 404.
 */
export async function GET() {
  const session = await getServerSession();
  try {
    return NextResponse.json(await listOrganisationCampaigns(prisma, session?.user?.id));
  } catch (error) {
    const refusal = teamErrorToHttp(error);
    if (refusal) return NextResponse.json({ error: refusal.error }, { status: refusal.status });
    throw error;
  }
}
